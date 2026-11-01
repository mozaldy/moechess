import type { Chess, PieceSymbol, Square } from "chess.js";

/*
 * chess.js 1.4.0 builds a full Move for every result of moves({ verbose: true }),
 * move() and undo(): SAN (a second legal-move generation plus a mate test) and
 * before/after FEN strings. The material certificate visits up to 20,000 positions,
 * so it walks the pinned version's internal move list instead. The public API
 * remains the reference: tests compare these helpers with it.
 */

type Color = "w" | "b";

interface InternalMove {
  color: Color;
  from: number;
  to: number;
  piece: PieceSymbol;
  captured?: PieceSymbol;
  promotion?: PieceSymbol;
  flags: number;
}

interface Internals {
  _turn: Color;
  _hash: bigint;
  _moves(options?: { legal?: boolean }): InternalMove[];
  _makeMove(move: InternalMove): void;
  _undoMove(): InternalMove | null;
  _isKingAttacked(color: Color): boolean;
  _incPositionCount(): void;
  _decPositionCount(hash: bigint): void;
}

export interface LegalMove {
  uci: string;
  to: Square;
  captured?: PieceSymbol;
  internal: InternalMove;
}

function internals(board: Chess): Internals {
  const candidate = board as unknown as Partial<Internals>;
  if (typeof candidate._moves !== "function" || typeof candidate._makeMove !== "function"
    || typeof candidate._undoMove !== "function" || typeof candidate._isKingAttacked !== "function"
    || typeof candidate._incPositionCount !== "function" || typeof candidate._decPositionCount !== "function") {
    throw new Error("chess.js internals changed; update lib/analysis/tactics/board-internals.ts");
  }
  return candidate as Internals;
}

function algebraic(square: number): Square {
  return `${"abcdefgh"[square & 0xf]}${"87654321"[square >> 4]}` as Square;
}

/** Legal moves in public moves() order. */
export function legalMoves(board: Chess): LegalMove[] {
  return internals(board)._moves().map((move) => ({
    uci: algebraic(move.from) + algebraic(move.to) + (move.promotion ?? ""),
    to: algebraic(move.to),
    ...(move.captured ? { captured: move.captured } : {}),
    internal: move,
  }));
}

/** The suffix public SAN would carry: "#" for mate, "+" for check, "" otherwise. */
export function checkSuffix(board: Chess, move: LegalMove): "#" | "+" | "" {
  const inner = internals(board);
  inner._makeMove(move.internal);
  const check = inner._isKingAttacked(inner._turn);
  const mate = check && inner._moves().length === 0;
  inner._undoMove();
  return mate ? "#" : check ? "+" : "";
}

/**
 * Plays a UCI move with board.move({ from, to, promotion })'s matching rules and
 * bookkeeping, without building a Move. Throws when the move is illegal.
 */
export function playUci(board: Chess, uci: string): void {
  const inner = internals(board);
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci[4];
  const move = inner._moves().find((candidate) => algebraic(candidate.from) === from
    && algebraic(candidate.to) === to
    && (candidate.promotion === undefined || candidate.promotion === promotion));
  if (!move) throw new Error(`Invalid move: ${uci}`);
  inner._makeMove(move);
  inner._incPositionCount();
}

/** Same position and repetition bookkeeping as board.move(), without building a Move. */
export function play(board: Chess, move: LegalMove): void {
  const inner = internals(board);
  inner._makeMove(move.internal);
  inner._incPositionCount();
}

/** Same position and repetition bookkeeping as board.undo(), without building a Move. */
export function undo(board: Chess): void {
  const inner = internals(board);
  const hash = inner._hash;
  if (inner._undoMove()) inner._decPositionCount(hash);
}
