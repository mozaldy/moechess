import type {
  Assessment,
  GameAnalysis,
  ImportedGame,
  PlayerRecord,
  PlayerSnapshot,
} from "@/lib/assessment/types";
import type { AssessmentStore, AssessmentStoreStatus } from "./types";
import { AssessmentStoreError } from "./types";
import {
  compatibleAnalysis,
  isAssessment,
  isGameAnalysis,
  isImportedGame,
  isPlayerRecord,
  pauseOrphanedJob,
  validateSnapshot,
} from "./validate";

interface PlayerEnvelope extends PlayerRecord {
  currentId: string | null;
  draftId: string | null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function gameKey(playerKey: string, gameId: string): string {
  return JSON.stringify([playerKey, gameId]);
}

function analysisKey(analysis: GameAnalysis): string {
  return JSON.stringify([
    analysis.playerKey,
    analysis.gameId,
    analysis.fingerprint,
    analysis.signature,
  ]);
}

export class MemoryAssessmentStore implements AssessmentStore {
  private readonly players = new Map<string, PlayerEnvelope>();
  private readonly assessments = new Map<string, Assessment>();
  private readonly games = new Map<string, ImportedGame>();
  private readonly analyses = new Map<string, GameAnalysis>();
  private currentStatus: AssessmentStoreStatus = { kind: "ok" };

  status(): AssessmentStoreStatus {
    return clone(this.currentStatus);
  }

