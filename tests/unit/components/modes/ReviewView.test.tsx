import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { describe, expect, test } from "vitest";
import { ReviewView } from "@/components/modes/ReviewView";
import { WorkspaceProvider, useWorkspace } from "@/components/workspace/Providers";
import { buildCourseTree, parsePgnFile } from "@/lib/course/build-tree";
import type { CourseMeta } from "@/lib/course/types";
import type { WorkspaceEvent } from "@/lib/events/bus";
import { MemoryProgressStore } from "@/lib/progress/memory-store";
import { learnedLineKey, type ProgressSnapshot } from "@/lib/progress/types";
import { emptySnapshot } from "@/lib/progress/validate";
import { LocalStorageSettingsStore } from "@/lib/settings/local-storage-store";
import { cardsForLine, generateCards } from "@/lib/training/cards";
import { DAY_MS, learnCards, newCardState } from "@/lib/training/scheduler";

const meta: CourseMeta = { slug: "ruy", name: "Ruy Lopez", eco: [], mainSide: "white", credits: [], contentLicense: "CC0" };
const tree = buildCourseTree(meta, parsePgnFile("ruy/lines.pgn", `[LineId "short"]
[LineName "Short line"]

1. e4 e5 2. Nf3 {Attacks e5.} 2... Nc6 *
`));

const NOW = new Date("2026-03-02T09:00:00.000Z");
const LEARNED_AT = new Date(NOW.getTime() - DAY_MS);

function learnedSnapshot(): ProgressSnapshot {
  const specs = generateCards([tree], "white");
  const snapshot = emptySnapshot();
  const cards = learnCards(cardsForLine(tree, tree.lines[0], "white").map((id) => newCardState(specs.get(id)!, LEARNED_AT)), LEARNED_AT);
  for (const card of cards) snapshot.cards[card.id] = card;
  snapshot.learnedLines[learnedLineKey("ruy", "white", "short")] = { learnedAt: LEARNED_AT.toISOString() };
  return snapshot;
}

function EventLog({ into }: { into: WorkspaceEvent[] }) {
  const { events } = useWorkspace();
  useEffect(() => events.onAny((event) => into.push(event)), [events, into]);
  return null;
}

function setup(snapshot: ProgressSnapshot) {
  const store = new MemoryProgressStore(snapshot);
  const log: WorkspaceEvent[] = [];
  render(
    <WorkspaceProvider progressStore={store} settingsStore={new LocalStorageSettingsStore(null)} now={() => NOW}>
      <EventLog into={log} />
      <ReviewView trees={[tree]} opponentDelayMs={0} autoDelayMs={0} revealDelayMs={400} />
    </WorkspaceProvider>,
  );
  const user = userEvent.setup();
  const play = async (san: string) => {
    const input = await screen.findByRole("textbox", { name: "Type a move" });
    await waitFor(() => expect(input).toBeEnabled());
    await user.type(input, `${san}{Enter}`);
  };
  return { store, log, play };
}

describe("ReviewView", () => {
  test("says when nothing is due", async () => {
    setup(emptySnapshot());
    expect(await screen.findByRole("heading", { name: "Nothing is due right now" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to courses" })).toHaveAttribute("href", "/");
  });

  test("reviews due positions, saves grades and summarises the session", async () => {
    const { play, store, log } = setup(learnedSnapshot());
    expect(await screen.findByRole("heading", { name: "Short line" })).toBeInTheDocument();
    await play("e4");
    await play("Nf3");
    expect(await screen.findByRole("heading", { name: "Review done" })).toBeInTheDocument();
    expect(screen.getByText("2 remembered, 0 to practise again.")).toBeInTheDocument();

    const cards = Object.values((await store.load()).cards);
    for (const card of cards) expect(Date.parse(card.fsrs.due)).toBeGreaterThan(NOW.getTime() + DAY_MS);
    expect(log.filter((e) => e.type === "cardReviewed").map((e) => e.type === "cardReviewed" && e.rating)).toEqual(["good", "good"]);
    await waitFor(() => expect(log).toContainEqual({
      type: "sessionEnded", mode: "review", stats: { graded: 2, good: 2, again: 0, mistakes: 0 },
    }));
  });

  test("two wrong tries reveal the answer and grade the position again", async () => {
    const { play, store } = setup(learnedSnapshot());
    await play("d4");
    expect(await screen.findByText("d4 isn't the course move. Try again.", { selector: ".mc-sr-only" })).toBeInTheDocument();
    await play("c4");
    expect(await screen.findByText("The course plays e4 here. This position comes back soon.", { selector: ".mc-sr-only" }))
      .toBeInTheDocument();

    await waitFor(async () => {
      const lapsed = Object.values((await store.load()).cards).filter((card) => card.fsrs.lapses === 1);
      expect(lapsed).toHaveLength(1);
    });
    await play("Nf3");
    expect(await screen.findByText("1 remembered, 1 to practise again.")).toBeInTheDocument();
  });
});
