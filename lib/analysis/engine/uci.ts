import { Chess } from "chess.js";
import { EngineError, type GameHistory, type SearchRequest, type SearchResult, type Side, type UciMove } from "./types";

const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

function integerAfter(tokens: string[], name: string): number | null {
  const index = tokens.indexOf(name);
  if (index < 0 || index + 1 >= tokens.length || !/^-?\d+$/.test(tokens[index + 1])) return null;
  const value = Number(tokens[index + 1]);
  return Number.isSafeInteger(value) ? value : null;
}

export function isUciMove(value: string): value is UciMove {
  return UCI_MOVE.test(value);
}

export function validateHistory(history: GameHistory): void {
  if (/\r|\n/.test(history.initialFen)) {
    throw new EngineError("protocol", "FEN must be a single line");
  }

  let game: Chess;
  try {
    game = new Chess(history.initialFen);
  } catch (cause) {
    throw new EngineError("protocol", "Invalid initial FEN", { cause });
  }

  for (const move of history.moves) {
    if (!isUciMove(move)) throw new EngineError("protocol", `Invalid UCI move: ${move}`);
    try {
      game.move({ from: move.slice(0, 2), to: move.slice(2, 4), ...(move[4] ? { promotion: move[4] } : {}) });
    } catch (cause) {
      throw new EngineError("protocol", `Illegal UCI move in history: ${move}`, { cause });
    }
  }
}

export function parseInfo(line: string, rootSide: Side, perspective: Side): SearchResult | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== "info" || tokens[1] === "string") return null;

  const depth = integerAfter(tokens, "depth");
  const nodes = integerAfter(tokens, "nodes");
  const scoreIndex = tokens.indexOf("score");
  if (depth === null || depth < 0 || nodes === null || nodes < 0 || scoreIndex < 0) return null;

  const kind = tokens[scoreIndex + 1];
  const rawValue = tokens[scoreIndex + 2];
  if ((kind !== "cp" && kind !== "mate") || !/^-?\d+$/.test(rawValue ?? "")) return null;
  const parsedValue = Number(rawValue);
  if (!Number.isSafeInteger(parsedValue)) return null;

  const lower = tokens.includes("lowerbound");
  const upper = tokens.includes("upperbound");
  if (lower && upper) return null;
  let bound: SearchResult["bound"] = lower ? "lower" : upper ? "upper" : "exact";
  const invert = rootSide !== perspective;
  if (invert && bound !== "exact") bound = bound === "lower" ? "upper" : "lower";

  const pvIndex = tokens.indexOf("pv");
  const pv = pvIndex < 0 ? [] : tokens.slice(pvIndex + 1);
  if (pv.some((move) => !isUciMove(move))) return null;

  return {
    score: { kind, value: invert ? -parsedValue : parsedValue, perspective },
    bound,
    pv,
    nodes,
    depth,
  };
}

export function positionCommand(history: GameHistory): string {
  validateHistory(history);
  return `position fen ${history.initialFen}` +
    (history.moves.length ? ` moves ${history.moves.join(" ")}` : "");
}

export function engineCacheKey(buildId: string, request: SearchRequest): string {
  return JSON.stringify([
    buildId,
    request.history.initialFen,
    request.history.moves,
    request.perspective,
    request.nodes,
    [...(request.rootMoves ?? [])].sort(),
  ]);
}
