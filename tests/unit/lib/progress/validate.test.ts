import { describe, expect, test } from "vitest";
import { emptySnapshot, parseSnapshot } from "@/lib/progress/validate";

const validCard = {
  id: "w:rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -",
  expected: ["e4"],
  status: "review",
  fsrs: {
    due: "2026-01-02T12:00:00.000Z", stability: 2.3, difficulty: 5, elapsed_days: 0,
    scheduled_days: 1, reps: 1, lapses: 0, learning_steps: 0, state: 2,
    last_review: "2026-01-01T12:00:00.000Z",
  },
};

describe("parseSnapshot", () => {
  test("missing data is an empty snapshot", () => {
    expect(parseSnapshot(null)).toEqual({ kind: "ok", snapshot: emptySnapshot(), dropped: 0 });
  });

  test("valid data round-trips", () => {
    const snapshot = {
      schemaVersion: 1,
      cards: { [validCard.id]: validCard },
      learnedLines: { "ruy:white:berlin": { learnedAt: "2026-01-01T12:00:00.000Z" } },
      explore: { ruy: { lastNodeId: "e4 e5" } },
    };
    expect(parseSnapshot(JSON.stringify(snapshot))).toEqual({ kind: "ok", snapshot, dropped: 0 });
  });

  test("invalid records are dropped one by one", () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      cards: {
        [validCard.id]: validCard,
        "w:bad": { ...validCard, id: "w:bad", fsrs: { ...validCard.fsrs, due: "not a date" } },
        "b:mismatch": validCard,
      },
      learnedLines: { ok: { learnedAt: "2026-01-01T00:00:00.000Z" }, bad: { learnedAt: 3 } },
      explore: { ruy: { lastNodeId: 7 } },
    });
    const result = parseSnapshot(text);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(Object.keys(result.snapshot.cards)).toEqual([validCard.id]);
    expect(Object.keys(result.snapshot.learnedLines)).toEqual(["ok"]);
    expect(result.snapshot.explore).toEqual({});
    expect(result.dropped).toBe(4);
  });

  test("unparseable or unversioned data is corrupt", () => {
    expect(parseSnapshot("{not json")).toEqual({ kind: "corrupt" });
    expect(parseSnapshot(JSON.stringify({ cards: {} }))).toEqual({ kind: "corrupt" });
    expect(parseSnapshot(JSON.stringify([1, 2]))).toEqual({ kind: "corrupt" });
  });

  test("a newer schema is reported, not parsed", () => {
    expect(parseSnapshot(JSON.stringify({ schemaVersion: 9 }))).toEqual({ kind: "newer", version: 9 });
  });

  test("migrations run from older versions in order", () => {
    const migrations = {
      0: (raw: Record<string, unknown>) => ({ ...raw, schemaVersion: 1, cards: raw.oldCards, learnedLines: {}, explore: {} }),
    };
    const text = JSON.stringify({ schemaVersion: 0, oldCards: { [validCard.id]: validCard } });
    const result = parseSnapshot(text, migrations, 1);
    expect(result.kind === "ok" && Object.keys(result.snapshot.cards)).toEqual([validCard.id]);
    expect(parseSnapshot(JSON.stringify({ schemaVersion: 0 }), {}, 1)).toEqual({ kind: "corrupt" });
  });
});
