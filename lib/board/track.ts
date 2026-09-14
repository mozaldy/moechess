import type { PieceCode, Side, Square } from "@/lib/chess/position";

export interface TrackedPiece {
  id: string;
  square: Square;
  code: PieceCode;
}

const FILES = "abcdefgh";

// Board coordinates in 0..7 with (0, 0) at the top-left from the viewer's side.
export function squareXY(square: Square, orientation: Side): { x: number; y: number } {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]) - 1;
  return orientation === "white" ? { x: file, y: 7 - rank } : { x: 7 - file, y: rank };
}

export function squareAt(x: number, y: number, orientation: Side): Square {
  const file = orientation === "white" ? x : 7 - x;
  const rank = orientation === "white" ? 7 - y : y;
  return `${FILES[file]}${rank + 1}`;
}

export function squareColor(square: Square): "light" | "dark" {
  return (FILES.indexOf(square[0]) + Number(square[1])) % 2 === 0 ? "light" : "dark";
}

function distance(a: Square, b: Square): number {
  return Math.max(Math.abs(FILES.indexOf(a[0]) - FILES.indexOf(b[0])), Math.abs(Number(a[1]) - Number(b[1])));
}

// Keeps a stable id for each piece across positions so the board can animate
// a piece sliding from its old square instead of popping in.
export function trackPieces(prev: TrackedPiece[], next: { square: Square; code: PieceCode }[]): TrackedPiece[] {
  let counter = prev.reduce((max, piece) => Math.max(max, Number(piece.id.split("#")[1]) || 0), 0);
  const stayed = (p: { square: Square; code: PieceCode }) =>
    prev.find((old) => old.square === p.square && old.code === p.code);
  const unmatched = prev.filter((old) => !next.some((p) => p.square === old.square && p.code === old.code));

  return next.map((piece) => {
    const same = stayed(piece);
    if (same) return same;
    const candidates = unmatched.filter((old) => old.code === piece.code);
    if (candidates.length > 0) {
      const nearest = candidates.reduce((best, old) =>
        distance(old.square, piece.square) < distance(best.square, piece.square) ? old : best);
      unmatched.splice(unmatched.indexOf(nearest), 1);
      return { ...nearest, square: piece.square };
    }
    counter += 1;
    return { id: `${piece.code}#${counter}`, ...piece };
  });
}
