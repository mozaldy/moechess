import { ASSESSMENT_POLICY } from "@/lib/assessment/policy";
import type { ImportedGame, ImportCursor } from "@/lib/assessment/types";
import { ImportError, type ChessComClient } from "@/lib/import/chesscom/client";
import { normalizeGame, normalizeUsername } from "@/lib/import/chesscom/normalize";

const MONTH_RE = /^\d{4}\/(0[1-9]|1[0-2])$/;

export interface ImportBatch {
  games: ImportedGame[];
  cursor: ImportCursor;
  coverage: "partial" | "complete";
}

export interface ImportGamesInput {
  playerKey: string;
  now: Date;
  signal: AbortSignal;
  cursor?: ImportCursor;
  selected?: ImportedGame[];
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new ImportError("aborted");
}

function monthDate(month: string): number | null {
  if (!MONTH_RE.test(month)) return null;
  const [year, oneBasedMonth] = month.split("/").map(Number);
  return Date.UTC(year, oneBasedMonth - 1, 1);
}

function sourceId(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) return "";
  const record = raw as Record<string, unknown>;
  if (typeof record.uuid === "string") return record.uuid;
  return typeof record.url === "string" ? record.url : "";
}

function endTime(raw: unknown): number {
  if (typeof raw !== "object" || raw === null) return Number.NEGATIVE_INFINITY;
  const value = (raw as Record<string, unknown>).end_time;
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : Number.NEGATIVE_INFINITY;
}

function sortRaw(records: unknown[]): unknown[] {
  return [...records].sort((left, right) => {
    const byTime = endTime(right) - endTime(left);
    return byTime === 0 ? sourceId(left).localeCompare(sourceId(right)) : byTime;
  });
}

function sortGames(games: ImportedGame[]): ImportedGame[] {
  return [...games].sort((left, right) => {
    const byTime = right.endTime - left.endTime;
    return byTime === 0 ? left.id.localeCompare(right.id) : byTime;
  });
}

function snapshot(
  games: ImportedGame[],
  cursor: ImportCursor,
  coverage: ImportBatch["coverage"],
): ImportBatch {
  return {
    games: sortGames(games),
    cursor: {
      ...cursor,
      months: [...cursor.months],
      seenIds: [...cursor.seenIds],
    },
    coverage,
  };
}

function yieldToBrowser(signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, 0);
    signal.addEventListener("abort", cancel, { once: true });

    function cleanup() {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
    }
    function finish() {
      cleanup();
      resolve();
    }
    function cancel() {
      cleanup();
      reject(new ImportError("aborted"));
    }
  });
}

function cloneCursor(cursor: ImportCursor): ImportCursor {
  return {
    ...cursor,
    months: [...cursor.months],
    seenIds: [...cursor.seenIds],
  };
}

