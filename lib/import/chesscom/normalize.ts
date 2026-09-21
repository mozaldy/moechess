import { parseGames } from "@mliebelt/pgn-parser";
import { Chess, type Move } from "chess.js";
import type { Side } from "@/lib/analysis/engine/types";
import type { ImportedGame, NormalizedGameResult } from "@/lib/assessment/types";
import { START_FEN } from "@/lib/chess/position";

type JsonRecord = Record<string, unknown>;

interface PlayerSource {
  username: string;
  rating?: number;
  result: string;
}

interface ParsedClockMove {
  commentDiag?: { clk?: unknown } | null;
}

interface ParsedClockGame {
  moves?: ParsedClockMove[];
}

const DRAW_RESULTS = new Set([
  "agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient",
]);
const LOSS_RESULTS = new Set([
  "checkmated", "timeout", "resigned", "lose", "abandoned",
  "kingofthehill", "threecheck", "bughousepartnerlose",
]);
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const SOURCE_ID_RE = /^[A-Za-z0-9_-]+$/;
const GAME_PATH_RE = /^\/game\/(?:live|daily)\/(\d+)\/?$/;
const OPENING_PATH_RE = /^\/openings\/([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)\/?$/;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validTimeControl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d+)(?:\+(\d+))?$/.exec(value.trim());
  if (!match) return false;
  const base = Number(match[1]);
  const increment = match[2] === undefined ? 0 : Number(match[2]);
  return Number.isSafeInteger(base) && base > 0
    && Number.isSafeInteger(increment) && increment >= 0;
}

function chessComUrl(value: unknown, pattern: RegExp): { url: string; match: RegExpExecArray } | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash) {
      return null;
    }
    if (url.hostname !== "www.chess.com" && url.hostname !== "chess.com") return null;
    const match = pattern.exec(url.pathname);
    return match ? { url: url.toString(), match } : null;
  } catch {
    return null;
  }
}

function playerSource(value: unknown): PlayerSource | null {
  if (!isRecord(value) || typeof value.username !== "string" || typeof value.result !== "string") {
    return null;
  }
  if (value.rating !== undefined && !finitePositive(value.rating)) return null;
  try {
    return {
      username: normalizeUsername(value.username),
      ...(value.rating === undefined ? {} : { rating: value.rating }),
      result: value.result.trim().toLowerCase(),
    };
  } catch {
    return null;
  }
}

function resultsAgree(result: string, white: string, black: string): boolean {
  if (result === "1-0") return white === "win" && LOSS_RESULTS.has(black);
  if (result === "0-1") return black === "win" && LOSS_RESULTS.has(white);
  return result === "1/2-1/2" && DRAW_RESULTS.has(white) && DRAW_RESULTS.has(black);
}

function completionMatchesBoard(chess: Chess, result: string, white: string, black: string): boolean {
  if (!chess.isCheckmate()) return white !== "checkmated" && black !== "checkmated";
  if (result === "1-0") return black === "checkmated";
  if (result === "0-1") return white === "checkmated";
  return false;
}

function parseClock(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes >= 60 || seconds >= 60) return null;
  const total = hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(total) && total > 0 ? total : null;
}

function parseClocks(pgn: string): Record<number, number> {
  try {
    const parsed = parseGames(pgn, { startRule: "games" }) as unknown as ParsedClockGame[];
    if (parsed.length !== 1 || !Array.isArray(parsed[0]?.moves)) return {};
    return Object.fromEntries(parsed[0].moves.flatMap((move, ply) => {
      const seconds = parseClock(move.commentDiag?.clk);
      return seconds === null ? [] : [[ply, seconds]];
    }));
  } catch {
    return {};
  }
}

function openingSource(value: unknown): ImportedGame["opening"] | null | undefined {
  if (value === undefined) return undefined;
  const parsed = chessComUrl(value, OPENING_PATH_RE);
  if (!parsed) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(parsed.match[1]);
  } catch {
    return null;
  }
  const label = slug.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (label === "" || CONTROL_RE.test(label)) return null;
  return { label, url: parsed.url };
}

function canonicalPgn(moves: Move[], white: string, black: string, result: string): string {
  const clean = new Chess();
  clean.setHeader("White", white);
  clean.setHeader("Black", black);
  clean.setHeader("Result", result);
  for (const move of moves) {
    clean.move({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) });
  }
  return clean.pgn();
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeUsername(input: string): string {
  const normalized = input.trim().toLowerCase();
  if (
    normalized === ""
    || CONTROL_RE.test(normalized)
    || normalized.includes("/")
    || normalized.includes("\\")
    || normalized.startsWith("www.")
    || /^[a-z][a-z\d+.-]*:/i.test(normalized)
  ) {
    throw new TypeError("Invalid Chess.com username");
  }
  return normalized;
}

