import { describe, expect, test, vi } from "vitest";

import type { AnalysisEngine } from "@/lib/analysis/engine/types";
import { createAssessmentController, type ControllerDeps } from "@/lib/assessment/controller";
import { analysisSignature } from "@/lib/assessment/policy";
import { MemoryAssessmentStore } from "@/lib/assessment/storage/memory";
import type { AssessmentStore } from "@/lib/assessment/storage/types";
import type { GameAnalysis, ImportedGame, PlayerSnapshot } from "@/lib/assessment/types";
import type { ChessComClient } from "@/lib/import/chesscom/client";
import { ImportError } from "@/lib/import/chesscom/client";
import { fixtureAnalysis, fixtureGame, fixtureSnapshot, rawGame } from "@/tests/fixtures/assessment";

const NOW = new Date("2026-09-20T12:00:00.000Z");

function engine(buildId = "fixture-engine") {
  return {
    buildId,
    init: vi.fn(async () => undefined),
    analyze: vi.fn(async () => { throw new Error("Use the injected game analyzer"); }),
    cancel: vi.fn(async () => undefined),
    dispose: vi.fn(),
  } satisfies AnalysisEngine;
}

function client(overrides: Partial<ChessComClient> = {}): ChessComClient {
  return {
    archives: vi.fn(async () => ["2026/09"]),
    month: vi.fn(async () => [rawGame()]),
    ...overrides,
  };
}

function deps(overrides: Partial<ControllerDeps> = {}): ControllerDeps {
  return {
    store: new MemoryAssessmentStore(),
    client: client(),
    engineFactory: () => engine(),
    courses: [],
    now: () => NOW,
    withLock: async (work) => work(),
    analyze: vi.fn(async (game) => fixtureAnalysis(game)),
    ...overrides,
  };
}

