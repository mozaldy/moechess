import type { AnalysisEngine } from "@/lib/analysis/engine/types";
import { matchOpenings } from "@/lib/analysis/openings/match";
import { analyzeGame } from "@/lib/analysis/tactics/analyze-game";
import { analysisSignature, ASSESSMENT_POLICY } from "@/lib/assessment/policy";
import { buildRecommendations, type RecommendationSet } from "@/lib/assessment/recommendations";
import { MemoryAssessmentStore } from "@/lib/assessment/storage/memory";
import type { AssessmentStore, AssessmentStoreStatus } from "@/lib/assessment/storage/types";
import type {
  Assessment,
  GameAnalysis,
  ImportedGame,
  PlayerRecord,
  PlayerSnapshot,
} from "@/lib/assessment/types";
import type { CourseTree } from "@/lib/course/types";
import { ImportError, type ChessComClient } from "@/lib/import/chesscom/client";
import { importGames, type ImportBatch } from "@/lib/import/chesscom/import-games";
import { normalizeUsername } from "@/lib/import/chesscom/normalize";

export interface ControllerDeps {
  store: AssessmentStore;
  client: ChessComClient;
  engineFactory: () => AnalysisEngine;
  courses: CourseTree[];
  now: () => Date;
  withLock: <T>(work: () => Promise<T>) => Promise<T>;
  analyze?: typeof analyzeGame;
}

export interface ControllerView {
  playerKey: string | null;
  players: PlayerRecord[];
  snapshot: PlayerSnapshot | null;
  report: RecommendationSet | null;
  phase: "idle" | "importing" | "ready" | "analyzing" | "paused" | "complete" | "failed";
  message: string | null;
  storage: AssessmentStoreStatus;
  sessionOnly: boolean;
}

