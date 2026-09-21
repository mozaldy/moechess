import { expect, test } from "@playwright/test";

import { bundleBrowserEntry } from "./helpers/assessment-bundle";

test("persists atomic game checkpoints in IndexedDB", async ({ page }) => {
  const databaseName = `moechess-assessment-test-${crypto.randomUUID()}`;
  const source = `
    import { openAssessmentStore } from "@/lib/assessment/storage/indexeddb";
    import { fixtureAnalysis, fixtureSnapshot } from "@/tests/fixtures/assessment";

    window.__assessmentStorageTest = (async () => {
      const name = ${JSON.stringify(databaseName)};
      let store = await openAssessmentStore(indexedDB, name);
      const snapshot = fixtureSnapshot();
      snapshot.draft = snapshot.current;
      snapshot.current = null;
      await store.saveDraft(snapshot);
      await store.commitGame(snapshot.draft.id, fixtureAnalysis());
      await store.commitGame(snapshot.draft.id, fixtureAnalysis());

      const saved = await store.load("learner");
      await store.saveState({
        ...saved.draft,
        state: "paused",
        reason: "fixture pause",
      });

      const before = await store.load("learner");
      let fingerprintRejected = false;
      try {
        await store.commitGame(snapshot.draft.id, {
          ...fixtureAnalysis(), fingerprint: "corrected-source-game",
        });
      } catch {
        fingerprintRejected = true;
      }
      let signatureRejected = false;
      try {
        await store.commitGame(snapshot.draft.id, {
          ...fixtureAnalysis(), signature: "different-policy",
        });
      } catch {
        signatureRejected = true;
      }
      const after = await store.load("learner");
      store.close();

      store = await openAssessmentStore(indexedDB, name);
      const reloaded = await store.load("learner");
      const status = store.status();
      store.close();
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve(undefined);
        request.onerror = () => reject(request.error);
      });
      return {
        status,
        fingerprintRejected,
        signatureRejected,
        rollbackPreserved: JSON.stringify(before) === JSON.stringify(after),
        completedIds: reloaded?.draft?.completedIds,
        analysisCount: reloaded?.analyses.length,
        state: reloaded?.draft?.state,
        reason: reloaded?.draft?.reason,
      };
    })();
  `;

  const bundle = await bundleBrowserEntry(source);
  await page.goto("/");
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async () => {
    const ownedWindow = window as Window & {
      __assessmentStorageTest?: Promise<{
        status: { kind: string };
        fingerprintRejected: boolean;
        signatureRejected: boolean;
        rollbackPreserved: boolean;
        completedIds?: string[];
        analysisCount?: number;
      }>;
    };
    try {
      return await ownedWindow.__assessmentStorageTest!;
    } finally {
      delete ownedWindow.__assessmentStorageTest;
    }
  });

  expect(result).toEqual({
    status: { kind: "ok" },
    fingerprintRejected: true,
    signatureRejected: true,
    rollbackPreserved: true,
    completedIds: ["game-1"],
    analysisCount: 1,
    state: "paused",
    reason: "fixture pause",
  });
});

test("keeps an unknown newer schema read-only without altering it", async ({ page }) => {
  const databaseName = `moechess-assessment-future-${crypto.randomUUID()}`;
  const source = `
    import { openAssessmentStore } from "@/lib/assessment/storage/indexeddb";
    import { fixtureSnapshot } from "@/tests/fixtures/assessment";

    window.__assessmentStorageTest = (async () => {
      const name = ${JSON.stringify(databaseName)};
      await new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 2);
        request.onupgradeneeded = () => request.result.createObjectStore("future-records");
        request.onsuccess = () => { request.result.close(); resolve(undefined); };
        request.onerror = () => reject(request.error);
      });
      const store = await openAssessmentStore(indexedDB, name);
      const initialStatus = store.status();
      let loaded = "not-called";
      let rejected = false;
      try {
        loaded = String(await store.load("learner"));
      } catch {
        loaded = "threw";
      }
      try {
        await store.saveDraft(fixtureSnapshot());
      } catch {
        rejected = true;
      }
      const finalStatus = store.status();
      store.close();
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve(undefined);
        request.onerror = () => reject(request.error);
      });
      return { initialStatus, finalStatus, loaded, rejected };
    })();
  `;

  const bundle = await bundleBrowserEntry(source);
  await page.goto("/");
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async () => {
    const ownedWindow = window as Window & {
      __assessmentStorageTest?: Promise<{
        initialStatus: { kind: string };
        finalStatus: { kind: string };
        loaded: string;
        rejected: boolean;
      }>;
    };
    try {
      return await ownedWindow.__assessmentStorageTest!;
    } finally {
      delete ownedWindow.__assessmentStorageTest;
    }
  });

  expect(result).toMatchObject({
    initialStatus: { kind: "newer-schema" },
    finalStatus: { kind: "newer-schema" },
    loaded: "null",
    rejected: true,
  });
});