function asDraft(snapshot: PlayerSnapshot): PlayerSnapshot {
  return {
    ...snapshot,
    current: null,
    draft: snapshot.current,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function serialLock() {
  let tail = Promise.resolve();
  return async <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

function ifAvailableLock() {
  let held = false;
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (held) throw new Error("busy");
    held = true;
    try {
      return await work();
    } finally {
      held = false;
    }
  };
}

function forwardingStore(
  memory: MemoryAssessmentStore,
  overrides: Partial<AssessmentStore> = {},
): AssessmentStore {
  return {
    status: () => memory.status(),
    listPlayers: () => memory.listPlayers(),
    load: (key) => memory.load(key),
    saveDraft: (snapshot) => memory.saveDraft(snapshot),
    commitGame: (id, analysis) => memory.commitGame(id, analysis),
    saveState: (assessment) => memory.saveState(assessment),
    promoteDraft: (key, id) => memory.promoteDraft(key, id),
    deletePlayer: (key) => memory.deletePlayer(key),
    close: vi.fn(),
    ...overrides,
  };
}

describe("createAssessmentController", () => {
  test("returns the same immutable view until state changes", async () => {
    const controller = createAssessmentController(deps());
    const initial = controller.getSnapshot();

    expect(controller.getSnapshot()).toBe(initial);
    expect(Object.isFrozen(initial)).toBe(true);

    await controller.selectPlayer("Learner");
    expect(controller.getSnapshot()).not.toBe(initial);
    expect(controller.getSnapshot()).toBe(controller.getSnapshot());
  });

  test("switching users discards a late result", async () => {
    const store = new MemoryAssessmentStore();
    await store.saveDraft(asDraft(fixtureSnapshot()));
    const pending = deferred<GameAnalysis>();
    const analyze = vi.fn(async () => pending.promise);
    const controller = createAssessmentController(deps({ store, analyze }));

    await controller.selectPlayer("learner");
    const run = controller.start();
    await vi.waitFor(() => expect(analyze).toHaveBeenCalled());
    const switching = controller.selectPlayer("someone-else");
    pending.resolve(fixtureAnalysis());
    await Promise.all([run, switching]);

    expect(controller.getSnapshot().playerKey).toBe("someone-else");
    expect((await store.load("learner"))?.draft?.completedIds).toEqual([]);
  });

  test("clears the old snapshot synchronously while a player selection is pending", async () => {
    const memory = new MemoryAssessmentStore();
    await memory.saveDraft(fixtureSnapshot());
    const selected = deferred<PlayerSnapshot | null>();
    let deferredLoad = true;
    const store = forwardingStore(memory, {
      load: async (key) => {
        if (key === "someone-else" && deferredLoad) {
          deferredLoad = false;
          return selected.promise;
        }
        return memory.load(key);
      },
    });
    const controller = createAssessmentController(deps({ store }));
    await controller.selectPlayer("learner");

    const selecting = controller.selectPlayer("someone-else");

    expect(controller.getSnapshot()).toMatchObject({
      playerKey: "someone-else",
      snapshot: null,
      report: null,
      phase: "idle",
    });
    selected.resolve(null);
    await selecting;
  });

  test("cannot start the previous player's assessment during a deferred switch", async () => {
    const memory = new MemoryAssessmentStore();
    await memory.saveDraft(fixtureSnapshot());
    const selected = deferred<PlayerSnapshot | null>();
    const store = forwardingStore(memory, {
      load: async (key) => key === "someone-else" ? selected.promise : memory.load(key),
    });
    const analyze = vi.fn(async (game: ImportedGame) => fixtureAnalysis(game));
    const controller = createAssessmentController(deps({ store, analyze }));
    await controller.selectPlayer("learner");

    const selecting = controller.selectPlayer("someone-else");
    const starting = controller.start();
    selected.resolve(null);
    await Promise.all([selecting, starting]);

    expect(analyze).not.toHaveBeenCalled();
    expect(controller.getSnapshot().playerKey).toBe("someone-else");
    expect(controller.getSnapshot().snapshot).toBeNull();
  });

  test("imports only the new player during a deferred switch", async () => {
    const memory = new MemoryAssessmentStore();
    await memory.saveDraft(fixtureSnapshot());
    const selected = deferred<PlayerSnapshot | null>();
    let deferredLoad = true;
    const store = forwardingStore(memory, {
      load: async (key) => {
        if (key === "someone-else" && deferredLoad) {
          deferredLoad = false;
          return selected.promise;
        }
        return memory.load(key);
      },
    });
    const archives = vi.fn(async () => []);
    const controller = createAssessmentController(deps({ store, client: client({ archives }) }));
    await controller.selectPlayer("learner");

    const selecting = controller.selectPlayer("someone-else");
    const importing = controller.import();
    selected.resolve(null);
    await Promise.all([selecting, importing]);

    expect(archives).toHaveBeenCalledWith("someone-else", expect.any(AbortSignal));
    expect(controller.getSnapshot().snapshot?.player.key).toBe("someone-else");
  });

  test("cancel is a no-op during a deferred player selection", async () => {
    const memory = new MemoryAssessmentStore();
    await memory.saveDraft(fixtureSnapshot());
    const selected = deferred<PlayerSnapshot | null>();
    const store = forwardingStore(memory, {
      load: async (key) => key === "someone-else" ? selected.promise : memory.load(key),
    });
    const controller = createAssessmentController(deps({ store }));
    await controller.selectPlayer("learner");

    const selecting = controller.selectPlayer("someone-else");
    await controller.cancel();
    expect(controller.getSnapshot()).toMatchObject({
      playerKey: "someone-else",
      snapshot: null,
      phase: "idle",
      message: null,
    });
    selected.resolve(null);
    await selecting;
  });

  test("deleting a player cannot be undone by a late analysis", async () => {
    const store = new MemoryAssessmentStore();
    await store.saveDraft(asDraft(fixtureSnapshot()));
    const pending = deferred<GameAnalysis>();
    const analyze = vi.fn(async () => pending.promise);
    const controller = createAssessmentController(deps({ store, analyze }));

    await controller.selectPlayer("learner");
    const run = controller.start();
    await vi.waitFor(() => expect(analyze).toHaveBeenCalled());
    const deleting = controller.deletePlayer();
    pending.resolve(fixtureAnalysis());
    await Promise.all([run, deleting]);

    expect(await store.load("learner")).toBeNull();
    expect(controller.getSnapshot().playerKey).toBeNull();
  });

  test("delete waits for a blocked import to release an ifAvailable lock", async () => {
    const store = new MemoryAssessmentStore();
    await store.saveDraft(fixtureSnapshot());
    const archivesStarted = deferred<void>();
    const importClient = client({
      archives: vi.fn(async (_username, signal) => {
        archivesStarted.resolve();
        return new Promise<string[]>((_, reject) => {
          signal.addEventListener("abort", () => reject(new ImportError("aborted")), { once: true });
        });
      }),
    });
    const controller = createAssessmentController(deps({
      store,
      client: importClient,
      withLock: ifAvailableLock(),
    }));
    await controller.selectPlayer("learner");

    const importing = controller.import();
    await archivesStarted.promise;
    const deleting = controller.deletePlayer();
    const canceling = controller.cancel();
    await Promise.all([importing, deleting, canceling]);

    expect(await store.load("learner")).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({
      playerKey: null,
      snapshot: null,
      phase: "idle",
    });
  });

  test("delete waits for analysis to abort and release an ifAvailable lock", async () => {
    const store = new MemoryAssessmentStore();
    await store.saveDraft(asDraft(fixtureSnapshot()));
    const analysisStarted = deferred<void>();
    const analyze = vi.fn(async (
      _game: ImportedGame,
      _engine: AnalysisEngine,
      _signature: string,
      signal: AbortSignal,
    ) => {
      analysisStarted.resolve();
      return new Promise<GameAnalysis>((_, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });
    const controller = createAssessmentController(deps({
      store,
      analyze,
      withLock: ifAvailableLock(),
    }));
    await controller.selectPlayer("learner");

    const analyzing = controller.start();
    await analysisStarted.promise;
    const deleting = controller.deletePlayer();
    const canceling = controller.cancel();
    await Promise.all([analyzing, deleting, canceling]);

    expect(await store.load("learner")).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({
      playerKey: null,
      snapshot: null,
      phase: "idle",
    });
  });

  test("imports, promotes, and analyzes without changing opening progress", async () => {
    const store = new MemoryAssessmentStore();
    const analyze = vi.fn(async (game: ImportedGame) => fixtureAnalysis(game));
    localStorage.setItem("moechess:progress", '{"course":"untouched"}');
    const before = localStorage.getItem("moechess:progress");
    const controller = createAssessmentController(deps({ store, analyze }));

    await controller.selectPlayer("Learner");
    await controller.import();
    expect(controller.getSnapshot().snapshot?.player.displayName).toBe("Learner");
    expect(controller.getSnapshot().snapshot?.current?.selectedIds).toEqual(["game-1"]);
    expect(controller.getSnapshot().snapshot?.draft).toBeNull();

    await controller.start();
    expect(controller.getSnapshot().phase).toBe("complete");
    expect(controller.getSnapshot().report?.analyzedGames).toBe(1);
    expect(localStorage.getItem("moechess:progress")).toBe(before);
  });

  test("does not initialize the engine when import finds no eligible games", async () => {
    const created = vi.fn(() => engine());
    const controller = createAssessmentController(deps({
      client: client({ month: vi.fn(async () => []) }),
      engineFactory: created,
    }));

    await controller.selectPlayer("learner");
    await controller.import();
    created.mockClear();
    await controller.start();

    expect(created).not.toHaveBeenCalled();
    expect(controller.getSnapshot().phase).toBe("complete");
    expect(controller.getSnapshot().report?.analyzedGames).toBe(0);
  });

  test("reuses only matching fingerprint and engine signature records", async () => {
    const store = new MemoryAssessmentStore();
    const old = fixtureSnapshot();
    old.current!.state = "complete";
    old.current!.completedIds = ["game-1"];
    old.analyses = [fixtureAnalysis()];
    await store.saveDraft(old);
    const analyze = vi.fn(async (game: ImportedGame, _engine, signature: string) => ({
      ...fixtureAnalysis(game), signature,
    }));
    const controller = createAssessmentController(deps({
      store,
      engineFactory: () => engine("new-engine"),
      analyze,
    }));

    await controller.selectPlayer("learner");
    await controller.resume();

    expect(analyze).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().snapshot?.current?.signature)
      .toBe(analysisSignature("new-engine"));
    expect(controller.getSnapshot().snapshot?.current?.completedIds).toEqual(["game-1"]);
  });

  test("reuses a matching completed analysis without analyzing it again", async () => {
    const store = new MemoryAssessmentStore();
    const saved = fixtureSnapshot();
    saved.current!.state = "complete";
    saved.current!.completedIds = ["game-1"];
    saved.analyses = [fixtureAnalysis()];
    await store.saveDraft(saved);
    const analyze = vi.fn(async (game: ImportedGame) => fixtureAnalysis(game));
    const controller = createAssessmentController(deps({ store, analyze }));

    await controller.selectPlayer("learner");
    await controller.start();

    expect(analyze).not.toHaveBeenCalled();
    expect(controller.getSnapshot().phase).toBe("complete");
    expect(controller.getSnapshot().report?.analyzedGames).toBe(1);
  });

  test("Start analyzes a partial draft without resuming its source scan", async () => {
    const store = new MemoryAssessmentStore();
    const partial = asDraft(fixtureSnapshot());
    partial.draft = { ...partial.draft!, state: "paused", coverage: "partial", cursor: {
      ...partial.draft!.cursor,
      nextMonth: 0,
    } };
    await store.saveDraft(partial);
    const importClient = client();
    const analyze = vi.fn(async (game: ImportedGame) => fixtureAnalysis(game));
    const controller = createAssessmentController(deps({ store, client: importClient, analyze }));

    await controller.selectPlayer("learner");
    await controller.start();

    expect(importClient.month).not.toHaveBeenCalled();
    expect(analyze).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().snapshot?.draft?.coverage).toBe("partial");
    expect(controller.getSnapshot().report?.provisional).toBe(true);
  });

  test("Resume finishes a partial import before continuing analysis", async () => {
    const store = new MemoryAssessmentStore();
    const partial = asDraft(fixtureSnapshot());
    partial.draft = { ...partial.draft!, state: "paused", coverage: "partial", cursor: {
      ...partial.draft!.cursor,
      nextMonth: 0,
    } };
    await store.saveDraft(partial);
    const month = vi.fn(async () => []);
    const importClient = client({ month });
    const analyze = vi.fn(async (game: ImportedGame) => fixtureAnalysis(game));
    const controller = createAssessmentController(deps({ store, client: importClient, analyze }));

    await controller.selectPlayer("learner");
    await controller.resume();

    expect(importClient.month).toHaveBeenCalledOnce();
    expect(analyze).toHaveBeenCalledOnce();
    expect(month.mock.invocationCallOrder[0])
      .toBeLessThan(analyze.mock.invocationCallOrder[0]);
    expect(controller.getSnapshot().snapshot?.draft).toBeNull();
    expect(controller.getSnapshot().phase).toBe("complete");
  });

  test("does not begin the next game before the prior checkpoint commits", async () => {
    const memory = new MemoryAssessmentStore();
    const gameOne = fixtureGame();
    const gameTwo = fixtureGame({
      id: "game-2",
      url: "https://www.chess.com/game/live/1002",
      fingerprint: "fixture-v2",
    });
    const snapshot = asDraft(fixtureSnapshot(gameOne));
    snapshot.draft!.selectedIds = [gameOne.id, gameTwo.id];
    snapshot.games = [gameOne, gameTwo];
    await memory.saveDraft(snapshot);
    const checkpoint = deferred<void>();
    let commits = 0;
    const store: AssessmentStore = {
      status: () => memory.status(),
      listPlayers: () => memory.listPlayers(),
      load: (key) => memory.load(key),
      saveDraft: (value) => memory.saveDraft(value),
      commitGame: async (id, analysis) => {
        commits += 1;
        if (commits === 1) await checkpoint.promise;
        await memory.commitGame(id, analysis);
      },
      saveState: (assessment) => memory.saveState(assessment),
      promoteDraft: (key, id) => memory.promoteDraft(key, id),
      deletePlayer: (key) => memory.deletePlayer(key),
      close: vi.fn(),
    };
    const analyze = vi.fn(async (game: ImportedGame) => fixtureAnalysis(game));
    const controller = createAssessmentController(deps({ store, analyze }));

    await controller.selectPlayer("learner");
    const run = controller.start();
    await vi.waitFor(() => expect(commits).toBe(1));
    expect(analyze).toHaveBeenCalledOnce();
    checkpoint.resolve();
    await run;

    expect(analyze).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().phase).toBe("complete");
  });

  test("keeps the assessment analyzing between sequential commits", async () => {
    const store = new MemoryAssessmentStore();
    const gameOne = fixtureGame();
    const gameTwo = fixtureGame({
      id: "game-2",
      url: "https://www.chess.com/game/live/1002",
      fingerprint: "fixture-v2",
    });
    const snapshot = asDraft(fixtureSnapshot(gameOne));
    snapshot.draft!.selectedIds = [gameOne.id, gameTwo.id];
    snapshot.games = [gameOne, gameTwo];
    await store.saveDraft(snapshot);
    const second = deferred<GameAnalysis>();
    const analyze = vi.fn(async (game: ImportedGame) => game.id === gameOne.id
      ? fixtureAnalysis(game)
      : second.promise);
    const controller = createAssessmentController(deps({ store, analyze }));
    await controller.selectPlayer("learner");

    const run = controller.start();
    await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(2));

    expect(controller.getSnapshot().snapshot?.draft?.state).toBe("analyzing");
    second.resolve(fixtureAnalysis(gameTwo));
    await run;
  });

  test("a stale tab cannot resurrect a player deleted in another tab", async () => {
    const store = new MemoryAssessmentStore();
    await store.saveDraft(fixtureSnapshot());
    const withLock = serialLock();
    const staleClient = client({ archives: vi.fn(async () => []) });
    const deleting = createAssessmentController(deps({ store, withLock }));
    const stale = createAssessmentController(deps({ store, withLock, client: staleClient }));
    await deleting.selectPlayer("learner");
    await stale.selectPlayer("learner");

    await deleting.deletePlayer();
    await stale.import();

    expect(await store.load("learner")).toBeNull();
    expect(staleClient.archives).not.toHaveBeenCalled();
  });

  test("a stale tab reconciles a promoted refresh before importing", async () => {
    const store = new MemoryAssessmentStore();
    await store.saveDraft(fixtureSnapshot());
    const withLock = serialLock();
    const refreshedRaw = rawGame({
      uuid: "game-2",
      url: "https://www.chess.com/game/live/1002",
      end_time: fixtureGame().endTime + 1,
    });
    const refresher = createAssessmentController(deps({
      store,
      withLock,
      client: client({ month: vi.fn(async () => [refreshedRaw]) }),
    }));
    const staleArchives = vi.fn(async () => []);
    const stale = createAssessmentController(deps({
      store,
      withLock,
      client: client({ archives: staleArchives }),
    }));
    await refresher.selectPlayer("learner");
    await stale.selectPlayer("learner");

    await refresher.import();
    await stale.import();

    expect((await store.load("learner"))?.current?.selectedIds).toEqual(["game-2"]);
    expect(staleArchives).not.toHaveBeenCalled();
    expect(stale.getSnapshot().snapshot?.current?.selectedIds).toEqual(["game-2"]);
  });

  test("refresh replaces reordered selection and invalidates corrected fingerprints", async () => {
    const store = new MemoryAssessmentStore();
    const first = fixtureGame();
    const second = fixtureGame({
      id: "game-2",
      url: "https://www.chess.com/game/live/1002",
      fingerprint: "fixture-2",
      endTime: first.endTime - 10,
    });
    const initial = fixtureSnapshot(first);
    initial.current!.selectedIds = [first.id, second.id];
    initial.current!.completedIds = [first.id, second.id];
    initial.current!.state = "complete";
    initial.games = [first, second];
    initial.analyses = [fixtureAnalysis(first), fixtureAnalysis(second)];
    await store.saveDraft(initial);
    const corrected = rawGame({
      pgn: '[White "learner"]\n[Black "opponent"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0',
      white: { username: "learner", rating: 900, result: "win" },
      black: { username: "opponent", rating: 950, result: "resigned" },
      end_time: first.endTime + 20,
    });
    const newest = rawGame({
      uuid: "game-3",
      url: "https://www.chess.com/game/live/1003",
      end_time: first.endTime + 30,
    });
    const controller = createAssessmentController(deps({
      store,
      client: client({ month: vi.fn(async () => [corrected, newest]) }),
    }));

    await controller.selectPlayer("learner");
    await controller.import();

    const loaded = await store.load("learner");
    expect(loaded?.current?.selectedIds).toEqual(["game-3", "game-1"]);
    expect(loaded?.current?.completedIds).toEqual([]);
    expect(loaded?.analyses).toEqual([]);
  });

  test("keeps a partial draft resumable when import is canceled", async () => {
    const store = new MemoryAssessmentStore();
    const current = fixtureSnapshot();
    await store.saveDraft(current);
    const requested = deferred<unknown[]>();
    const importClient = client({ month: vi.fn(async (_user, _month, signal) => {
      return Promise.race([
        requested.promise,
        new Promise<never>((_, reject) => signal.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true })),
      ]);
    }) });
    const controller = createAssessmentController(deps({ store, client: importClient }));

    await controller.selectPlayer("learner");
    const importing = controller.import();
    await vi.waitFor(() => expect(importClient.month).toHaveBeenCalled());
    await controller.cancel();
    await importing;

    const loaded = await store.load("learner");
    expect(loaded?.current?.id).toBe(current.current?.id);
    expect(loaded?.draft?.coverage).toBe("partial");
    expect(controller.getSnapshot().phase).toBe("paused");
  });

  test("cancel aborts an import while it is waiting to retry", async () => {
    const store = new MemoryAssessmentStore();
    const importClient = client({
      archives: vi.fn(async () => { throw new ImportError("network"); }),
    });
    const controller = createAssessmentController(deps({ store, client: importClient }));

    await controller.selectPlayer("learner");
    const importing = controller.import();
    await vi.waitFor(() => expect(importClient.archives).toHaveBeenCalledOnce());
    await controller.cancel();
    await importing;

    expect(importClient.archives).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().phase).toBe("paused");
    expect((await store.load("learner"))?.draft?.state).toBe("paused");
  });

  test("cancel does not change idle, ready, or complete states", async () => {
    const controller = createAssessmentController(deps());
    const idle = controller.getSnapshot();
    await controller.cancel();
    expect(controller.getSnapshot()).toEqual(idle);
    expect(controller.getSnapshot()).toMatchObject({ phase: "idle", message: null });

    await controller.selectPlayer("learner");
    await controller.import();
    const ready = controller.getSnapshot();
    await controller.cancel();
    expect(controller.getSnapshot()).toBe(ready);

    await controller.start();
    const complete = controller.getSnapshot();
    await controller.cancel();
    expect(controller.getSnapshot()).toBe(complete);
  });

  test("cancel is a no-op at the completion edge while the lock is still settling", async () => {
    const settle = deferred<void>();
    const withLock = async <T>(work: () => Promise<T>): Promise<T> => {
      const result = await work();
      await settle.promise;
      return result;
    };
    const controller = createAssessmentController(deps({ withLock }));
    await controller.selectPlayer("learner");
    const importing = controller.import();
    await vi.waitFor(() => expect(controller.getSnapshot().phase).toBe("ready"));

    const ready = controller.getSnapshot();
    await controller.cancel();
    expect(controller.getSnapshot()).toBe(ready);
    settle.resolve();
    await importing;
  });

  test("delete remains reflected when cancel races after the store mutation", async () => {
    const memory = new MemoryAssessmentStore();
    await memory.saveDraft(fixtureSnapshot());
    const release = deferred<void>();
    const deleted = deferred<void>();
    const store = forwardingStore(memory, {
      deletePlayer: async (key) => {
        await memory.deletePlayer(key);
        deleted.resolve();
        await release.promise;
      },
    });
    const controller = createAssessmentController(deps({ store }));
    await controller.selectPlayer("learner");

    const deleting = controller.deletePlayer();
    await deleted.promise;
    const canceling = controller.cancel();
    release.resolve();
    await Promise.all([deleting, canceling]);

    expect(await memory.load("learner")).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({
      playerKey: null,
      snapshot: null,
      report: null,
      phase: "idle",
    });
  });

  test("a switch waits for an in-flight delete before loading the selected player", async () => {
    const memory = new MemoryAssessmentStore();
    await memory.saveDraft(fixtureSnapshot());
    const rivalGame = fixtureGame({ playerKey: "rival", fingerprint: "rival-v1" });
    await memory.saveDraft(fixtureSnapshot(rivalGame));
    const release = deferred<void>();
    const deleted = deferred<void>();
    const store = forwardingStore(memory, {
      deletePlayer: async (key) => {
        await memory.deletePlayer(key);
        deleted.resolve();
        await release.promise;
      },
    });
    const controller = createAssessmentController(deps({ store }));
    await controller.selectPlayer("learner");

    const deleting = controller.deletePlayer();
    await deleted.promise;
    const switching = controller.selectPlayer("rival");
    expect(controller.getSnapshot().snapshot).toBeNull();
    release.resolve();
    await Promise.all([deleting, switching]);

    expect(controller.getSnapshot().playerKey).toBe("rival");
    expect(controller.getSnapshot().snapshot?.player.key).toBe("rival");
    expect(await memory.load("learner")).toBeNull();
  });

  test("pauses on a storage failure and continues only after an in-memory opt-in", async () => {
    const memory = new MemoryAssessmentStore();
    await memory.saveDraft(asDraft(fixtureSnapshot()));
    let failCommit = true;
    const persistent: AssessmentStore = {
      ...memory,
      status: () => memory.status(),
      listPlayers: () => memory.listPlayers(),
      load: (key) => memory.load(key),
      saveDraft: (snapshot) => memory.saveDraft(snapshot),
      commitGame: async (id, analysis) => {
        if (failCommit) throw new Error("disk full");
        return memory.commitGame(id, analysis);
      },
      saveState: (assessment) => memory.saveState(assessment),
      promoteDraft: (key, id) => memory.promoteDraft(key, id),
      deletePlayer: (key) => memory.deletePlayer(key),
      close: vi.fn(),
    };
    const analyze = vi.fn(async (game: ImportedGame) => fixtureAnalysis(game));
    const controller = createAssessmentController(deps({ store: persistent, analyze }));

    await controller.selectPlayer("learner");
    await controller.start();
    expect(controller.getSnapshot().phase).toBe("paused");
    expect(controller.getSnapshot().sessionOnly).toBe(false);

    await controller.continueInMemory();
    expect(controller.getSnapshot().sessionOnly).toBe(true);
    expect(controller.getSnapshot().phase).toBe("paused");
    failCommit = false;
    await controller.resume();
    expect(controller.getSnapshot().phase).toBe("complete");
  });

  test("a player switch wins over a simultaneous in-memory continuation", async () => {
    const store = new MemoryAssessmentStore();
    await store.saveDraft(asDraft(fixtureSnapshot()));
    const rivalGame = fixtureGame({ playerKey: "rival", fingerprint: "rival-v1" });
    await store.saveDraft(fixtureSnapshot(rivalGame));
    const controller = createAssessmentController(deps({ store }));
    await controller.selectPlayer("learner");

    const continuing = controller.continueInMemory();
    const switching = controller.selectPlayer("rival");
    await Promise.all([continuing, switching]);

    expect(controller.getSnapshot().playerKey).toBe("rival");
    expect(controller.getSnapshot().snapshot?.player.key).toBe("rival");
    expect(controller.getSnapshot().sessionOnly).toBe(false);
  });

  test("reports unsupported and busy locks without mutating saved data", async () => {
    for (const reason of ["unsupported", "busy"]) {
      const store = new MemoryAssessmentStore();
      await store.saveDraft(asDraft(fixtureSnapshot()));
      const before = await store.load("learner");
      const controller = createAssessmentController(deps({
        store,
        withLock: async () => { throw new Error(reason); },
      }));
      await controller.selectPlayer("learner");

      await controller.start();

      expect(controller.getSnapshot().phase).toBe("paused");
      expect(controller.getSnapshot().message).toContain(reason);
      expect(await store.load("learner")).toEqual(before);
    }
  });

  test("uses the injected assessment lock for import, analysis, and deletion", async () => {
    let lockCalls = 0;
    const withLock = async <T>(work: () => Promise<T>): Promise<T> => {
      lockCalls += 1;
      return work();
    };
    const controller = createAssessmentController(deps({ withLock }));

    await controller.selectPlayer("learner");
    await controller.import();
    await controller.start();
    await controller.deletePlayer();

    expect(lockCalls).toBe(3);
  });
});
