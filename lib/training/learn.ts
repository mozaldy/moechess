import { applySan, sanEquals, turnOf, type Side } from "@/lib/chess/position";
import type { CourseNode, CourseTree, Line } from "@/lib/course/types";

export type LearnPhase = "guided" | "recall" | "completed";

export type LearnFeedback =
  | { kind: "correct"; san: string }
  | { kind: "alternative"; played: string; expected: string }
  | { kind: "mistake"; played: string; expected: string; nodeId: string }
  | { kind: "restarted" };

export interface LearnState {
  lineId: string;
  side: Side;
  phase: LearnPhase;
  path: string[]; // [rootId, ...line.nodeIds]
  index: number; // the board shows path[index]
  feedback: LearnFeedback | null;
}

export type LearnAction =
  | { type: "play"; san: string }
  | { type: "opponentMoved" }
  | { type: "restart" };

export type LearnTurn = "learner" | "opponent" | "done";

export function initLearn(tree: CourseTree, line: Line, side: Side): LearnState {
  return {
    lineId: line.id, side, phase: "guided",
    path: [tree.rootId, ...line.nodeIds], index: 0, feedback: null,
  };
}

export function currentNode(tree: CourseTree, state: LearnState): CourseNode {
  return tree.nodes[state.path[state.index]];
}

export function expectedMove(tree: CourseTree, state: LearnState): string | null {
  const nextId = state.path[state.index + 1];
  return nextId ? tree.nodes[nextId].san : null;
}

export function learnTurn(tree: CourseTree, state: LearnState): LearnTurn {
  if (state.phase === "completed" || state.index >= state.path.length - 1) return "done";
  return turnOf(currentNode(tree, state).position) === state.side ? "learner" : "opponent";
}

function advance(state: LearnState): LearnState {
  const index = state.index + 1;
  if (index < state.path.length - 1) return { ...state, index };
  if (state.phase === "guided") return { ...state, phase: "recall", index: 0 };
  return { ...state, phase: "completed", index };
}

export function learnReducer(tree: CourseTree, state: LearnState, action: LearnAction): LearnState {
  switch (action.type) {
    case "restart":
      return { ...state, phase: "guided", index: 0, feedback: null };

    case "opponentMoved":
      if (learnTurn(tree, state) !== "opponent") return state;
      return advance({ ...state, feedback: null });

    case "play": {
      if (learnTurn(tree, state) !== "learner") return state;
      const node = currentNode(tree, state);
      const expected = expectedMove(tree, state) as string;

      if (sanEquals(node.fen, action.san, expected)) {
        if (state.phase === "recall" && state.feedback?.kind === "mistake") {
          return { ...state, index: 0, feedback: { kind: "restarted" } };
        }
        return advance({ ...state, feedback: { kind: "correct", san: expected } });
      }

      const applied = applySan(node.fen, action.san);
      if (!applied) return state;

      const accepted = node.children.some((id) => tree.nodes[id].san === applied.san);
      if (accepted && state.feedback?.kind !== "mistake") {
        return { ...state, feedback: { kind: "alternative", played: applied.san, expected } };
      }
      return { ...state, feedback: { kind: "mistake", played: applied.san, expected, nodeId: node.id } };
    }
  }
}
