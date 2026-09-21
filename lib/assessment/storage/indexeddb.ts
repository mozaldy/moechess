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

const DATABASE_NAME = "moechess-assessment";
const SCHEMA_VERSION = 1;
const REQUIRED_STORES = ["players", "assessments", "games", "analyses"] as const;

interface PlayerEnvelope extends PlayerRecord {
  currentId: string | null;
  draftId: string | null;
}

function belongsToDifferentPlayer(value: unknown, playerKey: string): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const owner = (value as Record<string, unknown>).playerKey;
  return typeof owner === "string" && owner.length > 0 && owner !== playerKey;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function readonlyError(): AssessmentStoreError {
  return new AssessmentStoreError("readonly", "Assessment storage is read-only");
}

class InertAssessmentStore implements AssessmentStore {
  constructor(private readonly currentStatus: AssessmentStoreStatus) {}

  status(): AssessmentStoreStatus { return structuredClone(this.currentStatus); }
  async listPlayers(): Promise<PlayerRecord[]> { return []; }
  async load(): Promise<PlayerSnapshot | null> { return null; }
  async saveDraft(): Promise<void> { throw readonlyError(); }
  async commitGame(): Promise<void> { throw readonlyError(); }
  async saveState(): Promise<void> { throw readonlyError(); }
  async promoteDraft(): Promise<void> { throw readonlyError(); }
  async deletePlayer(): Promise<void> { throw readonlyError(); }
  close(): void {}
}

class IndexedDbAssessmentStore implements AssessmentStore {
  private closed = false;

  constructor(
    private readonly database: IDBDatabase,
    private currentStatus: AssessmentStoreStatus,
    private readonly readOnly: boolean,
  ) {
    database.onversionchange = () => {
      this.closed = true;
      this.database.close();
      this.currentStatus = {
        kind: "unavailable",
        message: "Assessment storage changed in another tab. Reopen it to continue.",
      };
    };
  }

  status(): AssessmentStoreStatus {
    return structuredClone(this.currentStatus);
  }

  async listPlayers(): Promise<PlayerRecord[]> {
    const values = await this.readAll<PlayerEnvelope>("players");
    const valid: PlayerRecord[] = [];
    for (const value of values) {
      if (!isPlayerRecord(value)) {
        this.markCorrupt("One or more saved player records are invalid.");
        continue;
      }
      valid.push({
        key: value.key,
        displayName: value.displayName,
        ...(value.lastImportAt ? { lastImportAt: value.lastImportAt } : {}),
        ...(value.refreshAfter ? { refreshAfter: value.refreshAfter } : {}),
      });
    }
    return valid.sort((left, right) => left.key.localeCompare(right.key));
  }

