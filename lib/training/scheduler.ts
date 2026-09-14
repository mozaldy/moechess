import { Rating, State, createEmptyCard, fsrs, generatorParameters, type Card } from "ts-fsrs";
import { sideLetter, type Side } from "@/lib/chess/position";
import type { CardState, CardStatus, StoredFsrsCard } from "@/lib/progress/types";
import type { CardId, CardSpec } from "./cards";

export type ReviewRating = "again" | "good";

export const DAY_MS = 24 * 60 * 60 * 1000;

const engine = fsrs(generatorParameters({ enable_short_term: false }));

function toStored(card: Card): StoredFsrsCard {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    learning_steps: card.learning_steps,
    state: card.state,
    ...(card.last_review ? { last_review: card.last_review.toISOString() } : {}),
  };
}

function fromStored(stored: StoredFsrsCard): Card {
  return {
    ...stored,
    due: new Date(stored.due),
    last_review: stored.last_review ? new Date(stored.last_review) : undefined,
    state: stored.state as State,
  };
}

export function statusOf(state: number): CardStatus {
  if (state === State.New) return "new";
  if (state === State.Review) return "review";
  return "learning";
}

export function newCardState(spec: CardSpec, now: Date): CardState {
  return {
    id: spec.id,
    expected: [...spec.expected],
    fsrs: toStored(createEmptyCard(now)),
    status: "new",
  };
}

export function gradeCard(card: CardState, rating: ReviewRating, now: Date): CardState {
  const grade = rating === "good" ? Rating.Good : Rating.Again;
  const next = engine.next(fromStored(card.fsrs), now, grade).card;
  return { ...card, fsrs: toStored(next), status: statusOf(next.state) };
}

// A newly learned line: every card still "new" gets a Good grade, and its
// first review is pinned to exactly one day later. Cards already in review
// (for example a shared trunk learned through another line) are left alone.
export function learnCards(cards: CardState[], now: Date): CardState[] {
  return cards.map((card) => {
    if (card.status !== "new") return card;
    const graded = gradeCard(card, "good", now);
    return { ...graded, fsrs: { ...graded.fsrs, due: new Date(now.getTime() + DAY_MS).toISOString() } };
  });
}

export function isDue(card: CardState, now: Date): boolean {
  return card.status !== "new" && Date.parse(card.fsrs.due) <= now.getTime();
}

export function dueCards(cards: Record<CardId, CardState>, side: Side, now: Date): CardState[] {
  const prefix = `${sideLetter(side)}:`;
  return Object.values(cards)
    .filter((card) => card.id.startsWith(prefix) && isDue(card, now))
    .sort((a, b) => Date.parse(a.fsrs.due) - Date.parse(b.fsrs.due) || a.id.localeCompare(b.id));
}

// Hook for Chess.com analysis: a learned card the player got wrong in a real game
// becomes due now. Cards never learned stay new.
export function markDeviation(card: CardState, now: Date): CardState {
  if (card.status === "new") return card;
  return { ...card, fsrs: { ...card.fsrs, due: now.toISOString() } };
}
