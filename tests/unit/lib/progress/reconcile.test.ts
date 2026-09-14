import { expect, test } from "vitest";
import { reconcileCards } from "@/lib/progress/reconcile";
import type { CardState } from "@/lib/progress/types";
import type { CardId, CardSpec } from "@/lib/training/cards";

const fsrs = {
  due: "2026-01-02T00:00:00.000Z", stability: 2, difficulty: 5, elapsed_days: 0,
  scheduled_days: 1, reps: 1, lapses: 0, learning_steps: 0, state: 2,
};
const state = (id: CardId, expected: string[]): CardState => ({ id, expected, fsrs, status: "review" });
const spec = (id: CardId, expected: string[]): CardSpec => ({
  id, side: "white", position: id.slice(2), fen: "", expected, nodeIds: [], courseSlugs: [],
});

test("drops removed positions, resets changed moves, keeps the rest", () => {
  const cards = {
    "w:kept": state("w:kept", ["e4"]),
    "w:gone": state("w:gone", ["d4"]),
    "w:changed": state("w:changed", ["Nf3"]),
  };
  const specs = new Map<CardId, CardSpec>([
    ["w:kept", spec("w:kept", ["e4"])],
    ["w:changed", spec("w:changed", ["Bb5", "Nf3"])],
    ["w:unseen", spec("w:unseen", ["c4"])],
  ]);
  const reset = (s: CardSpec): CardState => ({ ...state(s.id, s.expected), status: "new" });

  const result = reconcileCards(cards, specs, reset);

  expect(result.dropped).toEqual(["w:gone"]);
  expect(result.reset).toEqual(["w:changed"]);
  expect(Object.keys(result.cards)).toEqual(["w:kept", "w:changed"]);
  expect(result.cards["w:changed"]).toMatchObject({ status: "new", expected: ["Bb5", "Nf3"] });
  expect(result.cards["w:kept"]).toBe(cards["w:kept"]);
});
