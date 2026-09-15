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
const reset = (s: CardSpec): CardState => ({ ...state(s.id, s.expected), status: "new" });

test("drops removed positions, resets a changed main move, keeps the rest", () => {
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

  const result = reconcileCards(cards, specs, reset);

  expect(result.dropped).toEqual(["w:gone"]);
  expect(result.reset).toEqual(["w:changed"]);
  expect(result.updated).toEqual([]);
  expect(Object.keys(result.cards)).toEqual(["w:kept", "w:changed"]);
  expect(result.cards["w:changed"]).toMatchObject({ status: "new", expected: ["Bb5", "Nf3"] });
  expect(result.cards["w:kept"]).toBe(cards["w:kept"]);
});

test("an alternative added after the same main move keeps the schedule and merges expected", () => {
  const cards = { "w:shared": state("w:shared", ["Nf3"]) };
  const specs = new Map<CardId, CardSpec>([["w:shared", spec("w:shared", ["Nf3", "Bc4"])]]);

  const result = reconcileCards(cards, specs, reset);

  expect(result.reset).toEqual([]);
  expect(result.updated).toEqual(["w:shared"]);
  expect(result.cards["w:shared"]).toEqual({ ...cards["w:shared"], expected: ["Nf3", "Bc4"] });
});

test("removing an accepted alternative resets the card", () => {
  const cards = { "w:shared": state("w:shared", ["Nf3", "Bc4"]) };
  const specs = new Map<CardId, CardSpec>([["w:shared", spec("w:shared", ["Nf3"])]]);

  const result = reconcileCards(cards, specs, reset);

  expect(result.reset).toEqual(["w:shared"]);
  expect(result.updated).toEqual([]);
  expect(result.cards["w:shared"]).toMatchObject({ status: "new", expected: ["Nf3"] });
});
