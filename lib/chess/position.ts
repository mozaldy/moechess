import { Chess, type Move } from "chess.js";

export type PositionKey = string;
export type Side = "white" | "black";
export type Square = string;
export type PieceCode =
  | "wK" | "wQ" | "wR" | "wB" | "wN" | "wP"
  | "bK" | "bQ" | "bR" | "bB" | "bN" | "bP";

export interface AppliedMove {
  san: string;
  from: Square;
  to: Square;
  fenAfter: string;
  keyAfter: PositionKey;
  captured: boolean;
  promotion?: string;
}

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export function positionKey(fen: string): PositionKey {
  return fen.trim().split(/\s+/).slice(0, 4).join(" ");
}

export const START_KEY = positionKey(START_FEN);

export function turnOf(key: PositionKey): Side {
  return key.split(" ")[1] === "b" ? "black" : "white";
}

export function sideLetter(side: Side): "w" | "b" {
  return side === "white" ? "w" : "b";
}

function toApplied(move: Move): AppliedMove {
  return {
    san: move.san,
    from: move.from,
    to: move.to,
    fenAfter: move.after,
    keyAfter: positionKey(move.after),
    captured: Boolean(move.captured),
    ...(move.promotion ? { promotion: move.promotion } : {}),
  };
}

function load(fen: string): Chess | null {
  try {
    return new Chess(fen);
  } catch {
    return null;
  }
}

export function applySan(fen: string, san: string): AppliedMove | null {
  const board = load(fen);
  if (!board) return null;
  try {
    return toApplied(board.move(san.replace(/0/g, "O")));
  } catch {
    return null;
  }
}

export function sanEquals(fen: string, a: string, b: string): boolean {
  const ma = applySan(fen, a);
  const mb = applySan(fen, b);
  return ma !== null && mb !== null && ma.san === mb.san;
}

export function moveFromSquares(
  fen: string, from: Square, to: Square, promotion?: string,
): AppliedMove | null {
  const board = load(fen);
  if (!board) return null;
  try {
    return toApplied(board.move({ from, to, ...(promotion ? { promotion } : {}) }));
  } catch {
    return null;
  }
}

export function legalTargets(fen: string, from: Square): Square[] {
  const board = load(fen);
  if (!board) return [];
  try {
    const targets = board.moves({ square: from as never, verbose: true }).map((m) => m.to);
    return [...new Set(targets)];
  } catch {
    return [];
  }
}

export function needsPromotion(fen: string, from: Square, to: Square): boolean {
  const board = load(fen);
  if (!board) return false;
  try {
    return board
      .moves({ square: from as never, verbose: true })
      .some((m) => m.to === to && Boolean(m.promotion));
  } catch {
    return false;
  }
}

export function piecesOf(fen: string): { square: Square; code: PieceCode }[] {
  const board = load(fen);
  if (!board) return [];
  return board
    .board()
    .flat()
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .map((p) => ({ square: p.square, code: `${p.color}${p.type.toUpperCase()}` as PieceCode }));
}
