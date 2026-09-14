import { describe, expect, test } from "vitest";
import { parseSnapshot } from "@/lib/progress/validate";
import type { CardSpec } from "@/lib/training/cards";
import {
  DAY_MS, dueCards, gradeCard, isDue, learnCards, markDeviation, newCardState,
} from "@/lib/training/scheduler";

const T0 = new Date("2026-03-01T09:00:00.000Z");
const at = (days: number) => new Date(T0.getTime() + days * DAY_MS);

const spec = (id: CardSpec["id"], expected = ["e4"]): CardSpec => ({
  id, side: id.startsWith("w") ? "white" : "black", position: id.slice(2),
  fen: "", expected, nodeIds: [], courseSlugs: ["ruy"],
});

describe("scheduler", () => {
  test("new cards are never due", () => {
    const card = newCardState(spec("w:a"), T0);
    expect(card.status).toBe("new");
    expect(isDue(card, at(30))).toBe(false);
  });

  test("learning a line schedules the first review exactly one day later", () => {
    const [learned] = learnCards([newCardState(spec("w:a"), T0)], T0);
    expect(learned.status).toBe("review");
    expect(learned.fsrs.due).toBe(at(1).toISOString());
    expect(isDue(learned, at(0.99))).toBe(false);
    expect(isDue(learned, at(1))).toBe(true);
  });

  test("learning leaves cards that are already in review untouched", () => {
    const [existing] = learnCards([newCardState(spec("w:a"), T0)], T0);
    expect(learnCards([existing], at(5))[0]).toBe(existing);
  });

  test("good pushes the next review further out than again", () => {
    const [learned] = learnCards([newCardState(spec("w:a"), T0)], T0);
    const good = gradeCard(learned, "good", at(1));
    const again = gradeCard(learned, "again", at(1));
    const gap = (c: typeof learned) => Date.parse(c.fsrs.due) - at(1).getTime();
    expect(gap(good)).toBeGreaterThanOrEqual(2 * DAY_MS);
    expect(gap(again)).toBeGreaterThan(0);
    expect(gap(again)).toBeLessThanOrEqual(DAY_MS);
    expect(again.fsrs.lapses).toBe(1);
  });

  test("graded cards pass progress validation after a JSON round trip", () => {
    const [learned] = learnCards([newCardState(spec("w:a"), T0)], T0);
    const graded = gradeCard(JSON.parse(JSON.stringify(learned)), "good", at(1));
    const text = JSON.stringify({ schemaVersion: 1, cards: { [graded.id]: graded }, learnedLines: {}, explore: {} });
    const result = parseSnapshot(text);
    expect(result.kind === "ok" && result.dropped).toBe(0);
  });

  test("dueCards filters by side and sorts by due date", () => {
    const [w1, w2, b1] = learnCards(
      [newCardState(spec("w:a"), T0), newCardState(spec("w:b"), T0), newCardState(spec("b:c"), T0)], T0,
    );
    const later = { ...w1, fsrs: { ...w1.fsrs, due: at(1.5).toISOString() } };
    const cards = { [later.id]: later, [w2.id]: w2, [b1.id]: b1 };
    expect(dueCards(cards, "white", at(2)).map((c) => c.id)).toEqual(["w:b", "w:a"]);
    expect(dueCards(cards, "white", at(1.2)).map((c) => c.id)).toEqual(["w:b"]);
    expect(dueCards(cards, "black", at(2)).map((c) => c.id)).toEqual(["b:c"]);
  });

  test("markDeviation makes a learned card due now and ignores new cards", () => {
    const fresh = newCardState(spec("w:a"), T0);
    expect(markDeviation(fresh, at(3))).toBe(fresh);
    const [learned] = learnCards([fresh], T0);
    const good = gradeCard(learned, "good", at(1));
    const flagged = markDeviation(good, at(2));
    expect(isDue(flagged, at(2))).toBe(true);
  });
});
