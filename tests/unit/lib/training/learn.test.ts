import { describe, expect, test } from "vitest";
import { buildCourseTree, parsePgnFile } from "@/lib/course/build-tree";
import type { CourseMeta, CourseTree } from "@/lib/course/types";
import {
  expectedMove, initLearn, learnReducer, learnTurn, type LearnAction, type LearnState,
} from "@/lib/training/learn";

const meta: CourseMeta = { slug: "ruy", name: "Ruy", eco: [], mainSide: "white", credits: [], contentLicense: "CC0" };
const tree: CourseTree = buildCourseTree(meta, parsePgnFile("ruy/lines.pgn", `[LineId "berlin"]
[LineName "Berlin"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 4. O-O *

[LineId "morphy"]
[LineName "Morphy"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 *
`));
const [berlin, morphy] = tree.lines;

const run = (state: LearnState, ...actions: LearnAction[]) =>
  actions.reduce((s, a) => learnReducer(tree, s, a), state);

// Plays expected moves for both sides until the current pass ends.
function playPass(state: LearnState): LearnState {
  let s = state;
  const phase = s.phase;
  while (s.phase === phase && learnTurn(tree, s) !== "done") {
    s = learnTurn(tree, s) === "learner"
      ? learnReducer(tree, s, { type: "play", san: expectedMove(tree, s)! })
      : learnReducer(tree, s, { type: "opponentMoved" });
  }
  return s;
}

describe("learn mode as white", () => {
  test("starts guided with the learner to move", () => {
    const s = initLearn(tree, berlin, "white");
    expect(s).toMatchObject({ phase: "guided", index: 0, feedback: null });
    expect(learnTurn(tree, s)).toBe("learner");
    expect(expectedMove(tree, s)).toBe("e4");
  });

  test("a correct move advances and hands the turn to the opponent", () => {
    const s = run(initLearn(tree, berlin, "white"), { type: "play", san: "e4" });
    expect(s).toMatchObject({ index: 1, feedback: { kind: "correct", san: "e4" } });
    expect(learnTurn(tree, s)).toBe("opponent");
    const after = run(s, { type: "opponentMoved" });
    expect(after).toMatchObject({ index: 2, feedback: null });
    expect(expectedMove(tree, after)).toBe("Nf3");
  });

  test("finishing the guided pass starts the recall pass from the beginning", () => {
    const s = playPass(initLearn(tree, berlin, "white"));
    expect(s).toMatchObject({ phase: "recall", index: 0 });
  });

  test("a clean recall pass completes the line", () => {
    const s = playPass(playPass(initLearn(tree, berlin, "white")));
    expect(s.phase).toBe("completed");
    expect(learnTurn(tree, s)).toBe("done");
  });

  test("a guided mistake must be corrected but does not restart", () => {
    const s = run(initLearn(tree, berlin, "white"), { type: "play", san: "d4" });
    expect(s).toMatchObject({ index: 0, feedback: { kind: "mistake", played: "d4", expected: "e4", nodeId: "root" } });
    expect(run(s, { type: "play", san: "e4" })).toMatchObject({ phase: "guided", index: 1 });
  });

  test("a recall mistake is corrected and then the pass restarts", () => {
    let s = playPass(initLearn(tree, berlin, "white"));
    s = run(s, { type: "play", san: "e4" }, { type: "opponentMoved" }, { type: "play", san: "Nf3" }, { type: "opponentMoved" });
    expect(expectedMove(tree, s)).toBe("Bb5");
    s = run(s, { type: "play", san: "Bc4" });
    expect(s.feedback).toMatchObject({ kind: "mistake", expected: "Bb5" });
    s = run(s, { type: "play", san: "Bb5" });
    expect(s).toMatchObject({ phase: "recall", index: 0, feedback: { kind: "restarted" } });
  });

  test("moves out of turn and illegal moves are ignored", () => {
    const opponentTurn = run(initLearn(tree, berlin, "white"), { type: "play", san: "e4" });
    expect(run(opponentTurn, { type: "play", san: "e5" })).toBe(opponentTurn);
    const start = initLearn(tree, berlin, "white");
    expect(run(start, { type: "play", san: "Ke2" })).toBe(start);
    expect(run(start, { type: "opponentMoved" })).toBe(start);
  });

  test("restart returns to the guided pass", () => {
    const s = run(playPass(initLearn(tree, berlin, "white")), { type: "restart" });
    expect(s).toMatchObject({ phase: "guided", index: 0, feedback: null });
  });
});

describe("learn mode as black", () => {
  test("the opponent moves first", () => {
    const s = initLearn(tree, morphy, "black");
    expect(learnTurn(tree, s)).toBe("opponent");
    expect(expectedMove(tree, run(s, { type: "opponentMoved" }))).toBe("e5");
  });

  test("another course move is accepted with a note, not graded as a mistake", () => {
    let s = run(initLearn(tree, morphy, "black"), { type: "opponentMoved" }, { type: "play", san: "e5" },
      { type: "opponentMoved" }, { type: "play", san: "Nc6" }, { type: "opponentMoved" });
    expect(expectedMove(tree, s)).toBe("a6");
    s = run(s, { type: "play", san: "Nf6" });
    expect(s.feedback).toEqual({ kind: "alternative", played: "Nf6", expected: "a6" });
    expect(s.index).toBe(5);
    expect(run(s, { type: "play", san: "a6" }).index).toBe(6);
  });
});