test("isolates a corrupt analysis and marks its game unfinished", async ({ page }) => {
  const databaseName = `moechess-assessment-corrupt-${crypto.randomUUID()}`;
  const source = `
    import { openAssessmentStore } from "@/lib/assessment/storage/indexeddb";
    import { fixtureAnalysis, fixtureSnapshot } from "@/tests/fixtures/assessment";

    window.__assessmentStorageTest = (async () => {
      const name = ${JSON.stringify(databaseName)};
      let store = await openAssessmentStore(indexedDB, name);
      const snapshot = fixtureSnapshot();
      snapshot.draft = snapshot.current;
      snapshot.current = null;
      await store.saveDraft(snapshot);
      await store.commitGame(snapshot.draft.id, fixtureAnalysis());
      store.close();

      await new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(["analyses"], "readwrite");
          transaction.objectStore("analyses").put({
            ...fixtureAnalysis(), findings: [{ theme: "hanging" }],
          });
          transaction.oncomplete = () => { database.close(); resolve(undefined); };
          transaction.onerror = () => reject(transaction.error);
        };
        request.onerror = () => reject(request.error);
      });

      store = await openAssessmentStore(indexedDB, name);
      const loaded = await store.load("learner");
      const status = store.status();
      store.close();
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve(undefined);
        request.onerror = () => reject(request.error);
      });
      return {
        status,
        completedIds: loaded?.draft?.completedIds,
        analysisCount: loaded?.analyses.length,
      };
    })();
  `;

  const bundle = await bundleBrowserEntry(source);
  await page.goto("/");
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async () => {
    const ownedWindow = window as Window & {
      __assessmentStorageTest?: Promise<{
        status: { kind: string };
        completedIds?: string[];
        analysisCount?: number;
      }>;
    };
    try {
      return await ownedWindow.__assessmentStorageTest!;
    } finally {
      delete ownedWindow.__assessmentStorageTest;
    }
  });

  expect(result).toEqual({
    status: { kind: "corrupt", message: "One or more game analyses are invalid." },
    completedIds: [],
    analysisCount: 0,
  });
});

