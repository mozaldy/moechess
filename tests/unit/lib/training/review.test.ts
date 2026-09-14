import { describe, expect, test } from "vitest";
import { buildCourseTree, parsePgnFile } from "@/lib/course/build-tree";
import type { CourseMeta, CourseTree } from "@/lib/course/types";
import { learnedLineKey, type CardState, type ProgressSnapshot } from "@/lib/progress/types";
import { cardId, cardsForLine, generateCards, type CardId } from "@/lib/training/cards";
import {
  initReview, nextReview, pickReviewLine, remainingDue, reviewExpectedMove, reviewReducer, reviewTurn,
  type ReviewAction, type ReviewState,
} from "@/lib/training/review";
import { DAY_MS, gradeCard, learnCards, newCardState } from "@/lib/training/scheduler";

const meta: CourseMeta = { slug: "ruy", name: "Ruy", eco: [], mainSide: "white", credits: [], contentLicense: "CC0" };
const tree: CourseTree = buildCourseTree(meta, parsePgnFile("ruy/lines.pgn", `[LineId "berlin"]
[LineName "Berlin"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 4. O-O *

[LineId "morphy"]
[LineName "Morphy"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 *
`));

const T0 = new Date("2026-03-01T09:00:00.000Z");
const at = (days: number) => new Date(T0.getTime() + days * DAY_MS);

function learn(
  snapshot: ProgressSnapshot, lineIds: string[], when: Date,
): ProgressSnapshot {
  const specs = generateCards([tree], "white");
  const next = structuredClone(snapshot);
  for (const lineId of lineIds) {
    const line = tree.lines.find((l) => l.id === lineId)!;
    const ids = cardsForLine(tree, line, "white");
    const states = ids.map((id) => next.cards[id] ?? newCardState(specs.get(id)!, when));
    for (const card of learnCards(states, when)) next.cards[card.id] = card;
    next.learnedLines[learnedLineKey("ruy", "white", lineId)] = { learnedAt: when.toISOString() };
  }
  return next;
}

const empty = (): ProgressSnapshot => ({ schemaVersion: 1, cards: {}, learnedLines: {}, explore: {} });
const run = (state: ReviewState, ...actions: ReviewAction[]) =>
  actions.reduce((s, a) => reviewReducer(tree, s, a), state);

describe("pickReviewLine", () => {
  test("nothing is picked before cards are due or for unlearned lines", () => {
    const snap = learn(empty(), ["berlin"], T0);
    expect(pickReviewLine([tree], snap.cards, snap.learnedLines, "white", at(0.5))).toBeNull();
    expect(pickReviewLine([tree], snap.cards, snap.learnedLines, "black", at(2))).toBeNull();
  });

  test("the learned line with the most due cards wins", () => {
    let snap = learn(empty(), ["berlin"], T0);
    snap = learn(snap, ["morphy"], at(0.5));
    const first = pickReviewLine([tree], snap.cards, snap.learnedLines, "white", at(1.2))!;
    expect(first.line.id).toBe("berlin");
    expect(first.dueIds).toHaveLength(4);

    for (const id of first.dueIds) snap.cards[id] = gradeCard(snap.cards[id], "good", at(1.2));
    const second = pickReviewLine([tree], snap.cards, snap.learnedLines, "white", at(1.6))!;
    expect(second.line.id).toBe("morphy");
    expect(second.dueIds).toEqual([cardId("white", tree.nodes["e4 e5 Nf3 Nc6 Bb5 a6"].position)]);
  });
});

