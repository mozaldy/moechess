import type { CardId, CardSpec } from "@/lib/training/cards";
import type { CardState } from "./types";

// A card is reset only when its main move changed or a move it accepted is gone.
// Moves that were only added (for example by another course sharing the position)
// are merged into the stored card and keep its schedule.
export function reconcileCards(
  cards: Record<CardId, CardState>,
  specs: Map<CardId, CardSpec>,
  resetCard: (spec: CardSpec) => CardState,
): { cards: Record<CardId, CardState>; dropped: CardId[]; reset: CardId[]; updated: CardId[] } {
  const next: Record<CardId, CardState> = {};
  const dropped: CardId[] = [];
  const reset: CardId[] = [];
  const updated: CardId[] = [];

  for (const card of Object.values(cards)) {
    const spec = specs.get(card.id);
    if (!spec) {
      dropped.push(card.id);
      continue;
    }
    const mainChanged = spec.expected[0] !== card.expected[0];
    const removed = card.expected.some((san) => !spec.expected.includes(san));
    if (mainChanged || removed) {
      next[card.id] = resetCard(spec);
      reset.push(card.id);
    } else if (JSON.stringify(spec.expected) !== JSON.stringify(card.expected)) {
      next[card.id] = { ...card, expected: [...spec.expected] };
      updated.push(card.id);
    } else {
      next[card.id] = card;
    }
  }
  return { cards: next, dropped, reset, updated };
}