test("applies player isolation, deletion, cancellation, and promotion atomically", async ({ page }) => {
  const databaseName = `moechess-assessment-contract-${crypto.randomUUID()}`;
  const source = `
    import { openAssessmentStore } from "@/lib/assessment/storage/indexeddb";
    import { fixtureAnalysis, fixtureGame, fixtureSnapshot } from "@/tests/fixtures/assessment";

    window.__assessmentStorageTest = (async () => {
      const name = ${JSON.stringify(databaseName)};
      const store = await openAssessmentStore(indexedDB, name);
      const oldGame = fixtureGame();
      const newGame = fixtureGame({ id: "game-2", fingerprint: "fixture-v2" });
      const learner = fixtureSnapshot(oldGame);
      const draft = {
        ...learner.current,
        id: "assessment-learner-refresh",
        selectedIds: [newGame.id],
        completedIds: [],
      };
      await store.saveDraft({ ...learner, draft, games: [oldGame, newGame] });
      await store.commitGame(draft.id, fixtureAnalysis(newGame));

      const rivalGame = fixtureGame({ playerKey: "rival", fingerprint: "rival-v1" });
      const rival = fixtureSnapshot(rivalGame);
      await store.saveDraft(rival);
      await store.commitGame(rival.current.id, fixtureAnalysis(rivalGame));
      const isolated = (await store.load("rival"))?.analyses[0]?.playerKey === "rival";
      await store.deletePlayer("rival");
      let staleRejected = false;
      try {
        await store.commitGame(rival.current.id, fixtureAnalysis(rivalGame));
      } catch {
        staleRejected = true;
      }
      const deleted = await store.load("rival") === null;

      const cancelGame = fixtureGame({ playerKey: "cancel", id: "game-3", fingerprint: "cancel-v1" });
      const cancel = fixtureSnapshot(cancelGame);
      await store.saveDraft({
        ...cancel,
        draft: { ...cancel.current, id: "assessment-cancel-refresh" },
      });
      await store.saveDraft(cancel);
      const canceled = await store.load("cancel");

      await store.promoteDraft("learner", draft.id);
      const promoted = await store.load("learner");
      const otherPlayer = await store.load("cancel");
      const malformedGame = fixtureGame({
        playerKey: "malformed",
        id: "game-4",
        fingerprint: "malformed-v1",
      });
      const malformed = fixtureSnapshot(malformedGame);
      malformed.current.completedIds = [malformedGame.id, malformedGame.id];
      let duplicateRejected = false;
      try {
        await store.saveDraft(malformed);
      } catch {
        duplicateRejected = true;
      }
      const unsafeGame = fixtureGame({
        playerKey: "unsafe",
        id: "game-5",
        fingerprint: "unsafe-v1",
        url: "javascript:alert(1)",
      });
      let malformedRejected = false;
      try {
        await store.saveDraft(fixtureSnapshot(unsafeGame));
      } catch {
        malformedRejected = true;
      }
      store.close();
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve(undefined);
        request.onerror = () => reject(request.error);
      });
      return {
        isolated,
        staleRejected,
        deleted,
        canceledCurrent: canceled?.current?.id,
        canceledDraft: canceled?.draft,
        promotedCurrent: promoted?.current?.id,
        promotedDraft: promoted?.draft,
        promotedGames: promoted?.games.map(game => game.id),
        promotedAnalyses: promoted?.analyses.map(analysis => analysis.gameId),
        otherPlayerGames: otherPlayer?.games.map(game => game.id),
        duplicateRejected,
        malformedRejected,
      };
    })();
  `;

  const bundle = await bundleBrowserEntry(source);
  await page.goto("/");
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async () => {
    const ownedWindow = window as Window & { __assessmentStorageTest?: Promise<unknown> };
    try {
      return await ownedWindow.__assessmentStorageTest!;
    } finally {
      delete ownedWindow.__assessmentStorageTest;
    }
  });

  expect(result).toEqual({
    isolated: true,
    staleRejected: true,
    deleted: true,
    canceledCurrent: "assessment-cancel",
    canceledDraft: null,
    promotedCurrent: "assessment-learner-refresh",
    promotedDraft: null,
    promotedGames: ["game-2"],
    promotedAnalyses: ["game-2"],
    otherPlayerGames: ["game-3"],
    duplicateRejected: true,
    malformedRejected: true,
  });
});