export interface AssessmentController {
  getSnapshot(): ControllerView;
  subscribe(listener: () => void): () => void;
  selectPlayer(input: string): Promise<void>;
  import(): Promise<void>;
  start(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
  continueInMemory(): Promise<void>;
  deletePlayer(): Promise<void>;
  dispose(): void;
}

type Phase = ControllerView["phase"];

class StaleJob extends Error {}

interface Job {
  generation: number;
  abort: AbortController;
  playerKey: string | null;
  current(): boolean;
  wait<T>(promise: Promise<T>): Promise<T>;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

function assessmentPhase(assessment: Assessment | null | undefined): Phase {
  return assessment?.state ?? "idle";
}

function activeAssessment(snapshot: PlayerSnapshot | null): Assessment | null {
  return snapshot?.draft ?? snapshot?.current ?? null;
}

function reportFor(snapshot: PlayerSnapshot | null): RecommendationSet | null {
  const assessment = activeAssessment(snapshot);
  return assessment ? buildRecommendations(assessment, snapshot!.analyses, snapshot!.games) : null;
}

function messageFor(error: unknown): string {
  if (error instanceof ImportError) {
    return error.retryAt ? `${error.code}; retry after ${error.retryAt}` : error.code;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Assessment operation failed.";
}

function isCompatible(
  analysis: GameAnalysis,
  games: Map<string, ImportedGame>,
  assessments: Array<Assessment | null>,
): boolean {
  const game = games.get(analysis.gameId);
  return game !== undefined
    && analysis.playerKey === game.playerKey
    && analysis.fingerprint === game.fingerprint
    && assessments.some((assessment) => assessment !== null
      && assessment.playerKey === analysis.playerKey
      && assessment.signature === analysis.signature
      && assessment.selectedIds.includes(analysis.gameId));
}

function completedIds(
  assessment: Assessment,
  games: ImportedGame[],
  analyses: GameAnalysis[],
): string[] {
  const byId = new Map(games.map((game) => [game.id, game]));
  const complete = new Set(analyses
    .filter((analysis) => analysis.signature === assessment.signature
      && analysis.playerKey === assessment.playerKey
      && byId.get(analysis.gameId)?.fingerprint === analysis.fingerprint)
    .map((analysis) => analysis.gameId));
  return assessment.selectedIds.filter((id) => complete.has(id));
}

export function createAssessmentController(deps: ControllerDeps): AssessmentController {
  const persistentStore = deps.store;
  const listeners = new Set<() => void>();
  const analyze = deps.analyze ?? analyzeGame;
  let store = persistentStore;
  let generation = 0;
  let idSequence = 0;
  let currentAbort: AbortController | null = null;
  let currentEngine: AnalysisEngine | null = null;
  let activePromise: Promise<void> | null = null;
  let pendingDelete: Promise<void> | null = null;
  let disposed = false;
  let selectedDisplayName: string | null = null;
  let liveSnapshot: PlayerSnapshot | null = null;
  let view = deepFreeze<ControllerView>({
    playerKey: null,
    players: [],
    snapshot: null,
    report: null,
    phase: "idle",
    message: null,
    storage: store.status(),
    sessionOnly: false,
  });

  function publish(changes: Partial<ControllerView>): void {
    if (disposed) return;
    view = deepFreeze({ ...view, ...changes });
    for (const listener of listeners) listener();
  }

  function publishSnapshot(
    snapshot: PlayerSnapshot | null,
    changes: Partial<ControllerView> = {},
  ): void {
    liveSnapshot = snapshot;
    publish({
      snapshot,
      report: reportFor(snapshot),
      phase: assessmentPhase(activeAssessment(snapshot)),
      storage: store.status(),
      ...changes,
    });
  }

  function invalidate(): void {
    generation += 1;
    currentAbort?.abort();
    currentAbort = null;
  }

  function begin(playerKey = view.playerKey): Job {
    invalidate();
    const capturedGeneration = generation;
    const abort = new AbortController();
    currentAbort = abort;
    const current = () => !disposed
      && generation === capturedGeneration
      && !abort.signal.aborted
      && view.playerKey === playerKey;
    return {
      generation: capturedGeneration,
      abort,
      playerKey,
      current,
      async wait<T>(promise: Promise<T>): Promise<T> {
        if (!current()) throw new StaleJob();
        try {
          const result = await promise;
          if (!current()) throw new StaleJob();
          return result;
        } catch (error) {
          if (!current()) throw new StaleJob();
          throw error;
        }
      },
    };
  }

  function assertCurrent(job: Job): void {
    if (!job.current()) throw new StaleJob();
  }

  function assertSnapshotOwner(job: Job): void {
    assertCurrent(job);
    if (liveSnapshot && liveSnapshot.player.key !== job.playerKey) throw new StaleJob();
  }

  function newAssessmentId(playerKey: string): string {
    idSequence += 1;
    return `assessment:${playerKey}:${deps.now().toISOString()}:${idSequence}`;
  }

  function signatureWithoutStartingEngine(): string {
    const engine = deps.engineFactory();
    try {
      return analysisSignature(engine.buildId);
    } finally {
      engine.dispose();
    }
  }

  async function refreshFromStore(job: Job, changes: Partial<ControllerView> = {}): Promise<void> {
    if (!job.playerKey) return;
    const snapshot = await job.wait(store.load(job.playerKey));
    const players = await job.wait(store.listPlayers());
    publishSnapshot(snapshot, { players, message: null, ...changes });
  }

  function baseSnapshot(job: Job): PlayerSnapshot {
    assertSnapshotOwner(job);
    const playerKey = job.playerKey;
    if (!playerKey) throw new Error("Select a player before importing.");
    return liveSnapshot ?? {
      player: { key: playerKey, displayName: selectedDisplayName ?? playerKey },
      current: null,
      draft: null,
      games: [],
      analyses: [],
    };
  }

  function mergeImportCheckpoint(
    source: PlayerSnapshot,
    draftId: string,
    signature: string,
    batch: ImportBatch,
    state: Assessment["state"],
  ): PlayerSnapshot {
    const now = deps.now();
    const nowIso = now.toISOString();
    const previousDraft = source.draft?.id === draftId ? source.draft : null;
    const draft: Assessment = {
      id: draftId,
      playerKey: source.player.key,
      signature,
      selectedIds: batch.games.map((game) => game.id),
      state,
      coverage: batch.coverage,
      cursor: batch.cursor,
      completedIds: [],
      createdAt: previousDraft?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };
    const games = new Map(source.games.map((game) => [game.id, game]));
    for (const game of batch.games) games.set(game.id, game);
    const assessments: Array<Assessment | null> = [source.current, draft];
    const analyses = source.analyses.filter((analysis) => isCompatible(analysis, games, assessments));
    draft.completedIds = completedIds(draft, [...games.values()], analyses);
    return {
      player: {
        ...source.player,
        lastImportAt: nowIso,
        refreshAfter: new Date(now.getTime() + ASSESSMENT_POLICY.refreshCooldownMs).toISOString(),
      },
      current: source.current,
      draft,
      games: [...games.values()],
      analyses,
    };
  }

  async function persistImportFailure(
    job: Job,
    state: "paused" | "failed",
    reason: string,
    retryAt?: string,
  ): Promise<void> {
    assertSnapshotOwner(job);
    const draft = liveSnapshot?.draft;
    if (!draft || !job.current()) return;
    const paused: Assessment = {
      ...draft,
      state,
      reason,
      retryAt,
      updatedAt: deps.now().toISOString(),
    };
    liveSnapshot = { ...liveSnapshot!, draft: paused };
    publishSnapshot(liveSnapshot, { phase: state, message: reason });
    try {
      await job.wait(store.saveState(paused));
    } catch {
      // The in-memory snapshot remains available for continueInMemory().
    }
  }

  async function performImport(job: Job): Promise<boolean> {
    assertSnapshotOwner(job);
    const playerKey = job.playerKey;
    if (!playerKey) throw new Error("Select a player before importing.");
    const source = baseSnapshot(job);
    const resumable = source.draft?.coverage === "partial" ? source.draft : null;
    const refreshAfter = source.player.refreshAfter && Date.parse(source.player.refreshAfter);
    if (!resumable && refreshAfter && refreshAfter > deps.now().getTime()) {
      throw new Error(`refresh available after ${source.player.refreshAfter}`);
    }
    const draftId = resumable?.id ?? newAssessmentId(playerKey);
    const signature = resumable?.signature ?? signatureWithoutStartingEngine();
    const selected = resumable
      ? resumable.selectedIds.flatMap((id) => source.games.find((game) => game.id === id) ?? [])
      : undefined;
    if (!resumable) {
      const now = deps.now();
      const windowStart = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth() - (ASSESSMENT_POLICY.importMonths - 1),
        1,
      ));
      const windowEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      const placeholder = mergeImportCheckpoint(source, draftId, signature, {
        games: [],
        coverage: "partial",
        cursor: {
          months: [],
          nextMonth: 0,
          seenIds: [],
          windowStart: windowStart.toISOString(),
          windowEnd: windowEnd.toISOString(),
          invalid: 0,
          ineligible: 0,
        },
      }, "importing");
      liveSnapshot = placeholder;
      publishSnapshot(placeholder, { phase: "importing", message: null });
      await job.wait(store.saveDraft(placeholder));
    }
    publish({ phase: "importing", message: null });

    try {
      const result = await job.wait(importGames(deps.client, {
        playerKey,
        now: deps.now(),
        signal: job.abort.signal,
        ...(resumable && resumable.cursor.months.length > 0
          ? { cursor: resumable.cursor, selected }
          : {}),
      }, async (batch) => {
        assertSnapshotOwner(job);
        const checkpoint = mergeImportCheckpoint(baseSnapshot(job), draftId, signature, batch, "importing");
        liveSnapshot = checkpoint;
        publishSnapshot(checkpoint, { phase: "importing", message: null });
        await job.wait(store.saveDraft(checkpoint));
      }));
      assertCurrent(job);

      const ready = mergeImportCheckpoint(baseSnapshot(job), draftId, signature, result, "ready");
      liveSnapshot = ready;
      await job.wait(store.saveDraft(ready));
      if (result.coverage === "complete") {
        await job.wait(store.promoteDraft(playerKey, draftId));
      }
      await refreshFromStore(job, { phase: "ready" });
      return true;
    } catch (error) {
      if (error instanceof StaleJob) throw error;
      if (job.current()) {
        const retryAt = error instanceof ImportError ? error.retryAt : undefined;
        const state = error instanceof ImportError
          && (error.code === "not-found" || error.code === "invalid-response")
          ? "failed"
          : "paused";
        await persistImportFailure(job, state, messageFor(error), retryAt);
      }
      return false;
    }
  }

