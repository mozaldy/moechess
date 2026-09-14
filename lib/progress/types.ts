import type { Side } from "@/lib/chess/position";
import type { CardId } from "@/lib/training/cards";

export type CardStatus = "new" | "learning" | "review";

// ts-fsrs Card with dates stored as ISO strings.
export interface StoredFsrsCard {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  learning_steps: number;
  state: number;
  last_review?: string;
}

export interface CardState {
  id: CardId;
  expected: string[];
  fsrs: StoredFsrsCard;
  status: CardStatus;
}

export interface ProgressSnapshotV1 {
  schemaVersion: 1;
  cards: Record<CardId, CardState>;
  learnedLines: Record<string, { learnedAt: string }>;
  explore: Record<string, { lastNodeId: string }>;
}
export type ProgressSnapshot = ProgressSnapshotV1;

export type StoreStatus =
  | { kind: "ok" }
  | { kind: "unavailable" }
  | { kind: "recovered"; backupKey: string }
  | { kind: "newer-schema"; version: number };

export interface ProgressStore {
  load(): Promise<ProgressSnapshot>;
  saveCards(cards: CardState[]): Promise<void>;
  markLineLearned(key: string, learnedAt: string): Promise<void>;
  setExplorePosition(slug: string, nodeId: string): Promise<void>;
  status(): StoreStatus;
}

export function learnedLineKey(slug: string, side: Side, lineId: string): string {
  return `${slug}:${side}:${lineId}`;
}
