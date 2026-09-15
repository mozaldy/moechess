import { sideLetter, type Side } from "@/lib/chess/position";
import type { CourseTree } from "@/lib/course/types";
import { reconcileCards } from "@/lib/progress/reconcile";
import type { CardState } from "@/lib/progress/types";
import { generateCards, type CardId } from "./cards";
import { newCardState } from "./scheduler";

// Brings stored cards for one side in line with every course: positions no course
// has are left out, cards whose main move changed (or lost an accepted move) come
// back as new, and cards that only gained moves keep their schedule with the merged
// expected list. `reset` and `updated` name the cards that should be saved.
export function reconcileProgressCards(
  trees: CourseTree[],
  side: Side,
  cards: Record<CardId, CardState>,
  now: Date,
): { cards: Record<CardId, CardState>; reset: CardId[]; updated: CardId[] } {
  const prefix = `${sideLetter(side)}:`;
  const ownSide = Object.fromEntries(
    Object.entries(cards).filter(([id]) => id.startsWith(prefix)),
  ) as Record<CardId, CardState>;
  const { cards: reconciled, reset, updated } = reconcileCards(
    ownSide, generateCards(trees, side), (spec) => newCardState(spec, now),
  );
  return { cards: reconciled, reset, updated };
}
