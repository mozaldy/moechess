import { Chess, type Move, type PieceSymbol, type Square } from "chess.js";
import type { GameHistory, Side } from "@/lib/analysis/engine/types";
import { yieldToEventLoop } from "@/lib/analysis/yield";
import { checkSuffix, legalMoves, play, undo, type LegalMove } from "./board-internals";
import { replayHistory } from "./candidates";

const VALUES: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const MAX_PLIES = 6;
const MAX_VISITED = 20_000;
const YIELD_EVERY = 250;

export type MaterialCertificate =
  | { kind: "gain"; gain: number; line: string[] }
  | { kind: "mate"; line: string[] }
  | { kind: "inconclusive" | "rejected"; reason: string };

export interface MaterialSearchLimits {
  maxVisited?: number;
}

type SearchOutcome = MaterialCertificate;

function colorFor(side: Side): "w" | "b" {
  return side === "white" ? "w" : "b";
}

function abortError(): DOMException {
  return new DOMException("Analysis was aborted", "AbortError");
}

function moveDescriptor(uci: string): { from: Square; to: Square; promotion?: PieceSymbol } {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw new Error(`Invalid UCI move: ${uci}`);
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    ...(uci[4] ? { promotion: uci[4] as PieceSymbol } : {}),
  };
}

export function materialBalance(board: Chess, side: Side): number {
  const color = colorFor(side);
  return board.board().flat().reduce((sum, piece) => piece
    ? sum + VALUES[piece.type] * (piece.color === color ? 1 : -1)
    : sum, 0);
}

function orderedMoves(board: Chess, moves: LegalMove[]): LegalMove[] {
  const priority = new Map(moves.map((move) => {
    const suffix = checkSuffix(board, move);
    return [move, suffix === "#" ? 4 : suffix === "+" ? 3 : move.captured ? 2 : 1];
  }));
  return [...moves].sort((left, right) => priority.get(right)! - priority.get(left)!);
}

function rejected(reason: string): MaterialCertificate {
  return { kind: "rejected", reason };
}

function inconclusive(reason: string): MaterialCertificate {
  return { kind: "inconclusive", reason };
}

function chooseForBeneficiary(outcomes: Array<{ move: string; outcome: SearchOutcome }>): SearchOutcome {
  const mates = outcomes.find(({ outcome }) => outcome.kind === "mate");
  if (mates?.outcome.kind === "mate") return { kind: "mate", line: [mates.move, ...mates.outcome.line] };
  const gains = outcomes
    .filter((entry): entry is { move: string; outcome: Extract<SearchOutcome, { kind: "gain" }> } => entry.outcome.kind === "gain")
    .sort((a, b) => b.outcome.gain - a.outcome.gain);
  if (gains[0]) return { kind: "gain", gain: gains[0].outcome.gain, line: [gains[0].move, ...gains[0].outcome.line] };
  const uncertain = outcomes.find(({ outcome }) => outcome.kind === "inconclusive");
  return uncertain?.outcome ?? rejected("No continuation preserves a concrete material gain");
}

function chooseForOpponent(outcomes: Array<{ move: string; outcome: SearchOutcome }>): SearchOutcome {
  const refutation = outcomes.find(({ outcome }) => outcome.kind === "rejected");
  if (refutation) return rejected(`Defense ${refutation.move} refutes the claimed gain`);
  const uncertain = outcomes.find(({ outcome }) => outcome.kind === "inconclusive");
  if (uncertain) return inconclusive(`Defense ${uncertain.move} is unresolved within the certificate limit`);
  const gains = outcomes
    .filter((entry): entry is { move: string; outcome: Extract<SearchOutcome, { kind: "gain" }> } => entry.outcome.kind === "gain")
    .sort((a, b) => a.outcome.gain - b.outcome.gain);
  if (gains[0]) return { kind: "gain", gain: gains[0].outcome.gain, line: [gains[0].move, ...gains[0].outcome.line] };
  const mate = outcomes.find(({ outcome }) => outcome.kind === "mate");
  return mate?.outcome.kind === "mate"
    ? { kind: "mate", line: [mate.move, ...mate.outcome.line] }
    : inconclusive("No defensive continuation could be certified");
}

