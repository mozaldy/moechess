import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { describe, expect, test } from "vitest";
import { ExploreView } from "@/components/modes/ExploreView";
import { WorkspaceProvider, useWorkspace } from "@/components/workspace/Providers";
import { buildCourseTree, parsePgnFile } from "@/lib/course/build-tree";
import type { CourseMeta } from "@/lib/course/types";
import type { WorkspaceEvent } from "@/lib/events/bus";
import { MemoryProgressStore } from "@/lib/progress/memory-store";
import { learnedLineKey } from "@/lib/progress/types";
import { emptySnapshot } from "@/lib/progress/validate";
import { LocalStorageSettingsStore } from "@/lib/settings/local-storage-store";

const meta: CourseMeta = { slug: "ruy", name: "Ruy Lopez", eco: [], mainSide: "white", credits: [], contentLicense: "CC0" };
const tree = buildCourseTree(meta, parsePgnFile("ruy/lines.pgn", `[LineId "berlin"]
[LineName "Berlin"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 {The Ruy Lopez.} 3... Nf6 4. O-O *

[LineId "morphy"]
[LineName "Morphy"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 *
`));

function EventLog({ into }: { into: WorkspaceEvent[] }) {
  const { events } = useWorkspace();
  useEffect(() => events.onAny((event) => into.push(event)), [events, into]);
  return null;
}

function setup(store = new MemoryProgressStore(), log: WorkspaceEvent[] = [], props: { initialNodeId?: string; orientation?: "white" | "black" } = {}) {
  render(
    <WorkspaceProvider progressStore={store} settingsStore={new LocalStorageSettingsStore(null)}>
      <EventLog into={log} />
      <ExploreView tree={tree} {...props} />
    </WorkspaceProvider>,
  );
  return { store, log, user: userEvent.setup() };
}

const panel = () => within(screen.getByRole("heading", { name: "Ruy Lopez" }).parentElement!);

describe("ExploreView", () => {
  test("a linked node and side override saved display without changing progress or settings", async () => {
    const saved = { ...emptySnapshot(), explore: { ruy: { lastNodeId: "e4" } },
      learnedLines: { [learnedLineKey("ruy", "white", "berlin")]: { learnedAt: "2026-09-20T00:00:00.000Z" } } };
    const { store, user } = setup(new MemoryProgressStore(saved), [], { initialNodeId: "e4 e5 Nf3", orientation: "black" });
    expect(within(await screen.findByRole("list", { name: "Moves played" })).getByRole("button", { name: "2. Nf3" }))
      .toHaveAttribute("aria-current", "step");
    expect(document.querySelector(".mc-board")).toHaveAttribute("data-orientation", "black");
    expect(screen.getByRole("link", { name: "Practise Berlin again" })).toBeInTheDocument();
    expect((await store.load()).explore.ruy.lastNodeId).toBe("e4");
    await user.click(panel().getByRole("button", { name: "Back" }));
    expect((await store.load()).explore.ruy.lastNodeId).toBe("e4 e5");
  });

  test("starts at the beginning with the course moves offered", async () => {
    setup();
    expect(await screen.findByText("Play a move on the board, or pick one of the course moves below.")).toBeInTheDocument();
    expect(panel().getByRole("button", { name: "1. e4" })).toBeInTheDocument();
    expect(screen.getByText("No notes for this move.")).toBeInTheDocument();
  });

  test("playing a course move on the board advances and saves the position", async () => {
    const { store, user } = setup();
    await user.type(screen.getByRole("textbox", { name: "Type a move" }), "e4{Enter}");
    expect(within(screen.getByRole("list", { name: "Moves played" })).getByRole("button", { name: "1. e4" }))
      .toHaveAttribute("aria-current", "step");
    await waitFor(async () => expect((await store.load()).explore.ruy).toEqual({ lastNodeId: "e4" }));
  });

  test("a move outside the course explains what the course plays instead", async () => {
    const { user } = setup();
    await user.type(screen.getByRole("textbox", { name: "Type a move" }), "d4{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("d4 isn't in this course. From here the course plays e4.");
  });

  test("restores the saved position and shows its commentary and lines", async () => {
    const saved = { ...emptySnapshot(), explore: { ruy: { lastNodeId: "e4 e5 Nf3 Nc6 Bb5" } } };
    const { log, user } = setup(new MemoryProgressStore(saved));
    expect(await screen.findByText("The Ruy Lopez.")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Source: Moechess sample notes")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Learn Berlin" })).toHaveAttribute("href", "/course/ruy/learn/berlin");
    expect(screen.getByRole("link", { name: "Learn Morphy" })).toBeInTheDocument();

    await user.click(panel().getByRole("button", { name: "Back" }));
    await user.click(panel().getByRole("button", { name: "Forward" }));
    expect(log).toContainEqual({
      type: "commentaryShown", nodeId: "e4 e5 Nf3 Nc6 Bb5",
      commentary: { text: "The Ruy Lopez.", source: "sample" },
    });
  });

  test("announces the commentary of a restored position", async () => {
    const saved = { ...emptySnapshot(), explore: { ruy: { lastNodeId: "e4 e5 Nf3 Nc6 Bb5" } } };
    const { log } = setup(new MemoryProgressStore(saved));
    expect(await screen.findByText("The Ruy Lopez.")).toBeInTheDocument();
    const shown = log.filter((event) => event.type === "commentaryShown");
    expect(shown).toEqual([
      { type: "commentaryShown", nodeId: "e4 e5 Nf3 Nc6 Bb5", commentary: { text: "The Ruy Lopez.", source: "sample" } },
    ]);
  });

  test("the branch map moves the board", async () => {
    const { user } = setup();
    await user.click(within(screen.getByRole("navigation", { name: "Ruy Lopez lines" })).getByRole("button", { name: "3... a6" }));
    expect(screen.getByRole("link", { name: "Learn Morphy" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Learn Berlin" })).toBeNull();
  });
});