  function analysisTarget(snapshot: PlayerSnapshot): Assessment | null {
    return snapshot.draft ?? snapshot.current;
  }

  function replaceAssessment(
    snapshot: PlayerSnapshot,
    assessment: Assessment,
  ): PlayerSnapshot {
    return snapshot.draft?.id === assessment.id
      ? { ...snapshot, draft: assessment }
      : { ...snapshot, current: assessment };
  }

  async function prepareSignature(
    job: Job,
    snapshot: PlayerSnapshot,
    signature: string,
  ): Promise<PlayerSnapshot> {
    const target = analysisTarget(snapshot);
    if (!target || target.signature === signature) return snapshot;
    const selectedIds = [...target.selectedIds];
    const draft: Assessment = {
      ...target,
      id: snapshot.draft?.id === target.id ? target.id : newAssessmentId(target.playerKey),
      signature,
      selectedIds,
      completedIds: [],
      state: "ready",
      reason: undefined,
      retryAt: undefined,
      updatedAt: deps.now().toISOString(),
    };
    draft.completedIds = completedIds(draft, snapshot.games, snapshot.analyses);
    const next = { ...snapshot, draft, current: snapshot.current };
    liveSnapshot = next;
    await job.wait(store.saveDraft(next));
    publishSnapshot(next, { phase: "ready", message: null });
    return next;
  }

