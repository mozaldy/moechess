import { describe, expect, test } from "vitest";

import { MemoryAssessmentStore } from "@/lib/assessment/storage/memory";
import { openAssessmentStore } from "@/lib/assessment/storage/indexeddb";
import type { AssessmentStore } from "@/lib/assessment/storage/types";
import type { Assessment, PlayerSnapshot } from "@/lib/assessment/types";
import {
  fixtureAnalysis,
  fixtureGame,
  fixtureSnapshot,
} from "@/tests/fixtures/assessment";

function asDraft(snapshot: PlayerSnapshot, id = `${snapshot.current!.id}-draft`): PlayerSnapshot {
  return {
    ...snapshot,
    current: snapshot.current,
    draft: { ...snapshot.current!, id, state: "ready" },
  };
}

async function expectRejectsWithoutChanging(
  store: AssessmentStore,
  assessmentId: string,
  analysis: ReturnType<typeof fixtureAnalysis>,
) {
  const before = await store.load(analysis.playerKey);
  await expect(store.commitGame(assessmentId, analysis)).rejects.toThrow();
  expect(await store.load(analysis.playerKey)).toEqual(before);
}

describe("MemoryAssessmentStore", () => {
  test("commits findings and completion together, once", async () => {
    const store = new MemoryAssessmentStore();
    const snapshot = fixtureSnapshot();
    snapshot.draft = snapshot.current;
    snapshot.current = null;
    await store.saveDraft(snapshot);

    await store.commitGame(snapshot.draft!.id, fixtureAnalysis());
    await store.commitGame(snapshot.draft!.id, fixtureAnalysis());

    const loaded = await store.load("learner");
    expect(loaded?.draft?.completedIds).toEqual(["game-1"]);
    expect(loaded?.analyses).toHaveLength(1);
  });

  test("rejects mismatched signatures and fingerprints atomically", async () => {
    const store = new MemoryAssessmentStore();
    const snapshot = fixtureSnapshot();
    snapshot.draft = snapshot.current;
    snapshot.current = null;
    await store.saveDraft(snapshot);

    await expectRejectsWithoutChanging(store, snapshot.draft!.id, {
      ...fixtureAnalysis(),
      signature: "different-policy",
    });
    await expectRejectsWithoutChanging(store, snapshot.draft!.id, {
      ...fixtureAnalysis(),
      fingerprint: "corrected-source-game",
    });
  });

  test("isolates players even when source game IDs overlap", async () => {
    const store = new MemoryAssessmentStore();
    const learner = fixtureSnapshot();
    const rivalGame = fixtureGame({ playerKey: "rival", fingerprint: "rival-v1" });
    const rival = fixtureSnapshot(rivalGame);
    learner.draft = learner.current;
    learner.current = null;
    rival.draft = rival.current;
    rival.current = null;

    await store.saveDraft(learner);
    await store.saveDraft(rival);
    await store.commitGame(learner.draft!.id, fixtureAnalysis());
    await store.commitGame(rival.draft!.id, fixtureAnalysis(rivalGame));

    expect((await store.load("learner"))?.analyses[0].playerKey).toBe("learner");
    expect((await store.load("rival"))?.analyses[0].playerKey).toBe("rival");
    expect(await store.listPlayers()).toEqual([
      expect.objectContaining({ key: "learner" }),
      expect.objectContaining({ key: "rival" }),
    ]);
  });

  test("cannot recreate a deleted assessment with a stale checkpoint", async () => {
    const store = new MemoryAssessmentStore();
    const snapshot = fixtureSnapshot();
    await store.saveDraft(snapshot);
    await store.deletePlayer("learner");

    await expect(store.commitGame(snapshot.current!.id, fixtureAnalysis())).rejects.toThrow();
    expect(await store.load("learner")).toBeNull();
  });

  test("canceling a refresh preserves the current assessment", async () => {
    const store = new MemoryAssessmentStore();
    const snapshot = asDraft(fixtureSnapshot());
    await store.saveDraft(snapshot);

    await store.saveDraft({ ...snapshot, draft: null });

    const loaded = await store.load("learner");
    expect(loaded?.current?.id).toBe(snapshot.current!.id);
    expect(loaded?.draft).toBeNull();
    expect(loaded?.games).toEqual([fixtureGame()]);
  });

  test("promotion prunes only unreferenced records for that player", async () => {
    const store = new MemoryAssessmentStore();
    const oldGame = fixtureGame();
    const newGame = fixtureGame({ id: "game-2", fingerprint: "fixture-v2" });
    const otherGame = fixtureGame({ playerKey: "rival", id: "game-3", fingerprint: "rival-v1" });
    const learner = fixtureSnapshot(oldGame);
    const draft: Assessment = {
      ...learner.current!,
      id: "assessment-learner-refresh",
      selectedIds: [newGame.id],
      completedIds: [],
    };
    await store.saveDraft({ ...learner, draft, games: [oldGame, newGame] });
    await store.commitGame(draft.id, fixtureAnalysis(newGame));
    const rival = fixtureSnapshot(otherGame);
    await store.saveDraft(rival);
    await store.commitGame(rival.current!.id, fixtureAnalysis(otherGame));

    await store.promoteDraft("learner", draft.id);

    const promoted = await store.load("learner");
    expect(promoted?.current?.id).toBe(draft.id);
    expect(promoted?.draft).toBeNull();
    expect(promoted?.games.map((game) => game.id)).toEqual(["game-2"]);
    expect(promoted?.analyses.map((analysis) => analysis.gameId)).toEqual(["game-2"]);
    expect((await store.load("rival"))?.games).toEqual([otherGame]);
    expect((await store.load("rival"))?.analyses).toHaveLength(1);
  });

  test("saveState updates an existing assessment but does not create one", async () => {
    const store = new MemoryAssessmentStore();
    const snapshot = fixtureSnapshot();
    await store.saveDraft(snapshot);
    await store.saveState({ ...snapshot.current!, state: "paused", reason: "canceled" });
    expect((await store.load("learner"))?.current).toMatchObject({
      state: "paused",
      reason: "canceled",
    });

    await expect(store.saveState({ ...snapshot.current!, id: "missing" })).rejects.toThrow();
  });

  test("treats a persisted active job as paused after reload", async () => {
    const store = new MemoryAssessmentStore();
    const snapshot = fixtureSnapshot();
    snapshot.current = { ...snapshot.current!, state: "analyzing" };
    await store.saveDraft(snapshot);

    expect((await store.load("learner"))?.current?.state).toBe("paused");
  });

  test("rejects malformed nested analysis records", async () => {
    const store = new MemoryAssessmentStore();
    const snapshot = fixtureSnapshot();
    snapshot.analyses = [{
      ...fixtureAnalysis(),
      findings: [{ theme: "hanging" }],
    } as unknown as ReturnType<typeof fixtureAnalysis>];

    await expect(store.saveDraft(snapshot)).rejects.toThrow("Invalid player snapshot");
    expect(await store.load("learner")).toBeNull();
  });

  test("rejects unsafe or malformed imported game records", async () => {
    const store = new MemoryAssessmentStore();
    const snapshot = fixtureSnapshot();
    snapshot.games = [{
      ...fixtureGame(),
      url: "javascript:alert(1)",
      clocks: { 1: Number.NaN },
    }];

    await expect(store.saveDraft(snapshot)).rejects.toThrow("Invalid player snapshot");
    expect(await store.load("learner")).toBeNull();
  });

  test("rejects duplicate completed game IDs", async () => {
    const store = new MemoryAssessmentStore();
    const snapshot = fixtureSnapshot();
    snapshot.current = {
      ...snapshot.current!,
      completedIds: ["game-1", "game-1"],
    };

    await expect(store.saveDraft(snapshot)).rejects.toThrow("Invalid player snapshot");
    expect(await store.load("learner")).toBeNull();
  });
});

test("reports unavailable storage and rejects writes when IndexedDB is absent", async () => {
  const store = await openAssessmentStore(undefined);

  expect(store.status()).toMatchObject({ kind: "unavailable" });
  expect(await store.listPlayers()).toEqual([]);
  await expect(store.saveDraft(fixtureSnapshot())).rejects.toThrow("read-only");
});
