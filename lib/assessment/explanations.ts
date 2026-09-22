import type { Finding } from "@/lib/assessment/types";
import { moveFromSquares } from "@/lib/chess/position";

const titles = {
  "hanging:missed": "Missed hanging piece",
  "hanging:allowed": "Allowed a hanging piece",
  "mate-one:missed": "Missed mate in one",
  "mate-one:allowed": "Allowed mate in one",
  "fork:missed": "Missed fork",
  "fork:allowed": "Allowed a fork",
} as const;

const advice = {
  "hanging:missed": "Before choosing a move, scan every legal capture and check whether the target is defended.",
  "hanging:allowed": "Before moving a piece, check which pieces and squares it currently protects.",
  "mate-one:missed": "Start each move by scanning forcing checks, then captures and threats.",
  "mate-one:allowed": "Before committing to a move, scan every check your opponent could play next.",
  "fork:missed": "Look for moves that attack two valuable targets at once, especially checks with knights and pawns.",
  "fork:allowed": "Before placing pieces, check whether one enemy move could attack two of them at once.",
} as const;

function san(fen: string, uci: string): string {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return uci;
  return moveFromSquares(fen, uci.slice(0, 2), uci.slice(2, 4), uci[4])?.san ?? uci;
}

function sanLine(fen: string, line: string[]): string[] {
  const moves: string[] = [];
  let current = fen;
  for (const uci of line) {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) break;
    const move = moveFromSquares(current, uci.slice(0, 2), uci.slice(2, 4), uci[4]);
    if (!move) break;
    moves.push(move.san);
    current = move.fenAfter;
  }
  return moves;
}

function consequence(finding: Finding): string {
  const evidenceLine = finding.direction === "missed" ? finding.recommendedLine : finding.playedLine;
  const continuation = sanLine(finding.beforeFen, evidenceLine);
  const line = continuation.length > 0 ? ` (${continuation.join(" ")})` : "";
  if (finding.consequence.kind === "mate") {
    return `The verified continuation${line} ends in immediate mate.`;
  }
  const amount = finding.consequence.gain;
  const material = `${amount} pawn${amount === 1 ? "" : "s"} of material`;
  if (finding.theme === "fork" && finding.targets.length > 0) {
    return `The fork attacks ${finding.targets.join(" and ")} and the verified continuation${line} gains ${material}.`;
  }
  if (finding.targets.length > 0) {
    return `The target on ${finding.targets.join(" and ")} leads to a verified gain of ${material}.`;
  }
  return `The verified continuation${line} gains ${material}.`;
}

export function explainFinding(finding: Finding): { title: string; explanation: string; advice: string } {
  const key = `${finding.theme}:${finding.direction}` as keyof typeof titles;
  const played = san(finding.beforeFen, finding.played);
  const recommended = san(finding.beforeFen, finding.recommended);
  const action = finding.direction === "missed"
    ? `You could have played ${recommended}; you played ${played}.`
    : `You played ${played}. You could have played ${recommended} to avoid the verified consequence.`;
  const clock = finding.lowTime
    ? " You had under 30 seconds on the clock; treat that as context for the example."
    : "";
  return {
    title: titles[key],
    explanation: `${action} ${consequence(finding)}${clock}`,
    advice: advice[key],
  };
}