  async function saveAnalysisState(
    job: Job,
    snapshot: PlayerSnapshot,
    assessment: Assessment,
  ): Promise<PlayerSnapshot> {
    const next = replaceAssessment(snapshot, assessment);
    liveSnapshot = next;
    publishSnapshot(next, { phase: assessment.state, message: assessment.reason ?? null });
    await job.wait(store.saveState(assessment));
    return next;
  }

  async function performAnalysis(job: Job): Promise<boolean> {
    assertSnapshotOwner(job);
    let snapshot = liveSnapshot;
    if (!snapshot) throw new Error("Import games before starting analysis.");
    let target = analysisTarget(snapshot);
    if (!target) throw new Error("Import games before starting analysis.");

    if (target.selectedIds.length === 0) {
      const complete = { ...target, state: "complete" as const, updatedAt: deps.now().toISOString() };
      snapshot = await saveAnalysisState(job, snapshot, complete);
      if (snapshot.draft?.id === complete.id && complete.coverage === "complete") {
        await job.wait(store.promoteDraft(complete.playerKey, complete.id));
      }
      await refreshFromStore(job, { phase: "complete" });
      return true;
    }

    const engine = deps.engineFactory();
    currentEngine = engine;
    try {
      const signature = analysisSignature(engine.buildId);
      snapshot = await prepareSignature(job, snapshot, signature);
      target = analysisTarget(snapshot)!;
      let analysisState: Assessment = {
        ...target,
        completedIds: completedIds(target, snapshot.games, snapshot.analyses),
        state: "analyzing",
        reason: undefined,
        retryAt: undefined,
        updatedAt: deps.now().toISOString(),
      };
      snapshot = await saveAnalysisState(job, snapshot, analysisState);
      await job.wait(engine.init(job.abort.signal));

      for (const gameId of analysisState.selectedIds) {
        assertCurrent(job);
        const game = snapshot.games.find((candidate) => candidate.id === gameId);
        if (!game) throw new Error(`Imported game ${gameId} is missing.`);
        const existing = snapshot.analyses.find((analysis) =>
          analysis.playerKey === analysisState.playerKey
          && analysis.gameId === game.id
          && analysis.fingerprint === game.fingerprint
          && analysis.signature === analysisState.signature);
        if (existing) continue;

        const result = await job.wait(analyze(game, engine, analysisState.signature, job.abort.signal));
        const analysis: GameAnalysis = {
          ...result,
          playerKey: game.playerKey,
          gameId: game.id,
          fingerprint: game.fingerprint,
          signature: analysisState.signature,
          openings: matchOpenings(game, deps.courses),
        };
        const stagedAssessment: Assessment = {
          ...analysisState,
          completedIds: [...new Set([...analysisState.completedIds, game.id])],
          updatedAt: analysis.completedAt,
        };
        snapshot = replaceAssessment({
          ...snapshot,
          analyses: [
            ...snapshot.analyses.filter((item) => !(item.gameId === analysis.gameId
              && item.fingerprint === analysis.fingerprint
              && item.signature === analysis.signature)),
            analysis,
          ],
        }, stagedAssessment);
        liveSnapshot = snapshot;
        publishSnapshot(snapshot, { phase: "analyzing", message: null });
        await job.wait(store.commitGame(analysisState.id, analysis));
        analysisState = stagedAssessment;
      }

      const complete: Assessment = {
        ...analysisTarget(snapshot)!,
        state: "complete",
        reason: undefined,
        retryAt: undefined,
        updatedAt: deps.now().toISOString(),
      };
      snapshot = await saveAnalysisState(job, snapshot, complete);
      if (snapshot.draft?.id === complete.id && complete.coverage === "complete") {
        await job.wait(store.promoteDraft(complete.playerKey, complete.id));
      }
      await refreshFromStore(job, { phase: "complete" });
      return true;
    } catch (error) {
      if (error instanceof StaleJob) throw error;
      if (job.current()) {
        const targetNow = liveSnapshot && analysisTarget(liveSnapshot);
        if (targetNow) {
          const paused: Assessment = {
            ...targetNow,
            state: "paused",
            reason: messageFor(error),
            updatedAt: deps.now().toISOString(),
          };
          liveSnapshot = replaceAssessment(liveSnapshot!, paused);
          publishSnapshot(liveSnapshot, { phase: "paused", message: paused.reason ?? null });
          try {
            await job.wait(store.saveState(paused));
          } catch {
            // Keep the completed in-memory checkpoint available for session-only recovery.
          }
        } else {
          publish({ phase: "paused", message: messageFor(error) });
        }
      }
      return false;
    } finally {
      if (currentEngine === engine) currentEngine = null;
      engine.dispose();
    }
  }

