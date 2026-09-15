import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { describe, expect, test, vi } from "vitest";
import { LearnView } from "@/components/modes/LearnView";
import { WorkspaceProvider, useWorkspace } from "@/components/workspace/Providers";
import { buildCourseTree, parsePgnFile } from "@/lib/course/build-tree";
import type { CourseMeta } from "@/lib/course/types";
import type { WorkspaceEvent } from "@/lib/events/bus";
import { MemoryProgressStore } from "@/lib/progress/memory-store";
import { LocalStorageSettingsStore } from "@/lib/settings/local-storage-store";
import { DAY_MS } from "@/lib/training/scheduler";

const meta: CourseMeta = { slug: "ruy", name: "Ruy Lopez", eco: [], mainSide: "white", credits: [], contentLicense: "CC0" };
const tree = buildCourseTree(meta, parsePgnFile("ruy/lines.pgn", `[LineId "short"]
[LineName "Short line"]

1. e4 {Take the centre.} e5 2. Nf3 Nc6 *
`));

const NOW = new Date("2026-03-01T09:00:00.000Z");

function EventLog({ into }: { into: WorkspaceEvent[] }) {
  const { events } = useWorkspace();
  useEffect(() => events.onAny((event) => into.push(event)), [events, into]);
  return null;
}

function setup(lineId = "short", store = new MemoryProgressStore()) {
  const log: WorkspaceEvent[] = [];
  render(
    <WorkspaceProvider progressStore={store} settingsStore={new LocalStorageSettingsStore(null)} now={() => NOW}>
      <EventLog into={log} />
      <LearnView tree={tree} lineId={lineId} opponentDelayMs={0} />
    </WorkspaceProvider>,
  );
  const user = userEvent.setup();
  const play = async (san: string) => {
    const input = await screen.findByRole("textbox", { name: "Type a move" });
    await waitFor(() => expect(input).toBeEnabled());
    await user.clear(input);
    await user.type(input, `${san}{Enter}`);
  };
  return { store, log, play, user };
}

describe("LearnView", () => {
  test("guides the first pass with a hint arrow and commentary", () => {
    setup();
    expect(screen.getByText("Step 1 of 2: follow the highlighted moves")).toBeInTheDocument();
    expect(document.querySelector('.mc-arrow[data-brush="G"]')).not.toBeNull();
    expect(screen.getByText("Your move 1 of 2")).toBeInTheDocument();
    // The map is decorative while learning: no station buttons in the tab order.
    expect(document.querySelector(".mc-branch-station-button")).toBeNull();
  });

  test("a wrong move is explained and must be corrected", async () => {
    const { play, log } = setup();
    await play("d4");
    expect(screen.getByText(/Not quite\. The course plays e4 here\. Take the centre\. Play e4 to continue\./, { selector: ".mc-sr-only" }))
      .toBeInTheDocument();
    expect(log).toContainEqual({ type: "mistake", played: "d4", expected: "e4" });
    expect(document.querySelector('.mc-feedback[data-state="mistake"]')).not.toBeNull();
  });

  test("two clean passes learn the line and schedule review for tomorrow", async () => {
    const { play, store, log } = setup();
    await play("e4");
    await play("Nf3");
    expect(await screen.findByText("Step 2 of 2: play the line from memory")).toBeInTheDocument();
    await play("e4");
    await play("Nf3");

    expect(await screen.findByText("Learned", { selector: ".mc-learn-phase" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Learned!");
    await waitFor(async () => expect((await store.load()).learnedLines["ruy:white:short"]).toBeDefined());

    const snapshot = await store.load();
    const cards = Object.values(snapshot.cards);
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.status).toBe("review");
      expect(card.fsrs.due).toBe(new Date(NOW.getTime() + DAY_MS).toISOString());
    }
    await waitFor(() => expect(log).toContainEqual({ type: "lineLearned", courseSlug: "ruy", lineId: "short", side: "white" }));
    expect(screen.getByRole("link", { name: "Choose another line" })).toHaveAttribute("href", "/course/ruy");
  });

  test("a recall mistake restarts the pass", async () => {
    const { play } = setup();
    await play("e4");
    await play("Nf3");
    await screen.findByText("Step 2 of 2: play the line from memory");
    await play("d4");
    await play("e4");
    expect(await screen.findByText("Good. Now play the whole line again from the start.", { selector: ".mc-sr-only" }))
      .toBeInTheDocument();
    expect(screen.getByText("Your move 1 of 2")).toBeInTheDocument();
  });

  test("announces the opponent's move when learning as black", async () => {
    localStorage.setItem("moechess:settings", JSON.stringify({ schemaVersion: 1, side: "black" }));
    render(
      <WorkspaceProvider progressStore={new MemoryProgressStore()} settingsStore={new LocalStorageSettingsStore(localStorage)} now={() => NOW}>
        <LearnView tree={tree} lineId="short" opponentDelayMs={0} />
      </WorkspaceProvider>,
    );
    expect(await screen.findByText("White played e4")).toHaveAttribute("aria-live", "polite");
  });

  test("an unknown line explains what to do", () => {
    setup("missing");
    expect(screen.getByRole("alert")).toHaveTextContent("This line isn't in Ruy Lopez. Pick a line from the course page.");
  });

  test("does not announce a learned line when saving fails", async () => {
    const store = new MemoryProgressStore();
    store.saveCards = vi.fn().mockRejectedValue(new Error("disk full"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { play, log } = setup("short", store);
    await play("e4");
    await play("Nf3");
    await play("e4");
    await play("Nf3");

    expect(await screen.findByText("Learned", { selector: ".mc-learn-phase" })).toBeInTheDocument();
    expect(log).not.toContainEqual(expect.objectContaining({ type: "lineLearned" }));
    consoleError.mockRestore();
  });
});