export async function certifyGain(
  history: GameHistory,
  move: string,
  beneficiary: Side,
  signal: AbortSignal,
  limits: MaterialSearchLimits = {},
): Promise<MaterialCertificate> {
  if (signal.aborted) throw abortError();
  const board = replayHistory(history);
  const baseline = materialBalance(board, beneficiary);
  const beneficiaryColor = colorFor(beneficiary);
  let first: Move;
  try {
    first = board.move(moveDescriptor(move));
  } catch {
    return rejected("The tactical move is illegal in the recorded position");
  }
  let visited = 0;
  const maxVisited = Math.max(1, Math.min(MAX_VISITED, Math.floor(limits.maxVisited ?? MAX_VISITED)));

  const search = async (
    depth: number,
    lastBeneficiaryCapture: Square | null,
    resolvedRecapture = false,
  ): Promise<SearchOutcome> => {
    if (signal.aborted) throw abortError();
    if (visited >= maxVisited) {
      return inconclusive(`The defensive certificate reached the ${maxVisited.toLocaleString("en-US")}-position limit`);
    }
    visited += 1;
    if (visited % YIELD_EVERY === 0) {
      await yieldToEventLoop();
      if (signal.aborted) throw abortError();
    }

    const gain = materialBalance(board, beneficiary) - baseline;
    const moves = legalMoves(board);
    const inCheck = board.isCheck();
    if (inCheck && moves.length === 0) {
      return board.turn() === beneficiaryColor
        ? rejected("The claimed continuation allows mate against the beneficiary")
        : { kind: "mate", line: [] };
    }
    // Same as isGameOver() once checkmate is excluded: no moves here is stalemate.
    if (moves.length === 0 || board.isDrawByFiftyMoves() || board.isInsufficientMaterial() || board.isThreefoldRepetition()) {
      return gain >= 1 ? { kind: "gain", gain, line: [] } : rejected("The terminal line has no material gain");
    }

    if (gain >= 1 && resolvedRecapture) return { kind: "gain", gain, line: [] };

    if (depth >= MAX_PLIES) {
      return gain >= 1
        ? inconclusive("The material consequence is unresolved after six plies")
        : rejected("No net material gain resolves within six plies");
    }

    const beneficiaryTurn = board.turn() === beneficiaryColor;
    const outcomes: Array<{ move: string; outcome: SearchOutcome }> = [];
    for (const legal of orderedMoves(board, moves)) {
      const uci = legal.uci;
      const isRecapture = !beneficiaryTurn
        && lastBeneficiaryCapture !== null
        && Boolean(legal.captured)
        && legal.to === lastBeneficiaryCapture;
      play(board, legal);
      const resolvesCapture = !beneficiaryTurn
        && lastBeneficiaryCapture !== null
        && (isRecapture || !board.isCheck());
      const nextCapture = beneficiaryTurn
        ? (legal.captured ? legal.to : lastBeneficiaryCapture)
        : resolvesCapture ? null : lastBeneficiaryCapture;
      const outcome = await search(depth + 1, nextCapture, resolvesCapture);
      undo(board);
      outcomes.push({ move: uci, outcome });

      if (!beneficiaryTurn && outcome.kind === "rejected") break;
      if (beneficiaryTurn && (outcome.kind === "mate" || outcome.kind === "gain")) break;
    }
    return beneficiaryTurn ? chooseForBeneficiary(outcomes) : chooseForOpponent(outcomes);
  };

  const firstCapture = first.color === beneficiaryColor && first.captured ? first.to : null;
  const outcome = await search(1, firstCapture);
  if (outcome.kind === "gain") return { ...outcome, line: [move, ...outcome.line] };
  if (outcome.kind === "mate") return { ...outcome, line: [move, ...outcome.line] };
  return outcome;
}