export async function importGames(
  client: ChessComClient,
  input: ImportGamesInput,
  checkpoint: (result: ImportBatch) => Promise<void>,
): Promise<ImportBatch> {
  const playerKey = normalizeUsername(input.playerKey);
  if (!Number.isFinite(input.now.getTime())) throw new TypeError("Invalid import date");
  throwIfAborted(input.signal);

  const nowTime = input.now.getTime();
  const computedStart = new Date(Date.UTC(
    input.now.getUTCFullYear(),
    input.now.getUTCMonth() - (ASSESSMENT_POLICY.importMonths - 1),
    1,
  ));
  const computedEnd = new Date(Date.UTC(
    input.now.getUTCFullYear(),
    input.now.getUTCMonth() + 1,
    1,
  ));

  let cursor: ImportCursor;
  if (input.cursor) {
    cursor = cloneCursor(input.cursor);
  } else {
    const archives = await client.archives(playerKey, input.signal);
    const uniqueMonths = [...new Set(archives)].filter((month) => {
      const timestamp = monthDate(month);
      return timestamp !== null
        && timestamp >= computedStart.getTime()
        && timestamp < computedEnd.getTime();
    }).sort((left, right) => right.localeCompare(left));
    cursor = {
      months: uniqueMonths,
      nextMonth: 0,
      seenIds: [],
      windowStart: computedStart.toISOString(),
      windowEnd: computedEnd.toISOString(),
      invalid: 0,
      ineligible: 0,
    };
  }

  const windowStart = Date.parse(cursor.windowStart);
  const windowEnd = Date.parse(cursor.windowEnd);
  if (
    !Number.isFinite(windowStart)
    || !Number.isFinite(windowEnd)
    || windowStart >= windowEnd
    || !Number.isInteger(cursor.nextMonth)
    || cursor.nextMonth < 0
    || cursor.nextMonth > cursor.months.length
    || cursor.months.some((month) => monthDate(month) === null)
  ) {
    throw new ImportError("invalid-response");
  }

  const games = sortGames(input.selected ?? []).slice(0, ASSESSMENT_POLICY.maxGames);
  const seenIds = new Set([...cursor.seenIds, ...games.map((game) => game.id)]);
  const seenUrls = new Set(games.map((game) => game.url));
  cursor.seenIds = games.map((game) => game.id);

  let coverage: ImportBatch["coverage"] = games.length >= ASSESSMENT_POLICY.maxGames
    || cursor.nextMonth >= cursor.months.length
    ? "complete"
    : "partial";
  await checkpoint(snapshot(games, cursor, coverage));
  if (coverage === "complete") return snapshot(games, cursor, coverage);

  while (cursor.nextMonth < cursor.months.length && games.length < ASSESSMENT_POLICY.maxGames) {
    throwIfAborted(input.signal);
    const month = cursor.months[cursor.nextMonth];
    const countersBeforeMonth = {
      invalid: cursor.invalid,
      ineligible: cursor.ineligible,
    };
    let completedMonth = false;
    try {
      const records = sortRaw(await client.month(playerKey, month, input.signal));
      for (let offset = 0; offset < records.length; offset += 10) {
        const batch = records.slice(offset, offset + 10);
        for (const raw of batch) {
          throwIfAborted(input.signal);
          const result = await normalizeGame(raw, playerKey);
          throwIfAborted(input.signal);
          if (result.kind === "skip") {
            if (result.reason === "invalid") cursor.invalid += 1;
            else cursor.ineligible += 1;
            continue;
          }
          const game = result.game;
          const completedAt = game.endTime * 1_000;
          if (completedAt < windowStart || completedAt >= windowEnd || completedAt > nowTime) {
            cursor.ineligible += 1;
            continue;
          }
          if (seenIds.has(game.id) || seenUrls.has(game.url)) continue;
          seenIds.add(game.id);
          seenUrls.add(game.url);
          games.push(game);
          cursor.seenIds.push(game.id);
          if (games.length >= ASSESSMENT_POLICY.maxGames) break;
        }
        if (games.length >= ASSESSMENT_POLICY.maxGames) break;
        if (offset + 10 < records.length) await yieldToBrowser(input.signal);
      }
      completedMonth = games.length < ASSESSMENT_POLICY.maxGames;
      if (completedMonth) cursor.nextMonth += 1;
    } catch (cause) {
      cursor.invalid = countersBeforeMonth.invalid;
      cursor.ineligible = countersBeforeMonth.ineligible;
      await checkpoint(snapshot(games, cursor, "partial"));
      if (cause instanceof ImportError) throw cause;
      if (input.signal.aborted) throw new ImportError("aborted", { cause });
      throw cause;
    }

    coverage = games.length >= ASSESSMENT_POLICY.maxGames
      || cursor.nextMonth >= cursor.months.length
      ? "complete"
      : "partial";
    await checkpoint(snapshot(games, cursor, coverage));
    if (!completedMonth || coverage === "complete") break;
  }

  return snapshot(games, cursor, coverage);
}
