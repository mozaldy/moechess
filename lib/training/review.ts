import { applySan, sanEquals, turnOf, type Side } from "@/lib/chess/position";
import type { CourseNode, CourseTree, Line } from "@/lib/course/types";
import { learnedLineKey, type CardState, type ProgressSnapshot } from "@/lib/progress/types";
import { cardId, cardsForLine, type CardId } from "./cards";
import { isDue, type ReviewRating } from "./scheduler";

export const DEFAULT_SESSION_SIZE = 20;

export interface ReviewPick {
  tree: CourseTree;
  line: Line;
  dueIds: CardId[];
}

export type ReviewFeedback =
  | { kind: "correct"; san: string }
  | { kind: "alternative"; played: string; expected: string }
  | { kind: "mistake"; played: string; expected: string }
  | { kind: "revealed"; played: string; expected: string };

export interface ReviewState {
  side: Side;
  courseSlug: string;
  lineId: string;
  path: string[]; // [rootId, ...line.nodeIds]
  index: number;
  dueIds: CardId[];
  attempts: number; // wrong attempts on the current card
  feedback: ReviewFeedback | null;
  graded: { cardId: CardId; rating: ReviewRating }[];
}

export type ReviewAction = { type: "play"; san: string } | { type: "advance" };

// learner: a due card is waiting for the learner's move
// auto: the learner's move here is not being tested; play it automatically
// opponent: the course plays the opponent's move
export type ReviewTurn = "learner" | "auto" | "opponent" | "done";

// The learned line with the most due cards wins; ties keep course and line order.
export function pickReviewLine(
  trees: CourseTree[],
  cards: Record<CardId, CardState>,
  learnedLines: ProgressSnapshot["learnedLines"],
  side: Side,
  now: Date,
): ReviewPick | null {
  let best: ReviewPick | null = null;
  for (const tree of trees) {
    for (const line of tree.lines) {
      if (!learnedLines[learnedLineKey(tree.meta.slug, side, line.id)]) continue;
      const dueIds = cardsForLine(tree, line, side).filter((id) => cards[id] && isDue(cards[id], now));
      if (dueIds.length > (best?.dueIds.length ?? 0)) best = { tree, line, dueIds };
    }
  }
  return best;
}

export function initReview(pick: ReviewPick, side: Side): ReviewState {
  return {
    side,
    courseSlug: pick.tree.meta.slug,
    lineId: pick.line.id,
    path: [pick.tree.rootId, ...pick.line.nodeIds],
    index: 0,
    dueIds: pick.dueIds,
    attempts: 0,
    feedback: null,
    graded: [],
  };
}

export function nextReview(
  trees: CourseTree[],
  snapshot: ProgressSnapshot,
  side: Side,
  now: Date,
  gradedSoFar: number,
  sessionSize: number = DEFAULT_SESSION_SIZE,
): ReviewState | null {
  if (gradedSoFar >= sessionSize) return null;
  const pick = pickReviewLine(trees, snapshot.cards, snapshot.learnedLines, side, now);
  return pick ? initReview(pick, side) : null;
}

export function reviewNode(tree: CourseTree, state: ReviewState): CourseNode {
  return tree.nodes[state.path[state.index]];
}

export function reviewExpectedMove(tree: CourseTree, state: ReviewState): string | null {
  const nextId = state.path[state.index + 1];
  return nextId ? tree.nodes[nextId].san : null;
}

function isGraded(state: ReviewState, id: CardId): boolean {
  return state.graded.some((g) => g.cardId === id);
}

export function remainingDue(state: ReviewState): CardId[] {
  return state.dueIds.filter((id) => !isGraded(state, id));
}

export function reviewTurn(tree: CourseTree, state: ReviewState): ReviewTurn {
  if (state.index >= state.path.length - 1 || remainingDue(state).length === 0) return "done";
  const node = reviewNode(tree, state);
  if (turnOf(node.position) !== state.side) return "opponent";
  const id = cardId(state.side, node.position);
  return state.dueIds.includes(id) && !isGraded(state, id) ? "learner" : "auto";
}

export function reviewReducer(tree: CourseTree, state: ReviewState, action: ReviewAction): ReviewState {
  const turn = reviewTurn(tree, state);

  if (action.type === "advance") {
    if (turn !== "opponent" && turn !== "auto") return state;
    return { ...state, index: state.index + 1, attempts: 0, feedback: null };
  }

  if (turn !== "learner") return state;
  const node = reviewNode(tree, state);
  const expected = reviewExpectedMove(tree, state) as string;
  const id = cardId(state.side, node.position);

  if (sanEquals(node.fen, action.san, expected)) {
    const rating: ReviewRating = state.attempts === 0 ? "good" : "again";
    return {
      ...state,
      index: state.index + 1,
      attempts: 0,
      feedback: { kind: "correct", san: expected },
      graded: [...state.graded, { cardId: id, rating }],
    };
  }

  const applied = applySan(node.fen, action.san);
  if (!applied) return state;

  if (node.children.some((childId) => tree.nodes[childId].san === applied.san)) {
    return { ...state, feedback: { kind: "alternative", played: applied.san, expected } };
  }

  const attempts = state.attempts + 1;
  if (attempts >= 2) {
    return {
      ...state,
      attempts,
      feedback: { kind: "revealed", played: applied.san, expected },
      graded: [...state.graded, { cardId: id, rating: "again" }],
    };
  }
  return { ...state, attempts, feedback: { kind: "mistake", played: applied.san, expected } };
}