  async listPlayers(): Promise<PlayerRecord[]> {
    return [...this.players.values()]
      .map((envelope) => clone({
        key: envelope.key,
        displayName: envelope.displayName,
        ...(envelope.lastImportAt ? { lastImportAt: envelope.lastImportAt } : {}),
        ...(envelope.refreshAfter ? { refreshAfter: envelope.refreshAfter } : {}),
      }))
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  async load(playerKey: string): Promise<PlayerSnapshot | null> {
    const envelope = this.players.get(playerKey);
    if (!envelope || !isPlayerRecord(envelope)) return null;

    const rawAssessments = [envelope.currentId, envelope.draftId]
      .map((id) => id ? this.assessments.get(id) : undefined);
    if ((envelope.currentId && !rawAssessments[0]) || (envelope.draftId && !rawAssessments[1])) {
      this.markCorrupt("A saved assessment reference is missing.");
    }
    const current = isAssessment(rawAssessments[0]) && rawAssessments[0].playerKey === playerKey
      ? pauseOrphanedJob(rawAssessments[0])
      : null;
    const draft = isAssessment(rawAssessments[1]) && rawAssessments[1].playerKey === playerKey
      ? pauseOrphanedJob(rawAssessments[1])
      : null;
    const referenced = [current, draft].filter((value): value is Assessment => value !== null);
    const games = [...this.games.values()]
      .filter((game) => isImportedGame(game) && game.playerKey === playerKey)
      .sort((left, right) => left.id.localeCompare(right.id));
    const gameById = new Map(games.map((game) => [game.id, game]));
    const analyses = [...this.analyses.values()]
      .filter((analysis) => {
        if (!isGameAnalysis(analysis) || analysis.playerKey !== playerKey) return false;
        const game = gameById.get(analysis.gameId);
        return game !== undefined && compatibleAnalysis(analysis, game, referenced);
      })
      .sort((left, right) => left.gameId.localeCompare(right.gameId));
    const completed = new Set(analyses.map((analysis) => `${analysis.signature}\0${analysis.gameId}`));
    const reconcile = (assessment: Assessment | null) => assessment && ({
      ...assessment,
      completedIds: assessment.completedIds.filter((id) => completed.has(`${assessment.signature}\0${id}`)),
    });

    return clone({
      player: {
        key: envelope.key,
        displayName: envelope.displayName,
        ...(envelope.lastImportAt ? { lastImportAt: envelope.lastImportAt } : {}),
        ...(envelope.refreshAfter ? { refreshAfter: envelope.refreshAfter } : {}),
      },
      current: reconcile(current),
      draft: reconcile(draft),
      games,
      analyses,
    });
  }

  async saveDraft(snapshot: PlayerSnapshot): Promise<void> {
    if (!validateSnapshot(snapshot)) throw new AssessmentStoreError("invalid", "Invalid player snapshot");
    const copy = clone(snapshot);
    const referenced = [copy.current, copy.draft].filter((item): item is Assessment => item !== null);
    for (const analysis of copy.analyses) {
      const game = copy.games.find((candidate) => candidate.id === analysis.gameId);
      if (!game || !compatibleAnalysis(analysis, game, referenced)) {
        throw new AssessmentStoreError("invalid", "Snapshot contains an incompatible analysis");
      }
    }
    for (const assessment of [copy.current, copy.draft]) {
      if (!assessment) continue;
      const existing = this.assessments.get(assessment.id);
      if (existing && existing.playerKey !== copy.player.key) {
        throw new AssessmentStoreError("conflict", "Assessment ID belongs to another player");
      }
    }

    const oldEnvelope = this.players.get(copy.player.key);
    if (oldEnvelope?.draftId && oldEnvelope.draftId !== copy.draft?.id) {
      this.assessments.delete(oldEnvelope.draftId);
    }
    this.players.set(copy.player.key, {
      ...copy.player,
      currentId: copy.current?.id ?? null,
      draftId: copy.draft?.id ?? null,
    });
    if (copy.current) this.assessments.set(copy.current.id, copy.current);
    if (copy.draft) this.assessments.set(copy.draft.id, copy.draft);
    for (const game of copy.games) this.games.set(gameKey(game.playerKey, game.id), game);
    for (const analysis of copy.analyses) {
      this.analyses.set(analysisKey(analysis), analysis);
    }
  }

  async commitGame(assessmentId: string, analysis: GameAnalysis): Promise<void> {
    if (!isGameAnalysis(analysis)) throw new AssessmentStoreError("invalid", "Invalid game analysis");
    const assessment = this.assessments.get(assessmentId);
    if (!assessment) throw new AssessmentStoreError("missing", "Assessment no longer exists");
    if (assessment.playerKey !== analysis.playerKey
      || assessment.signature !== analysis.signature
      || !assessment.selectedIds.includes(analysis.gameId)) {
      throw new AssessmentStoreError("conflict", "Analysis does not match the assessment");
    }
    const game = this.games.get(gameKey(analysis.playerKey, analysis.gameId));
    if (!game || game.fingerprint !== analysis.fingerprint) {
      throw new AssessmentStoreError("conflict", "Analysis does not match the imported game");
    }

    const nextAssessment = clone({
      ...assessment,
      completedIds: [...new Set([...assessment.completedIds, analysis.gameId])],
      updatedAt: analysis.completedAt,
    });
    const nextAnalysis = clone(analysis);
    this.analyses.set(analysisKey(nextAnalysis), nextAnalysis);
    this.assessments.set(assessmentId, nextAssessment);
  }

  async saveState(assessment: Assessment): Promise<void> {
    if (!isAssessment(assessment)) throw new AssessmentStoreError("invalid", "Invalid assessment state");
    const existing = this.assessments.get(assessment.id);
    if (!existing) throw new AssessmentStoreError("missing", "Assessment no longer exists");
    if (existing.playerKey !== assessment.playerKey) {
      throw new AssessmentStoreError("conflict", "Assessment belongs to another player");
    }
    this.assessments.set(assessment.id, clone(assessment));
  }

  async promoteDraft(playerKey: string, assessmentId: string): Promise<void> {
    const envelope = this.players.get(playerKey);
    const draft = this.assessments.get(assessmentId);
    if (!envelope || envelope.draftId !== assessmentId || !draft || draft.playerKey !== playerKey) {
      throw new AssessmentStoreError("missing", "Draft no longer exists");
    }

    for (const [id, assessment] of this.assessments) {
      if (assessment.playerKey === playerKey && id !== assessmentId) this.assessments.delete(id);
    }
    envelope.currentId = assessmentId;
    envelope.draftId = null;
    const selected = new Set(draft.selectedIds);
    for (const [key, game] of this.games) {
      if (game.playerKey === playerKey && !selected.has(game.id)) this.games.delete(key);
    }
    for (const [key, analysis] of this.analyses) {
      if (analysis.playerKey !== playerKey) continue;
      const game = this.games.get(gameKey(playerKey, analysis.gameId));
      if (!game || !compatibleAnalysis(analysis, game, [draft])) this.analyses.delete(key);
    }
  }

  async deletePlayer(playerKey: string): Promise<void> {
    this.players.delete(playerKey);
    for (const [id, assessment] of this.assessments) {
      if (assessment.playerKey === playerKey) this.assessments.delete(id);
    }
    for (const [key, game] of this.games) {
      if (game.playerKey === playerKey) this.games.delete(key);
    }
    for (const [key, analysis] of this.analyses) {
      if (analysis.playerKey === playerKey) this.analyses.delete(key);
    }
  }

  close(): void {}

  private markCorrupt(message: string): void {
    if (this.currentStatus.kind === "ok") this.currentStatus = { kind: "corrupt", message };
  }
}
