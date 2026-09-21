import { describe, expect, test, vi } from "vitest";
import type { ImportedGame, ImportCursor } from "@/lib/assessment/types";
import {
  ImportError,
  createChessComClient,
  type ChessComClient,
} from "@/lib/import/chesscom/client";
import { importGames, type ImportBatch } from "@/lib/import/chesscom/import-games";
import { rawGame } from "@/tests/fixtures/assessment";

const NOW = new Date("2026-09-20T12:00:00Z");
const NOW_SECONDS = NOW.getTime() / 1_000;

function game(id: string, endTime = NOW_SECONDS - 60, overrides: Record<string, unknown> = {}) {
  const numericId = Array.from(id, (character) => character.charCodeAt(0)).join("");
  return rawGame({
    uuid: id,
    url: `https://www.chess.com/game/live/${numericId}`,
    end_time: endTime,
    ...overrides,
  });
}

function clientWith(months: Record<string, unknown[]>): ChessComClient {
  return {
    archives: async () => Object.keys(months),
    month: async (_username, month) => months[month] ?? [],
  };
}

describe("importGames", () => {
  test("retries the failed newest month before looking further back", async () => {
    const seen: string[] = [];
    const client: ChessComClient = {
      archives: async () => ["2026/08", "2026/09"],
      month: async (_username, month) => {
        seen.push(month);
        throw new ImportError("network");
      },
    };
    const checkpoints: ImportBatch[] = [];

    await expect(importGames(client, {
      playerKey: "learner",
      now: new Date("2026-09-20T00:00:00Z"),
      signal: new AbortController().signal,
    }, async (batch) => { checkpoints.push(batch); })).rejects.toMatchObject({ code: "network" });

    expect(seen).toEqual(["2026/09"]);
    expect(checkpoints.at(-1)?.cursor.nextMonth).toBe(0);
    expect(checkpoints.at(-1)?.coverage).toBe("partial");
  });

  test("collects exactly 50 valid games after invalid and future newer records", async () => {
    const records = [
      game("future", NOW_SECONDS + 1),
      game("invalid", NOW_SECONDS - 1, { url: "https://evil.example/game/live/2" }),
      ...Array.from({ length: 51 }, (_, index) => game(
        `game-${String(index).padStart(2, "0")}`,
        NOW_SECONDS - 10 - index,
      )),
    ];
    const checkpoints: ImportBatch[] = [];

    const result = await importGames(clientWith({ "2026/09": records }), {
      playerKey: "learner",
      now: NOW,
      signal: new AbortController().signal,
    }, async (batch) => { checkpoints.push(batch); });

    expect(result.games).toHaveLength(50);
    expect(result.games[0].id).toBe("game-00");
    expect(result.games.at(-1)?.id).toBe("game-49");
    expect(result.coverage).toBe("complete");
    expect(result.cursor).toMatchObject({ invalid: 1, ineligible: 1, nextMonth: 0 });
    expect(checkpoints[0].games).toEqual([]);
    expect(checkpoints.at(-1)?.games).toHaveLength(50);
  });

  test("sorts equal completion times by source id and scans months newest first", async () => {
    const requested: string[] = [];
    const client: ChessComClient = {
      archives: async () => ["2026/07", "2026/09", "2026/08"],
      month: async (_username, month) => {
        requested.push(month);
        return month === "2026/09"
          ? [game("z-game"), game("a-game")]
          : [game(month.replace("/", "-"), NOW_SECONDS - requested.length * 100)];
      },
    };

    const result = await importGames(client, {
      playerKey: "learner",
      now: NOW,
      signal: new AbortController().signal,
    }, async () => {});

    expect(requested).toEqual(["2026/09", "2026/08", "2026/07"]);
    expect(result.games.slice(0, 2).map(({ id }) => id)).toEqual(["a-game", "z-game"]);
    expect(result.cursor.nextMonth).toBe(3);
    expect(result.coverage).toBe("complete");
  });

  test("uses UTC month boundaries across January and excludes archives outside twelve months", async () => {
    const requested: string[] = [];
    const client: ChessComClient = {
      archives: async () => ["2024/12", "2025/01", "2025/02", "2025/12", "2026/01", "2026/02"],
      month: async (_username, month) => { requested.push(month); return []; },
    };
    const checkpoints: ImportBatch[] = [];

    const result = await importGames(client, {
      playerKey: "learner",
      now: new Date("2026-01-15T18:00:00-08:00"),
      signal: new AbortController().signal,
    }, async (batch) => { checkpoints.push(batch); });

    expect(requested).toEqual(["2026/01", "2025/12", "2025/02"]);
    expect(result.cursor.windowStart).toBe("2025-02-01T00:00:00.000Z");
    expect(result.cursor.windowEnd).toBe("2026-02-01T00:00:00.000Z");
    expect(checkpoints[0].cursor.months).toEqual(["2026/01", "2025/12", "2025/02"]);
  });

  test("deduplicates by UUID or canonical game URL", async () => {
    const result = await importGames(clientWith({
      "2026/09": [
        game("shared", NOW_SECONDS - 1, { url: "https://www.chess.com/game/live/11" }),
        game("shared", NOW_SECONDS - 2, { url: "https://www.chess.com/game/live/12" }),
        game("different", NOW_SECONDS - 3, { url: "https://www.chess.com/game/live/11" }),
        game("unique", NOW_SECONDS - 4, { url: "https://www.chess.com/game/live/13" }),
      ],
    }), {
      playerKey: "learner",
      now: NOW,
      signal: new AbortController().signal,
    }, async () => {});

    expect(result.games.map(({ id }) => id)).toEqual(["shared", "unique"]);
    expect(result.cursor.seenIds).toEqual(["shared", "unique"]);
  });

  test("resumes from the failed month while preserving selected games and counters", async () => {
    const selected = await importGames(clientWith({ "2026/09": [game("kept")] }), {
      playerKey: "learner",
      now: NOW,
      signal: new AbortController().signal,
    }, async () => {});
    const cursor: ImportCursor = {
      ...selected.cursor,
      months: ["2026/09", "2026/08"],
      nextMonth: 1,
      invalid: 2,
      ineligible: 3,
    };
    const archives = vi.fn(async () => ["should/not/be/requested"]);
    const month = vi.fn(async () => [game("older", NOW_SECONDS - 100)]);

    const result = await importGames({ archives, month }, {
      playerKey: "learner",
      now: NOW,
      signal: new AbortController().signal,
      cursor,
      selected: selected.games,
    }, async () => {});

    expect(archives).not.toHaveBeenCalled();
    expect(month).toHaveBeenCalledWith("learner", "2026/08", expect.any(AbortSignal));
    expect(result.games.map(({ id }) => id)).toEqual(["kept", "older"]);
    expect(result.cursor).toMatchObject({ nextMonth: 2, invalid: 2, ineligible: 3 });
  });

  test("checkpoints accepted records without advancing the month when cancellation interrupts a batch", async () => {
    const controller = new AbortController();
    const checkpoints: ImportBatch[] = [];
    const records = Array.from({ length: 11 }, (_, index) => game(`game-${index}`, NOW_SECONDS - index));
    const originalSetTimeout = globalThis.setTimeout;
    const timeout = vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: TimerHandler, delay?: number) => {
      if (delay === 0) controller.abort();
      return originalSetTimeout(handler, delay);
    }) as typeof setTimeout);

    await expect(importGames(clientWith({ "2026/09": records }), {
      playerKey: "learner",
      now: NOW,
      signal: controller.signal,
    }, async (batch) => { checkpoints.push(batch); })).rejects.toMatchObject({ code: "aborted" });

    timeout.mockRestore();
    expect(checkpoints.at(-1)?.games).toHaveLength(10);
    expect(checkpoints.at(-1)?.cursor.nextMonth).toBe(0);
    expect(checkpoints.at(-1)?.coverage).toBe("partial");
  });

  test("does not count skipped records twice when a partially processed month is retried", async () => {
    const records = [
      game("future", NOW_SECONDS + 1),
      game("invalid", NOW_SECONDS - 1, { url: "https://evil.example/game/live/2" }),
      ...Array.from({ length: 9 }, (_, index) => game(`valid-${index}`, NOW_SECONDS - 10 - index)),
    ];
    const cursor: ImportCursor = {
      months: ["2026/09"],
      nextMonth: 0,
      seenIds: [],
      windowStart: "2025-10-01T00:00:00.000Z",
      windowEnd: "2026-10-01T00:00:00.000Z",
      invalid: 2,
      ineligible: 3,
    };
    const controller = new AbortController();
    const interrupted: ImportBatch[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    const timeout = vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: TimerHandler, delay?: number) => {
      if (delay === 0) controller.abort();
      return originalSetTimeout(handler, delay);
    }) as typeof setTimeout);

    await expect(importGames(clientWith({ "2026/09": records }), {
      playerKey: "learner",
      now: NOW,
      signal: controller.signal,
      cursor,
    }, async (batch) => { interrupted.push(batch); })).rejects.toMatchObject({ code: "aborted" });
    timeout.mockRestore();

    const partial = interrupted.at(-1);
    expect(partial).toMatchObject({
      cursor: { nextMonth: 0, invalid: 2, ineligible: 3 },
      coverage: "partial",
    });
    expect(partial?.games).toHaveLength(8);
    if (!partial) throw new Error("Expected interrupted checkpoint");

    const resumed = await importGames(clientWith({ "2026/09": records }), {
      playerKey: "learner",
      now: NOW,
      signal: new AbortController().signal,
      cursor: partial.cursor,
      selected: partial.games,
    }, async () => {});

    expect(resumed.games).toHaveLength(9);
    expect(resumed.cursor).toMatchObject({ nextMonth: 1, invalid: 3, ineligible: 4 });
  });

  test("does not complete a month when cancellation happens during final-record normalization", async () => {
    const controller = new AbortController();
    const checkpoints: ImportBatch[] = [];
    const raw = game("final-record");
    const pgn = raw.pgn;
    Object.defineProperty(raw, "pgn", {
      enumerable: true,
      get() {
        controller.abort();
        return pgn;
      },
    });

    await expect(importGames(clientWith({ "2026/09": [raw] }), {
      playerKey: "learner",
      now: NOW,
      signal: controller.signal,
    }, async (batch) => { checkpoints.push(batch); })).rejects.toMatchObject({ code: "aborted" });

    expect(checkpoints.at(-1)).toMatchObject({
      games: [],
      cursor: { nextMonth: 0 },
      coverage: "partial",
    });
  });

  test("never overlaps monthly requests", async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/archives")) {
        return new Response(JSON.stringify({
          archives: [
            "https://api.chess.com/pub/player/learner/games/2026/08",
            "https://api.chess.com/pub/player/learner/games/2026/09",
          ],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return new Response(JSON.stringify({ games: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const client = createChessComClient(fetcher);
    const pending = importGames(client, {
      playerKey: "learner",
      now: NOW,
      signal: new AbortController().signal,
    }, async () => {});
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();

    await expect(pending).resolves.toMatchObject({ coverage: "complete" });
    expect(maxActive).toBe(1);
  });

  test("preserves normalized records when a later record fails unexpectedly", async () => {
    const malformed = { ...game("bad"), pgn: { impossible: true } };
    const checkpoints: ImportBatch[] = [];

    const result = await importGames(clientWith({ "2026/09": [game("good"), malformed] }), {
      playerKey: "learner",
      now: NOW,
      signal: new AbortController().signal,
    }, async (batch) => { checkpoints.push(batch); });

    expect(result.games.map(({ id }) => id)).toEqual(["good"]);
    expect(result.cursor.invalid).toBe(1);
    expect(checkpoints.at(-1)?.games.map(({ id }: ImportedGame) => id)).toEqual(["good"]);
  });
});
