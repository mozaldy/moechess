import { describe, expect, test } from "vitest";
import { LocalStorageProgressStore, PROGRESS_KEY } from "@/lib/progress/local-storage-store";
import { MemoryProgressStore } from "@/lib/progress/memory-store";
import type { CardState } from "@/lib/progress/types";

const NOW = new Date("2026-03-01T09:30:00.000Z");
const card: CardState = {
  id: "w:rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -",
  expected: ["e4"],
  status: "new",
  fsrs: {
    due: NOW.toISOString(), stability: 0, difficulty: 0, elapsed_days: 0,
    scheduled_days: 0, reps: 0, lapses: 0, learning_steps: 0, state: 0,
  },
};

function throwingStorage(options: { read: boolean; write: boolean }): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => { data.delete(k); },
    getItem: (k: string) => {
      if (options.read) throw new DOMException("blocked", "SecurityError");
      return data.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (options.write) throw new DOMException("full", "QuotaExceededError");
      data.set(k, v);
    },
  };
}

describe("MemoryProgressStore", () => {
  test("saves cards, learned lines and explore positions", async () => {
    const store = new MemoryProgressStore();
    await store.saveCards([card]);
    await store.markLineLearned("ruy:white:berlin", NOW.toISOString());
    await store.setExplorePosition("ruy", "e4 e5");
    const snapshot = await store.load();
    expect(snapshot.cards[card.id]).toEqual(card);
    expect(snapshot.learnedLines["ruy:white:berlin"]).toEqual({ learnedAt: NOW.toISOString() });
    expect(snapshot.explore.ruy).toEqual({ lastNodeId: "e4 e5" });
    expect(store.status()).toEqual({ kind: "ok" });
  });

  test("returned snapshots are copies", async () => {
    const store = new MemoryProgressStore();
    await store.saveCards([card]);
    (await store.load()).cards[card.id].expected.push("d4");
    expect((await store.load()).cards[card.id].expected).toEqual(["e4"]);
  });
});

describe("LocalStorageProgressStore", () => {
  test("persists to localStorage and reloads in a new instance", async () => {
    const first = new LocalStorageProgressStore(localStorage, () => NOW);
    await first.saveCards([card]);
    const second = new LocalStorageProgressStore(localStorage, () => NOW);
    expect((await second.load()).cards[card.id]).toEqual(card);
    expect(JSON.parse(localStorage.getItem(PROGRESS_KEY)!).schemaVersion).toBe(1);
  });

  test("corrupt data is backed up and replaced, and the store reports recovery", async () => {
    localStorage.setItem(PROGRESS_KEY, "{broken");
    const store = new LocalStorageProgressStore(localStorage, () => NOW);
    expect((await store.load()).cards).toEqual({});
    const backupKey = `${PROGRESS_KEY}:backup:${NOW.toISOString()}`;
    expect(store.status()).toEqual({ kind: "recovered", backupKey });
    expect(localStorage.getItem(backupKey)).toBe("{broken");
  });

  test("one bad record keeps the rest", async () => {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({
      schemaVersion: 1, cards: { [card.id]: card, "w:x": { id: "w:x" } }, learnedLines: {}, explore: {},
    }));
    const store = new LocalStorageProgressStore(localStorage, () => NOW);
    expect(Object.keys((await store.load()).cards)).toEqual([card.id]);
    expect(store.status().kind).toBe("recovered");
  });

  test("a newer schema is never overwritten", async () => {
    const future = JSON.stringify({ schemaVersion: 2, cards: {} });
    localStorage.setItem(PROGRESS_KEY, future);
    const store = new LocalStorageProgressStore(localStorage, () => NOW);
    await store.saveCards([card]);
    expect(store.status()).toEqual({ kind: "newer-schema", version: 2 });
    expect(localStorage.getItem(PROGRESS_KEY)).toBe(future);
    expect((await store.load()).cards[card.id]).toEqual(card);
  });

  test("blocked storage falls back to memory", async () => {
    const store = new LocalStorageProgressStore(throwingStorage({ read: true, write: true }), () => NOW);
    await store.saveCards([card]);
    expect((await store.load()).cards[card.id]).toEqual(card);
    expect(store.status()).toEqual({ kind: "unavailable" });
  });

  test("a full storage keeps working in memory", async () => {
    const store = new LocalStorageProgressStore(throwingStorage({ read: false, write: true }), () => NOW);
    await store.saveCards([card]);
    expect((await store.load()).cards[card.id]).toEqual(card);
    expect(store.status()).toEqual({ kind: "unavailable" });
  });

  test("no storage at all falls back to memory", async () => {
    const store = new LocalStorageProgressStore(null, () => NOW);
    await store.setExplorePosition("ruy", "e4");
    expect((await store.load()).explore.ruy).toEqual({ lastNodeId: "e4" });
    expect(store.status()).toEqual({ kind: "unavailable" });
  });
});