export async function normalizeGame(raw: unknown, playerKey: string): Promise<NormalizedGameResult> {
  let normalizedPlayer: string;
  try {
    normalizedPlayer = normalizeUsername(playerKey);
  } catch {
    return { kind: "skip", reason: "invalid" };
  }
  if (normalizedPlayer !== playerKey || !isRecord(raw)) return { kind: "skip", reason: "invalid" };

  if (raw.rated !== true || raw.rules !== "chess" || raw.time_class !== "rapid") {
    return { kind: "skip", reason: "ineligible" };
  }
  if (typeof raw.pgn !== "string") return { kind: "skip", reason: "invalid" };

  const gameUrl = chessComUrl(raw.url, GAME_PATH_RE);
  const white = playerSource(raw.white);
  const black = playerSource(raw.black);
  const opening = openingSource(raw.eco);
  if (
    !gameUrl || !white || !black || opening === null
    || !finitePositive(raw.end_time)
    || !Number.isInteger(raw.end_time)
    || !validTimeControl(raw.time_control)
  ) {
    return { kind: "skip", reason: "invalid" };
  }

  const side: Side | null = white.username === playerKey
    ? "white"
    : black.username === playerKey ? "black" : null;
  if (!side || white.username === black.username) return { kind: "skip", reason: "invalid" };

  const chess = new Chess();
  try {
    chess.loadPgn(raw.pgn);
  } catch {
    return { kind: "skip", reason: "invalid" };
  }
  const headers = chess.getHeaders();
  if (headers.SetUp === "1" || (headers.FEN !== undefined && headers.FEN !== START_FEN)) {
    return { kind: "skip", reason: "custom-start" };
  }
  if (headers.FEN !== undefined || chess.history({ verbose: true })[0]?.before !== START_FEN) {
    return { kind: "skip", reason: "custom-start" };
  }

  let pgnWhite: string;
  let pgnBlack: string;
  try {
    pgnWhite = normalizeUsername(headers.White ?? "");
    pgnBlack = normalizeUsername(headers.Black ?? "");
  } catch {
    return { kind: "skip", reason: "invalid" };
  }
  const pgnResult = headers.Result;
  if (pgnResult === "*") return { kind: "skip", reason: "ineligible" };
  if (
    pgnWhite !== white.username || pgnBlack !== black.username
    || (pgnResult !== "1-0" && pgnResult !== "0-1" && pgnResult !== "1/2-1/2")
    || !resultsAgree(pgnResult, white.result, black.result)
    || !completionMatchesBoard(chess, pgnResult, white.result, black.result)
  ) {
    return { kind: "skip", reason: "invalid" };
  }

  const moves = chess.history({ verbose: true });
  if (moves.length === 0) return { kind: "skip", reason: "invalid" };
  const history = { initialFen: START_FEN, moves: moves.map((move) => move.lan) };
  const sans = moves.map((move) => move.san);
  const clocks = parseClocks(raw.pgn);
  const id = typeof raw.uuid === "string" && SOURCE_ID_RE.test(raw.uuid.trim())
    ? raw.uuid.trim()
    : gameUrl.match[1];
  const timeControl = raw.time_control.trim();
  const identity = {
    initialFen: START_FEN,
    moves: history.moves,
    white: white.username,
    black: black.username,
    whiteRating: white.rating ?? null,
    blackRating: black.rating ?? null,
    whiteResult: white.result,
    blackResult: black.result,
    result: pgnResult,
    endTime: raw.end_time,
    timeControl,
    opening: opening ?? null,
    clocks,
  };
  const fingerprint = await sha256(canonicalJson(identity));

  return {
    kind: "game",
    game: {
      playerKey,
      id,
      url: gameUrl.url,
      fingerprint,
      pgn: canonicalPgn(moves, white.username, black.username, pgnResult),
      history,
      sans,
      endTime: raw.end_time,
      side,
      white: white.username,
      black: black.username,
      ...(white.rating === undefined ? {} : { whiteRating: white.rating }),
      ...(black.rating === undefined ? {} : { blackRating: black.rating }),
      whiteResult: white.result,
      blackResult: black.result,
      timeControl,
      ...(opening === undefined ? {} : { opening }),
      clocks,
    },
  };
}
