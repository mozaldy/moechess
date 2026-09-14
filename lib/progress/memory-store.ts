import type { CardState, ProgressSnapshot, ProgressStore, StoreStatus } from "./types";
import { emptySnapshot } from "./validate";

export class MemoryProgressStore implements ProgressStore {
  private snapshot: ProgressSnapshot;
  private readonly currentStatus: StoreStatus;

  constructor(initial: ProgressSnapshot = emptySnapshot(), status: StoreStatus = { kind: "ok" }) {
    this.snapshot = structuredClone(initial);
    this.currentStatus = status;
  }

  async load(): Promise<ProgressSnapshot> {
    return structuredClone(this.snapshot);
  }

  async saveCards(cards: CardState[]): Promise<void> {
    for (const card of cards) this.snapshot.cards[card.id] = structuredClone(card);
  }

  async markLineLearned(key: string, learnedAt: string): Promise<void> {
    this.snapshot.learnedLines[key] = { learnedAt };
  }

  async setExplorePosition(slug: string, nodeId: string): Promise<void> {
    this.snapshot.explore[slug] = { lastNodeId: nodeId };
  }

  status(): StoreStatus {
    return this.currentStatus;
  }
}