  async function runLocked(work: (job: Job) => Promise<void>): Promise<void> {
    const requestedPlayer = view.playerKey;
    const deletion = pendingDelete;
    if (deletion) await deletion.catch(() => undefined);
    if (disposed || view.playerKey !== requestedPlayer) return;
    const expectedExisting = liveSnapshot?.player.key === requestedPlayer;
    const job = begin(requestedPlayer);
    const operation = (async () => {
      try {
        await job.wait(deps.withLock(async () => {
          assertSnapshotOwner(job);
          if (job.playerKey) {
            const stored = await job.wait(store.load(job.playerKey));
            if (expectedExisting && !stored) {
              publishSnapshot(null, { phase: "idle", message: "Assessment changed in another tab." });
              throw new Error("Assessment changed in another tab.");
            }
            publishSnapshot(stored, { message: null });
          }
          assertSnapshotOwner(job);
          await work(job);
          assertSnapshotOwner(job);
        }));
      } catch (error) {
        if (error instanceof StaleJob || !job.current()) return;
        publish({ phase: "paused", message: messageFor(error), storage: store.status() });
      }
    })();
    activePromise = operation;
    try {
      await operation;
    } finally {
      if (activePromise === operation) activePromise = null;
      if (currentAbort === job.abort) currentAbort = null;
    }
  }

  const hydrationGeneration = generation;
  void (async () => {
    try {
      if (disposed || generation !== hydrationGeneration) return;
      const players = await store.listPlayers();
      if (disposed || generation !== hydrationGeneration) return;
      publish({ players, storage: store.status() });
    } catch (error) {
      if (!disposed && generation === hydrationGeneration) {
        publish({ storage: store.status(), message: messageFor(error) });
      }
    }
  })();

