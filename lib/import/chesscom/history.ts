import type { GameHistory } from "@/lib/analysis/engine/types";
import type { ImportedGame } from "@/lib/assessment/types";

export function historyBefore(game: ImportedGame, ply: number): GameHistory {
  if (!Number.isInteger(ply) || ply < 0 || ply > game.history.moves.length) {
    throw new RangeError("Invalid game ply");
  }
  return {
    initialFen: game.history.initialFen,
    moves: game.history.moves.slice(0, ply),
  };
}