test("does not let another player's identifiable corruption taint a valid player", async ({ page }) => {
  const databaseName = `moechess-assessment-isolation-${crypto.randomUUID()}`;
  const source = `
    import { openAssessmentStore } from "@/lib/assessment/storage/indexeddb";
    import { fixtureAnalysis, fixtureGame, fixtureSnapshot } from "@/tests/fixtures/assessment";

    window.__assessmentStorageTest = (async () => {
      const name = ${JSON.stringify(databaseName)};
      let store = await openAssessmentStore(indexedDB, name);
      const learner = fixtureSnapshot();
      const rivalGame = fixtureGame({ playerKey: "rival", fingerprint: "rival-v1" });
      const rival = fixtureSnapshot(rivalGame);
      await store.saveDraft(learner);
      await store.commitGame(learner.current.id, fixtureAnalysis());
      await store.saveDraft(rival);
      await store.commitGame(rival.current.id, fixtureAnalysis(rivalGame));
      store.close();

      await new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(["games", "analyses"], "readwrite");
          transaction.objectStore("games").put({ ...rivalGame, url: "javascript:alert(1)" });
          transaction.objectStore("analyses").put({
            ...fixtureAnalysis(rivalGame), findings: [{ theme: "hanging" }],
          });
          transaction.oncomplete = () => { database.close(); resolve(undefined); };
          transaction.onerror = () => reject(transaction.error);
        };
        request.onerror = () => reject(request.error);
      });

      store = await openAssessmentStore(indexedDB, name);
      const loadedLearner = await store.load("learner");
      const learnerStatus = store.status();
      const loadedRival = await store.load("rival");
      const rivalStatus = store.status();
      store.close();
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve(undefined);
        request.onerror = () => reject(request.error);
      });
      return {
        learnerStatus,
        learnerCompletedIds: loadedLearner?.current?.completedIds,
        learnerAnalysisCount: loadedLearner?.analyses.length,
        rivalStatus,
        rivalCompletedIds: loadedRival?.current?.completedIds,
        rivalAnalysisCount: loadedRival?.analyses.length,
      };
    })();
  `;

  const bundle = await bundleBrowserEntry(source);
  await page.goto("/");
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async () => {
    const ownedWindow = window as Window & { __assessmentStorageTest?: Promise<unknown> };
    try {
      return await ownedWindow.__assessmentStorageTest!;
    } finally {
      delete ownedWindow.__assessmentStorageTest;
    }
  });

  expect(result).toEqual({
    learnerStatus: { kind: "ok" },
    learnerCompletedIds: ["game-1"],
    learnerAnalysisCount: 1,
    rivalStatus: { kind: "corrupt", message: "One or more imported game records are invalid." },
    rivalCompletedIds: [],
    rivalAnalysisCount: 0,
  });
});

test("does not restore duplicate completed IDs from persisted IndexedDB data", async ({ page }) => {
  const databaseName = `moechess-assessment-duplicates-${crypto.randomUUID()}`;
  const source = `
    import { openAssessmentStore } from "@/lib/assessment/storage/indexeddb";
    import { fixtureAnalysis, fixtureSnapshot } from "@/tests/fixtures/assessment";

    window.__assessmentStorageTest = (async () => {
      const name = ${JSON.stringify(databaseName)};
      let store = await openAssessmentStore(indexedDB, name);
      const snapshot = fixtureSnapshot();
      await store.saveDraft(snapshot);
      await store.commitGame(snapshot.current.id, fixtureAnalysis());
      store.close();

      await new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(["assessments"], "readwrite");
          const assessments = transaction.objectStore("assessments");
          const get = assessments.get(snapshot.current.id);
          get.onsuccess = () => assessments.put({
            ...get.result,
            completedIds: ["game-1", "game-1"],
          });
          transaction.oncomplete = () => { database.close(); resolve(undefined); };
          transaction.onerror = () => reject(transaction.error);
        };
        request.onerror = () => reject(request.error);
      });

      store = await openAssessmentStore(indexedDB, name);
      const loaded = await store.load("learner");
      const status = store.status();
      store.close();
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve(undefined);
        request.onerror = () => reject(request.error);
      });
      return {
        status,
        current: loaded?.current,
        analysisCount: loaded?.analyses.length,
      };
    })();
  `;

  const bundle = await bundleBrowserEntry(source);
  await page.goto("/");
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async () => {
    const ownedWindow = window as Window & { __assessmentStorageTest?: Promise<unknown> };
    try {
      return await ownedWindow.__assessmentStorageTest!;
    } finally {
      delete ownedWindow.__assessmentStorageTest;
    }
  });

  expect(result).toEqual({
    status: { kind: "corrupt", message: "A saved assessment record is invalid." },
    current: null,
    analysisCount: 0,
  });
});
