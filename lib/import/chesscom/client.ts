import { ASSESSMENT_POLICY } from "@/lib/assessment/policy";
import { normalizeUsername } from "@/lib/import/chesscom/normalize";

const ORIGIN = "https://api.chess.com";
const MONTH_RE = /^\d{4}\/(0[1-9]|1[0-2])$/;

export type ImportErrorCode =
  | "not-found"
  | "network"
  | "timeout"
  | "rate-limit"
  | "invalid-response"
  | "aborted";

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  readonly retryAt?: string;

  constructor(code: ImportErrorCode, options: { retryAt?: string; cause?: unknown } = {}) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ImportError";
    this.code = code;
    this.retryAt = options.retryAt;
  }
}

export interface ChessComClient {
  archives(username: string, signal: AbortSignal): Promise<string[]>;
  month(username: string, month: string, signal: AbortSignal): Promise<unknown[]>;
}

function playerPath(username: string): string {
  return encodeURIComponent(normalizeUsername(username));
}

function archivesUrl(username: string): string {
  return `${ORIGIN}/pub/player/${playerPath(username)}/games/archives`;
}

export function monthUrl(username: string, month: string): string {
  if (!MONTH_RE.test(month)) throw new ImportError("invalid-response");
  return `${ORIGIN}/pub/player/${playerPath(username)}/games/${month}`;
}

function abortError(): ImportError {
  return new ImportError("aborted");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds);
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
      reject(abortError());
    }
  });
}

function retryAt(response: Response): string {
  const now = Date.now();
  const value = response.headers.get("Retry-After")?.trim();
  let retryTime: number | null = null;
  if (value && /^\d+$/.test(value)) {
    retryTime = now + Number(value) * 1_000;
  } else if (value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) retryTime = parsed;
  }
  if (retryTime === null) retryTime = now + ASSESSMENT_POLICY.refreshCooldownMs;
  return new Date(Math.max(now, retryTime)).toISOString();
}

function validateFinalDestination(response: Response, requestedUrl: string): void {
  if (response.redirected) throw new ImportError("invalid-response");
  if (response.url !== "" && response.url !== requestedUrl) {
    throw new ImportError("invalid-response");
  }
}

async function requestAttempt(
  fetcher: typeof fetch,
  url: string,
  callerSignal: AbortSignal,
): Promise<unknown> {
  throwIfAborted(callerSignal);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ASSESSMENT_POLICY.requestTimeoutMs);
  const cancel = () => controller.abort(callerSignal.reason);
  callerSignal.addEventListener("abort", cancel, { once: true });

  try {
    const response = await fetcher(url, {
      cache: "default",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
    validateFinalDestination(response, url);
    if (response.status === 429) {
      throw new ImportError("rate-limit", { retryAt: retryAt(response) });
    }
    if (response.status === 404) throw new ImportError("not-found");
    if (response.status >= 500) throw new ImportError("network");
    if (!response.ok) throw new ImportError("invalid-response");
    try {
      return await response.json();
    } catch (cause) {
      if (callerSignal.aborted) throw abortError();
      if (timedOut) throw new ImportError("timeout", { cause });
      throw new ImportError("invalid-response", { cause });
    }
  } catch (cause) {
    if (callerSignal.aborted) throw abortError();
    if (timedOut) throw new ImportError("timeout", { cause });
    if (cause instanceof ImportError) throw cause;
    throw new ImportError("network", { cause });
  } finally {
    clearTimeout(timeout);
    callerSignal.removeEventListener("abort", cancel);
  }
}

async function request(fetcher: typeof fetch, url: string, signal: AbortSignal): Promise<unknown> {
  let lastRetryable: ImportError | null = null;
  for (let attempt = 0; attempt <= ASSESSMENT_POLICY.retryDelaysMs.length; attempt += 1) {
    if (attempt > 0) {
      await delay(ASSESSMENT_POLICY.retryDelaysMs[attempt - 1], signal);
    }
    try {
      return await requestAttempt(fetcher, url, signal);
    } catch (cause) {
      const error = cause instanceof ImportError
        ? cause
        : new ImportError("network", { cause });
      if (error.code !== "network" && error.code !== "timeout") throw error;
      lastRetryable = error;
    }
  }
  throw lastRetryable ?? new ImportError("network");
}

function archiveMonth(value: unknown, username: string): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})\/(0[1-9]|1[0-2])$/.exec(value);
  if (match) return value;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  const path = `/pub/player/${playerPath(username)}/games/`;
  if (
    parsed.origin !== ORIGIN
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.search !== ""
    || parsed.hash !== ""
    || !parsed.pathname.startsWith(path)
  ) {
    return null;
  }
  const month = parsed.pathname.slice(path.length).replace(/\/$/, "");
  return MONTH_RE.test(month) ? month : null;
}

export function createChessComClient(fetcher: typeof fetch = fetch): ChessComClient {
  return {
    async archives(username, signal) {
      const player = normalizeUsername(username);
      const body = await request(fetcher, archivesUrl(player), signal);
      if (typeof body !== "object" || body === null || !("archives" in body)) {
        throw new ImportError("invalid-response");
      }
      const archives = (body as { archives?: unknown }).archives;
      if (!Array.isArray(archives)) throw new ImportError("invalid-response");
      const months = archives.map((value) => archiveMonth(value, player));
      if (months.some((month) => month === null)) throw new ImportError("invalid-response");
      return months as string[];
    },

    async month(username, month, signal) {
      const body = await request(fetcher, monthUrl(username, month), signal);
      if (typeof body !== "object" || body === null || !("games" in body)) {
        throw new ImportError("invalid-response");
      }
      const games = (body as { games?: unknown }).games;
      if (!Array.isArray(games)) throw new ImportError("invalid-response");
      return games;
    },
  };
}
