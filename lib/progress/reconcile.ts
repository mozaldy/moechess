import type { CardId, CardSpec } from "@/lib/training/cards";
import type { CardState } from "./types";

export function reconcileCards(
  cards: Record<CardId, CardState>,
  specs: Map<CardId, CardSpec>,
  resetCard: (spec: CardSpec) => CardState,
): { cards: Record<CardId, CardState>; dropped: CardId[]; reset: CardId[] } {
  const next: Record<CardId, CardState> = {};
  const dropped: CardId[] = [];
  const reset: CardId[] = [];

  for (const card of Object.values(cards)) {
    const spec = specs.get(card.id);
    if (!spec) {
      dropped.push(card.id);
    } else if (JSON.stringify(spec.expected) !== JSON.stringify(card.expected)) {
      next[card.id] = resetCard(spec);
      reset.push(card.id);
    } else {
      next[card.id] = card;
    }
  }
  return { cards: next, dropped, reset };
}