  async load(playerKey: string): Promise<PlayerSnapshot | null> {
    this.ensureReadable();
    const transaction = this.database.transaction(REQUIRED_STORES, "readonly");
    const done = transactionComplete(transaction);
    try {
      const envelope = await requestResult(transaction.objectStore("players").get(playerKey)) as PlayerEnvelope | undefined;
      if (!envelope) {
        await done;
        return null;
      }
      if (!isPlayerRecord(envelope)
        || (envelope.currentId !== null && typeof envelope.currentId !== "string")
        || (envelope.draftId !== null && typeof envelope.draftId !== "string")) {
        await done;
        this.markCorrupt("The saved player record is invalid.");
        return null;
      }

      const assessments = transaction.objectStore("assessments");
      const currentRaw = envelope.currentId
        ? await requestResult(assessments.get(envelope.currentId))
        : undefined;
      const draftRaw = envelope.draftId
        ? await requestResult(assessments.get(envelope.draftId))
        : undefined;
      const gameRecords = await requestResult(transaction.objectStore("games").getAll()) as unknown[];
      const analysisRecords = await requestResult(transaction.objectStore("analyses").getAll()) as unknown[];
      await done;

      const parseAssessment = (value: unknown, expected: boolean): Assessment | null => {
        if (!expected) return null;
        if (!isAssessment(value) || value.playerKey !== playerKey) {
          this.markCorrupt("A saved assessment record is invalid.");
          return null;
        }
        return pauseOrphanedJob(value);
      };
      const current = parseAssessment(currentRaw, envelope.currentId !== null);
      const draft = parseAssessment(draftRaw, envelope.draftId !== null);
      const referenced = [current, draft].filter((value): value is Assessment => value !== null);
      const games: ImportedGame[] = [];
      for (const value of gameRecords) {
        if (belongsToDifferentPlayer(value, playerKey)) continue;
        if (!isImportedGame(value)) {
          this.markCorrupt("One or more imported game records are invalid.");
          continue;
        }
        if (value.playerKey === playerKey) games.push(value);
      }
      games.sort((left, right) => left.id.localeCompare(right.id));
      const gameById = new Map(games.map((game) => [game.id, game]));
      const analyses: GameAnalysis[] = [];
      for (const value of analysisRecords) {
        if (belongsToDifferentPlayer(value, playerKey)) continue;
        if (!isGameAnalysis(value)) {
          this.markCorrupt("One or more game analyses are invalid.");
          continue;
        }
        if (value.playerKey !== playerKey) continue;
        const game = gameById.get(value.gameId);
        if (!game || !compatibleAnalysis(value, game, referenced)) {
          this.markCorrupt("An incompatible game analysis was isolated.");
          continue;
        }
        analyses.push(value);
      }
      analyses.sort((left, right) => left.gameId.localeCompare(right.gameId));
      const completed = new Set(analyses.map((analysis) => `${analysis.signature}\0${analysis.gameId}`));
      const reconcile = (assessment: Assessment | null) => assessment && ({
        ...assessment,
        completedIds: assessment.completedIds.filter((id) => completed.has(`${assessment.signature}\0${id}`)),
      });
      return structuredClone({
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
    } catch (error) {
      await done.catch(() => undefined);
      this.recordStorageError(error);
      throw error;
    }
  }

  async saveDraft(snapshot: PlayerSnapshot): Promise<void> {
    this.ensureWritable();
    if (!validateSnapshot(snapshot)) throw new AssessmentStoreError("invalid", "Invalid player snapshot");
    const copy = structuredClone(snapshot);
    const referenced = [copy.current, copy.draft].filter((item): item is Assessment => item !== null);
    for (const analysis of copy.analyses) {
      const game = copy.games.find((candidate) => candidate.id === analysis.gameId);
      if (!game || !compatibleAnalysis(analysis, game, referenced)) {
        throw new AssessmentStoreError("invalid", "Snapshot contains an incompatible analysis");
      }
    }

    await this.write(REQUIRED_STORES, async (transaction) => {
      const players = transaction.objectStore("players");
      const assessments = transaction.objectStore("assessments");
      const old = await requestResult(players.get(copy.player.key)) as PlayerEnvelope | undefined;
      for (const assessment of referenced) {
        const existing = await requestResult(assessments.get(assessment.id)) as Assessment | undefined;
        if (existing && existing.playerKey !== copy.player.key) {
          throw new AssessmentStoreError("conflict", "Assessment ID belongs to another player");
        }
      }
      if (old?.draftId && old.draftId !== copy.draft?.id) assessments.delete(old.draftId);
      players.put({
        ...copy.player,
        currentId: copy.current?.id ?? null,
        draftId: copy.draft?.id ?? null,
      } satisfies PlayerEnvelope);
      if (copy.current) assessments.put(copy.current);
      if (copy.draft) assessments.put(copy.draft);
      const games = transaction.objectStore("games");
      for (const game of copy.games) games.put(game);
      const analyses = transaction.objectStore("analyses");
      for (const analysis of copy.analyses) analyses.put(analysis);
    });
  }

  async commitGame(assessmentId: string, analysis: GameAnalysis): Promise<void> {
    this.ensureWritable();
    if (!isGameAnalysis(analysis)) throw new AssessmentStoreError("invalid", "Invalid game analysis");
    await this.write(["assessments", "games", "analyses"], async (transaction) => {
      const assessments = transaction.objectStore("assessments");
      const assessment = await requestResult(assessments.get(assessmentId)) as Assessment | undefined;
      if (!assessment) throw new AssessmentStoreError("missing", "Assessment no longer exists");
      if (assessment.playerKey !== analysis.playerKey
        || assessment.signature !== analysis.signature
        || !assessment.selectedIds.includes(analysis.gameId)) {
        throw new AssessmentStoreError("conflict", "Analysis does not match the assessment");
      }
      const game = await requestResult(
        transaction.objectStore("games").get([analysis.playerKey, analysis.gameId]),
      ) as ImportedGame | undefined;
      if (!game || game.fingerprint !== analysis.fingerprint) {
        throw new AssessmentStoreError("conflict", "Analysis does not match the imported game");
      }
      transaction.objectStore("analyses").put(analysis);
      assessments.put({
        ...assessment,
        completedIds: [...new Set([...assessment.completedIds, analysis.gameId])],
        updatedAt: analysis.completedAt,
      });
    });
  }

  async saveState(assessment: Assessment): Promise<void> {
    this.ensureWritable();
    if (!isAssessment(assessment)) throw new AssessmentStoreError("invalid", "Invalid assessment state");
    await this.write(["assessments"], async (transaction) => {
      const store = transaction.objectStore("assessments");
      const existing = await requestResult(store.get(assessment.id)) as Assessment | undefined;
      if (!existing) throw new AssessmentStoreError("missing", "Assessment no longer exists");
      if (existing.playerKey !== assessment.playerKey) {
        throw new AssessmentStoreError("conflict", "Assessment belongs to another player");
      }
      store.put(assessment);
    });
  }

  async promoteDraft(playerKey: string, assessmentId: string): Promise<void> {
    this.ensureWritable();
    await this.write(REQUIRED_STORES, async (transaction) => {
      const players = transaction.objectStore("players");
      const assessments = transaction.objectStore("assessments");
      const games = transaction.objectStore("games");
      const analyses = transaction.objectStore("analyses");
      const envelope = await requestResult(players.get(playerKey)) as PlayerEnvelope | undefined;
      const draft = await requestResult(assessments.get(assessmentId)) as Assessment | undefined;
      if (!envelope || envelope.draftId !== assessmentId || !draft || draft.playerKey !== playerKey) {
        throw new AssessmentStoreError("missing", "Draft no longer exists");
      }
      const allAssessments = await requestResult(assessments.getAll()) as Assessment[];
      const allGames = await requestResult(games.getAll()) as ImportedGame[];
      const allAnalyses = await requestResult(analyses.getAll()) as GameAnalysis[];
      for (const assessment of allAssessments) {
        if (assessment.playerKey === playerKey && assessment.id !== assessmentId) assessments.delete(assessment.id);
      }
      players.put({ ...envelope, currentId: assessmentId, draftId: null });
      const selected = new Set(draft.selectedIds);
      const retainedGames = new Map<string, ImportedGame>();
      for (const game of allGames) {
        if (game.playerKey !== playerKey) continue;
        if (selected.has(game.id)) retainedGames.set(game.id, game);
        else games.delete([playerKey, game.id]);
      }
      for (const analysis of allAnalyses) {
        if (analysis.playerKey !== playerKey) continue;
        const game = retainedGames.get(analysis.gameId);
        if (!game || !compatibleAnalysis(analysis, game, [draft])) {
          analyses.delete([
            analysis.playerKey,
            analysis.gameId,
            analysis.fingerprint,
            analysis.signature,
          ]);
        }
      }
    });
  }

  async deletePlayer(playerKey: string): Promise<void> {
    this.ensureWritable();
    await this.write(REQUIRED_STORES, async (transaction) => {
      const players = transaction.objectStore("players");
      const assessments = transaction.objectStore("assessments");
      const games = transaction.objectStore("games");
      const analyses = transaction.objectStore("analyses");
      const allAssessments = await requestResult(assessments.getAll()) as Assessment[];
      const allGames = await requestResult(games.getAll()) as ImportedGame[];
      const allAnalyses = await requestResult(analyses.getAll()) as GameAnalysis[];
      players.delete(playerKey);
      for (const assessment of allAssessments) {
        if (assessment.playerKey === playerKey) assessments.delete(assessment.id);
      }
      for (const game of allGames) {
        if (game.playerKey === playerKey) games.delete([playerKey, game.id]);
      }
      for (const analysis of allAnalyses) {
        if (analysis.playerKey === playerKey) {
          analyses.delete([playerKey, analysis.gameId, analysis.fingerprint, analysis.signature]);
        }
      }
    });
  }

  close(): void {
    this.closed = true;
    this.database.close();
  }

  private ensureReadable(): void {
    if (this.closed) throw new AssessmentStoreError("unavailable", "Assessment storage is closed");
  }

  private ensureWritable(): void {
    this.ensureReadable();
    if (this.readOnly || this.currentStatus.kind === "newer-schema") throw readonlyError();
  }

  private async readAll<T>(storeName: string): Promise<T[]> {
    this.ensureReadable();
    const transaction = this.database.transaction([storeName], "readonly");
    const done = transactionComplete(transaction);
    try {
      const result = await requestResult(transaction.objectStore(storeName).getAll()) as T[];
      await done;
      return result;
    } catch (error) {
      await done.catch(() => undefined);
      this.recordStorageError(error);
      throw error;
    }
  }

  private async write(
    storeNames: string[] | readonly string[],
    apply: (transaction: IDBTransaction) => Promise<void>,
  ): Promise<void> {
    const transaction = this.database.transaction([...storeNames], "readwrite");
    const done = transactionComplete(transaction);
    try {
      await apply(transaction);
      await done;
    } catch (error) {
      if (!transaction.error) {
        try { transaction.abort(); } catch {}
      }
      await done.catch(() => undefined);
      this.recordStorageError(error);
      throw error;
    }
  }

  private recordStorageError(error: unknown): void {
    if (error instanceof AssessmentStoreError) return;
    if (error instanceof DOMException && error.name === "QuotaExceededError") {
      this.currentStatus = { kind: "quota", message: "Browser storage is full." };
      return;
    }
    this.currentStatus = { kind: "unavailable", message: "Assessment storage is unavailable." };
  }

  private markCorrupt(message: string): void {
    if (this.currentStatus.kind === "ok") this.currentStatus = { kind: "corrupt", message };
  }
}

export async function openAssessmentStore(
  factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB,
  databaseName = DATABASE_NAME,
): Promise<AssessmentStore> {
  if (!factory) {
    return new InertAssessmentStore({
      kind: "unavailable",
      message: "IndexedDB is not available in this browser.",
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(databaseName);
    } catch {
      resolve(new InertAssessmentStore({
        kind: "unavailable",
        message: "IndexedDB could not be opened.",
      }));
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("players")) {
        database.createObjectStore("players", { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains("assessments")) {
        const assessments = database.createObjectStore("assessments", { keyPath: "id" });
        assessments.createIndex("playerKey", "playerKey", { unique: false });
      }
      if (!database.objectStoreNames.contains("games")) {
        database.createObjectStore("games", { keyPath: ["playerKey", "id"] });
      }
      if (!database.objectStoreNames.contains("analyses")) {
        database.createObjectStore("analyses", {
          keyPath: ["playerKey", "gameId", "fingerprint", "signature"],
        });
      }
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      resolve(new InertAssessmentStore({
        kind: "unavailable",
        message: "Another tab is blocking assessment storage. Close it and retry.",
      }));
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      resolve(new InertAssessmentStore({
        kind: "unavailable",
        message: request.error?.message ?? "IndexedDB could not be opened.",
      }));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      const missingStore = REQUIRED_STORES.some((name) => !database.objectStoreNames.contains(name));
      if (database.version > SCHEMA_VERSION) {
        const status: AssessmentStoreStatus = {
          kind: "newer-schema",
          message: "Assessment data was created by a newer version and is read-only.",
        };
        if (missingStore) {
          database.close();
          resolve(new InertAssessmentStore(status));
        } else {
          resolve(new IndexedDbAssessmentStore(database, status, true));
        }
      } else if (missingStore) {
        resolve(new IndexedDbAssessmentStore(database, {
          kind: "corrupt",
          message: "Assessment storage is missing required records.",
        }, true));
      } else {
        resolve(new IndexedDbAssessmentStore(database, { kind: "ok" }, false));
      }
    };
  });
}
