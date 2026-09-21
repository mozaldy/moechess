import type {
  Assessment,
  GameAnalysis,
  PlayerRecord,
  PlayerSnapshot,
} from "@/lib/assessment/types";

export type AssessmentStoreStatus =
  | { kind: "ok" }
  | { kind: "unavailable" | "quota" | "corrupt" | "newer-schema"; message: string };

export interface AssessmentStore {
  status(): AssessmentStoreStatus;
  listPlayers(): Promise<PlayerRecord[]>;
  load(playerKey: string): Promise<PlayerSnapshot | null>;
  saveDraft(snapshot: PlayerSnapshot): Promise<void>;
  commitGame(assessmentId: string, analysis: GameAnalysis): Promise<void>;
  saveState(assessment: Assessment): Promise<void>;
  promoteDraft(playerKey: string, assessmentId: string): Promise<void>;
  deletePlayer(playerKey: string): Promise<void>;
  close(): void;
}

export type AssessmentStoreErrorCode =
  | "invalid"
  | "missing"
  | "conflict"
  | "unavailable"
  | "readonly";

export class AssessmentStoreError extends Error {
  constructor(
    readonly code: AssessmentStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AssessmentStoreError";
  }
}