  return {
    getSnapshot() {
      return view;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async selectPlayer(input) {
      const playerKey = normalizeUsername(input);
      selectedDisplayName = input.trim();
      const engine = currentEngine;
      const deletion = pendingDelete;
      const job = begin(playerKey);
      publishSnapshot(null, { playerKey, phase: "idle", message: null });
      if (engine) {
        try { await job.wait(engine.cancel()); } catch (error) {
          if (error instanceof StaleJob) return;
          // A generation guard still rejects late output after a cancellation failure.
        }
      }
      try {
        if (deletion) await job.wait(deletion);
        const players = await job.wait(store.listPlayers());
        const snapshot = await job.wait(store.load(playerKey));
        selectedDisplayName = snapshot?.player.displayName ?? selectedDisplayName;
        publishSnapshot(snapshot, { playerKey, players, message: null });

        const paused = [snapshot?.current, snapshot?.draft]
          .filter((assessment): assessment is Assessment => assessment?.state === "paused");
        for (const assessment of paused) {
          try {
            await job.wait(deps.withLock(() => store.saveState(assessment)));
          } catch {
            // Recovery is already visible; another tab may own the write lock.
          }
        }
      } catch (error) {
        if (!(error instanceof StaleJob) && job.current()) {
          publishSnapshot(null, { playerKey, phase: "failed", message: messageFor(error) });
        }
      }
    },

    async import() {
      await runLocked(async (job) => { await performImport(job); });
    },

    async start() {
      await runLocked(async (job) => { await performAnalysis(job); });
    },

    async resume() {
      await runLocked(async (job) => {
        assertSnapshotOwner(job);
        if (liveSnapshot?.draft?.coverage === "partial") {
          const imported = await performImport(job);
          if (!imported) return;
        }
        await performAnalysis(job);
      });
    },

    async cancel() {
      if (pendingDelete) {
        await pendingDelete.catch(() => undefined);
        return;
      }
      if (!activePromise || (view.phase !== "importing" && view.phase !== "analyzing")) return;
      const previous = activePromise;
      const engine = currentEngine;
      const snapshot = liveSnapshot;
      const playerKey = view.playerKey;
      invalidate();
      const cancelGeneration = generation;
      const isCurrentCancel = () => !disposed
        && generation === cancelGeneration
        && view.playerKey === playerKey;
      if (engine) {
        try { await engine.cancel(); } catch { /* dispose/finally remains authoritative */ }
      }
      if (!isCurrentCancel()) return;
      if (previous) await previous.catch(() => undefined);
      if (!isCurrentCancel() || !snapshot || !playerKey || snapshot.player.key !== playerKey) return;
      const target = activeAssessment(snapshot);
      if (!target || (target.state !== "importing" && target.state !== "analyzing")) {
        return;
      }
      const paused = { ...target, state: "paused" as const, reason: "canceled", updatedAt: deps.now().toISOString() };
      const next = replaceAssessment(snapshot, paused);
      liveSnapshot = next;
      publishSnapshot(next, { phase: "paused", message: "canceled" });
      try {
        if (!isCurrentCancel()) return;
        await deps.withLock(() => store.saveState(paused));
        if (!isCurrentCancel()) return;
      } catch {
        // The last durable checkpoint remains safe.
      }
    },

    async continueInMemory() {
      const requestedPlayer = view.playerKey;
      const deletion = pendingDelete;
      if (deletion) await deletion.catch(() => undefined);
      if (disposed || view.playerKey !== requestedPlayer) return;
      if (!liveSnapshot) throw new Error("There is no assessment to continue.");
      const job = begin();
      try {
        assertSnapshotOwner(job);
        const snapshot = liveSnapshot;
        const memory = new MemoryAssessmentStore();
        await job.wait(memory.saveDraft(snapshot));
        const players = await job.wait(memory.listPlayers());
        const loaded = await job.wait(memory.load(snapshot.player.key));
        assertSnapshotOwner(job);
        store = memory;
        publishSnapshot(loaded, {
          players,
          phase: "paused",
          message: "Continuing for this session only.",
          sessionOnly: true,
          storage: memory.status(),
        });
      } catch (error) {
        if (!(error instanceof StaleJob)) throw error;
      }
    },

    async deletePlayer() {
      if (pendingDelete) {
        await pendingDelete.catch(() => undefined);
        return;
      }
      const playerKey = view.playerKey;
      if (!playerKey) return;
      if (liveSnapshot && liveSnapshot.player.key !== playerKey) {
        publishSnapshot(null, { phase: "idle", message: "Assessment selection changed." });
        return;
      }
      const previous = activePromise;
      const engine = currentEngine;
      invalidate();
      const deleteGeneration = generation;
      const operation = (async () => {
        if (engine) {
          try { await engine.cancel(); } catch {
            // The store transaction remains authoritative after cancellation failure.
          }
        }
        if (previous) {
          // runLocked reports unexpected failures itself. Cancellation makes stale/abort
          // completion expected here; either way, wait until its lock has been released.
          await previous.catch(() => undefined);
        }
        await deps.withLock(() => store.deletePlayer(playerKey));
        const players = await store.listPlayers();
        if (!disposed && generation === deleteGeneration && view.playerKey === playerKey) {
          liveSnapshot = null;
          selectedDisplayName = null;
          publish({
            playerKey: null,
            players,
            snapshot: null,
            report: null,
            phase: "idle",
            message: null,
            storage: store.status(),
          });
        }
      })();
      pendingDelete = operation;
      try {
        await operation;
      } catch (error) {
        if (!disposed && generation === deleteGeneration && view.playerKey === playerKey) {
          publish({ phase: "paused", message: messageFor(error) });
        }
      } finally {
        if (pendingDelete === operation) pendingDelete = null;
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      invalidate();
      void currentEngine?.cancel().catch(() => undefined);
      currentEngine?.dispose();
      store.close();
      if (store !== persistentStore) persistentStore.close();
      listeners.clear();
    },
  };
}