describe("reviewReducer", () => {
  const due = learn(empty(), ["berlin"], T0);
  const start = () => initReview(pickReviewLine([tree], due.cards, due.learnedLines, "white", at(1))!, "white");

  test("a correct first try is graded good and advances", () => {
    const s = run(start(), { type: "play", san: "e4" });
    expect(s.graded).toEqual([{ cardId: cardId("white", tree.nodes.root.position), rating: "good" }]);
    expect(s.feedback).toEqual({ kind: "correct", san: "e4" });
    expect(reviewTurn(tree, s)).toBe("opponent");
    expect(reviewExpectedMove(tree, run(s, { type: "advance" }))).toBe("Nf3");
  });

  test("correct after one wrong attempt is graded again", () => {
    let s = run(start(), { type: "play", san: "d4" });
    expect(s).toMatchObject({ attempts: 1, index: 0, feedback: { kind: "mistake", played: "d4", expected: "e4" } });
    s = run(s, { type: "play", san: "e4" });
    expect(s.graded.at(-1)?.rating).toBe("again");
    expect(s.attempts).toBe(0);
  });

  test("a second wrong attempt reveals the answer, grades again and auto-plays it", () => {
    const s = run(start(), { type: "play", san: "d4" }, { type: "play", san: "c4" });
    expect(s.feedback).toEqual({ kind: "revealed", played: "c4", expected: "e4" });
    expect(s.graded).toEqual([{ cardId: cardId("white", tree.nodes.root.position), rating: "again" }]);
    expect(reviewTurn(tree, s)).toBe("auto");
    expect(run(s, { type: "advance" }).index).toBe(1);
  });

  test("moves that are not due are auto-played", () => {
    const partly = structuredClone(due);
    const rootId = cardId("white", tree.nodes.root.position) as CardId;
    partly.cards[rootId] = gradeCard(partly.cards[rootId] as CardState, "good", at(1));
    const s = initReview(pickReviewLine([tree], partly.cards, partly.learnedLines, "white", at(1))!, "white");
    expect(reviewTurn(tree, s)).toBe("auto");
    expect(run(s, { type: "play", san: "e4" })).toBe(s);
    expect(reviewTurn(tree, run(s, { type: "advance" }))).toBe("opponent");
  });

  test("the line is done once every due card is graded", () => {
    let s = start();
    while (reviewTurn(tree, s) !== "done") {
      s = reviewTurn(tree, s) === "learner"
        ? run(s, { type: "play", san: reviewExpectedMove(tree, s)! })
        : run(s, { type: "advance" });
    }
    expect(remainingDue(s)).toEqual([]);
    expect(s.graded.map((g) => g.rating)).toEqual(["good", "good", "good", "good"]);
  });

  test("illegal moves and moves out of turn are ignored", () => {
    const s = start();
    expect(run(s, { type: "play", san: "Ke2" })).toBe(s);
    expect(run(s, { type: "advance" })).toBe(s);
  });

  test("another course move gets a note without counting as an attempt", () => {
    const withAlternative = buildCourseTree(meta, parsePgnFile("ruy/lines.pgn", `[LineId "morphy"]
[LineName "Morphy"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 (4. Bxc6 dxc6) *
`));
    const line = withAlternative.lines[0];
    const specs = generateCards([withAlternative], "white");
    const cards = Object.fromEntries(
      learnCards(cardsForLine(withAlternative, line, "white").map((id) => newCardState(specs.get(id)!, T0)), T0)
        .map((card) => [card.id, card]),
    );
    const learned = { [learnedLineKey("ruy", "white", "morphy")]: { learnedAt: T0.toISOString() } };
    const step = (s: ReviewState, action: ReviewAction) => reviewReducer(withAlternative, s, action);

    let s = initReview(pickReviewLine([withAlternative], cards, learned, "white", at(1))!, "white");
    while (reviewExpectedMove(withAlternative, s) !== "Ba4") {
      s = reviewTurn(withAlternative, s) === "learner"
        ? step(s, { type: "play", san: reviewExpectedMove(withAlternative, s)! })
        : step(s, { type: "advance" });
    }
    const before = s.graded.length;
    s = step(s, { type: "play", san: "Bxc6" });
    expect(s.feedback).toEqual({ kind: "alternative", played: "Bxc6", expected: "Ba4" });
    expect(s.attempts).toBe(0);
    expect(s.graded).toHaveLength(before);
    expect(step(s, { type: "play", san: "Ba4" }).graded.at(-1)?.rating).toBe("good");
  });
});

describe("nextReview", () => {
  test("stops at the session size or when nothing is due", () => {
    const snap = learn(empty(), ["berlin"], T0);
    expect(nextReview([tree], snap, "white", at(1), 0)?.lineId).toBe("berlin");
    expect(nextReview([tree], snap, "white", at(1), 20)).toBeNull();
    expect(nextReview([tree], snap, "white", at(1), 3, 3)).toBeNull();
    expect(nextReview([tree], snap, "white", at(0.5), 0)).toBeNull();
  });
});
