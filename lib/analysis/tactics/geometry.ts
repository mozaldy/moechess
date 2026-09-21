import { Chess, type Square } from "chess.js";

type Offset = readonly [file: number, rank: number];

const KNIGHT_OFFSETS: Offset[] = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
];
const KING_OFFSETS: Offset[] = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1],
  [0, 1], [1, -1], [1, 0], [1, 1],
];
const BISHOP_RAYS: Offset[] = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ROOK_RAYS: Offset[] = [[-1, 0], [0, -1], [0, 1], [1, 0]];

function coordinates(square: string): [number, number] | null {
  if (!/^[a-h][1-8]$/.test(square)) return null;
  return [square.charCodeAt(0) - 97, Number(square[1]) - 1];
}

function squareAt(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return `${String.fromCharCode(97 + file)}${rank + 1}` as Square;
}

export function attackedTargets(board: Chess, square: string): string[] {
  const origin = coordinates(square);
  if (!origin) return [];

  const piece = board.get(square as Square);
  if (!piece) return [];

  const targets: string[] = [];
  const addOccupiedEnemy = (file: number, rank: number): void => {
    const targetSquare = squareAt(file, rank);
    if (!targetSquare) return;
    const target = board.get(targetSquare);
    if (target && target.color !== piece.color) targets.push(targetSquare);
  };

  const [file, rank] = origin;
  if (piece.type === "p") {
    const step = piece.color === "w" ? 1 : -1;
    addOccupiedEnemy(file - 1, rank + step);
    addOccupiedEnemy(file + 1, rank + step);
  } else if (piece.type === "n" || piece.type === "k") {
    const offsets = piece.type === "n" ? KNIGHT_OFFSETS : KING_OFFSETS;
    for (const [fileDelta, rankDelta] of offsets) {
      addOccupiedEnemy(file + fileDelta, rank + rankDelta);
    }
  } else {
    const rays = piece.type === "b"
      ? BISHOP_RAYS
      : piece.type === "r"
        ? ROOK_RAYS
        : [...BISHOP_RAYS, ...ROOK_RAYS];
    for (const [fileStep, rankStep] of rays) {
      for (let distance = 1; distance < 8; distance += 1) {
        const targetSquare = squareAt(file + fileStep * distance, rank + rankStep * distance);
        if (!targetSquare) break;
        const target = board.get(targetSquare);
        if (!target) continue;
        if (target.color !== piece.color) targets.push(targetSquare);
        break;
      }
    }
  }

  return targets.sort();
}
