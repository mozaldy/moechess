import { Chess } from "chess.js";
import { moveNumberLabel } from "@/lib/course/labels";
import type { Finding } from "./types";

export interface ReplayFrame {
  fen: string;
  san: string | null;
  moveLabel: string;
  lastMove: { from: string; to: string } | null;
}

const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export function buildReplay(initialFen: string, moves: string[]): ReplayFrame[] {
  const board = new Chess(initialFen);
  const frames: ReplayFrame[] = [
    { fen: board.fen(), san: null, moveLabel: "Starting position", lastMove: null },
  ];
  if (!Array.isArray(moves)) throw new Error("Invalid evidence line");
  for (const uci of moves) {
    if (typeof uci !== "string" || !UCI_MOVE.test(uci)) throw new Error("Invalid evidence move");
    const move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    frames.push({
      fen: board.fen(), san: move.san,
      moveLabel: moveNumberLabel(board.fen(), move.san),
      lastMove: { from: move.from, to: move.to },
    });
  }
  return frames;
}

export function findingReplay(finding: Finding, branch: "played" | "recommended"): ReplayFrame[] {
  const played = buildReplay(finding.beforeFen, [finding.played]);
  if (played[1].fen !== finding.afterFen) throw new Error("Saved position does not match the move");
  const line = branch === "played" ? finding.playedLine : finding.recommendedLine;
  const root = branch === "played" ? finding.played : finding.recommended;
  if (!Array.isArray(line) || line[0] !== root) throw new Error("Evidence root does not match");
  if (finding.tacticalPly !== 0 && finding.tacticalPly !== 1) throw new Error("Invalid tactical ply");
  const tacticalLine = finding.direction === "allowed" ? finding.playedLine : finding.recommendedLine;
  if (!Array.isArray(tacticalLine) || tacticalLine.length <= finding.tacticalPly) {
    throw new Error("Tactic is missing from the evidence");
  }
  return buildReplay(finding.beforeFen, line);
}
