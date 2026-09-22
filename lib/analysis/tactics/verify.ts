import { Chess, type PieceSymbol, type Square } from "chess.js";
import type { Finding, VerificationPass } from "@/lib/assessment/types";
import { EngineError, type AnalysisEngine, type GameHistory, type SearchResult, type Side } from "@/lib/analysis/engine/types";
import { findCandidates, mateMoves, replayHistory, toUci } from "./candidates";
import { certifyGain, materialBalance, type MaterialCertificate } from "./material";
import type { Candidate } from "./types";

const BUDGETS = [200_000, 400_000] as const;

type FindingCore = Omit<Finding, "id" | "gameId" | "playerKey" | "ply" | "executed" | "lowTime">;

export type VerificationResult =
  | { kind: "verified"; finding: FindingCore }
  | { kind: "rejected" | "inconclusive"; reason: string };

function opposite(side: Side): Side {
  return side === "white" ? "black" : "white";
}

function descriptor(uci: string): { from: Square; to: Square; promotion?: PieceSymbol } {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw new Error(`Invalid UCI move: ${uci}`);
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    ...(uci[4] ? { promotion: uci[4] as PieceSymbol } : {}),
  };
}

function append(history: GameHistory, move: string): GameHistory {
  return { initialFen: history.initialFen, moves: [...history.moves, move] };
}

function fenAfter(history: GameHistory, move: string): string {
  const board = replayHistory(history);
  board.move(descriptor(move));
  return board.fen();
}

function legalLine(history: GameHistory, line: string[], requiredRoot?: string): boolean {
  if (line.length === 0 || (requiredRoot !== undefined && line[0] !== requiredRoot)) return false;
  let board: Chess;
  try {
    board = replayHistory(history);
    for (const uci of line) board.move(descriptor(uci));
  } catch {
    return false;
  }
  return true;
}

function validResult(result: SearchResult, history: GameHistory, side: Side, root?: string): boolean {
  return result.score.perspective === side
    && result.bound === "exact"
    && legalLine(history, result.pv, root);
}

function resultAmbiguous(pass: VerificationPass, candidate: Candidate, tacticalHistory: GameHistory): boolean {
  return !validResult(pass.best, candidate.history, candidate.side)
    || !validResult(pass.played, candidate.history, candidate.side, candidate.played)
    || !validResult(pass.tactic, tacticalHistory, candidate.side, candidate.tactic);
}

export function passesMaterialGate(pass: VerificationPass): boolean {
  const { best, played, tactic } = pass;
  return [best, played, tactic].every((result) => result.bound === "exact" && result.score.kind === "cp")
    && best.score.perspective === played.score.perspective
    && tactic.score.perspective === played.score.perspective
    && best.score.value - played.score.value >= 100;
}

async function runPass(
  candidate: Candidate,
  engine: AnalysisEngine,
  nodes: number,
  signal: AbortSignal,
): Promise<VerificationPass> {
  const root = { history: candidate.history, perspective: candidate.side, nodes };
  const analyze = async (label: string, request: Parameters<AnalysisEngine["analyze"]>[0]): Promise<SearchResult> => {
    try {
      return await engine.analyze(request, signal);
    } catch (error) {
      if (error instanceof EngineError && error.code === "protocol") {
        throw new EngineError("protocol", `${label} search: ${error.message}`, { cause: error });
      }
      throw error;
    }
  };
  const best = await analyze("best", root);
  const played = await analyze("played", { ...root, rootMoves: [candidate.played] });
  const tacticalHistory = candidate.direction === "missed"
    ? candidate.history
    : append(candidate.history, candidate.played);
  const tactic = await analyze("tactic", {
    ...root,
    history: tacticalHistory,
    rootMoves: [candidate.tactic],
  });
  return { best, played, tactic };
}

function mateSupported(candidate: Candidate, pass: VerificationPass): boolean {
  const best = pass.best.score;
  const played = pass.played.score;
  const tactic = pass.tactic.score;
  if (candidate.direction === "missed") {
    return best.kind === "mate" && best.value > 0
      && tactic.kind === "mate" && tactic.value > 0
      && !(played.kind === "mate" && played.value > 0);
  }
  return tactic.kind === "mate" && tactic.value < 0
    && played.kind === "mate" && played.value < 0
    && !(best.kind === "mate" && best.value < 0);
}

function materialSupported(candidate: Candidate, pass: VerificationPass): boolean {
  if (!passesMaterialGate(pass)) return false;
  if (pass.tactic.score.kind !== "cp" || pass.played.score.kind !== "cp" || pass.best.score.kind !== "cp") return false;
  return candidate.direction === "missed"
    ? pass.tactic.score.value - pass.played.score.value >= 100
    : pass.best.score.value - pass.tactic.score.value >= 100;
}

function namedTargetCaptured(candidate: Candidate, line: string[]): boolean {
  if (candidate.theme !== "fork") return true;
  const board = replayHistory(candidate.direction === "missed" ? candidate.history : append(candidate.history, candidate.played));
  const targetSquares = new Set(candidate.targets);
  const beneficiary = candidate.direction === "missed" ? candidate.side : opposite(candidate.side);
  const beneficiaryColor = beneficiary === "white" ? "w" : "b";

  try {
    for (const uci of line) {
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const mover = board.get(from as Square);
      const capturedNamedTarget = targetSquares.has(to) && mover?.color === beneficiaryColor;
      const targetMoved = targetSquares.has(from);
      board.move(descriptor(uci));
      if (capturedNamedTarget) return true;
      if (targetMoved) {
        targetSquares.delete(from);
        targetSquares.add(to);
      }
    }
  } catch {
    return false;
  }
  return false;
}

export function engineLineSupports(
  candidate: Candidate,
  line: string[],
  certificate: Extract<MaterialCertificate, { kind: "gain" | "mate" }>,
): boolean {
  const tacticalHistory = candidate.direction === "missed"
    ? candidate.history
    : append(candidate.history, candidate.played);
  const board = replayHistory(tacticalHistory);
  const beneficiary = candidate.direction === "missed" ? candidate.side : opposite(candidate.side);
  const baseline = materialBalance(board, beneficiary);
  const boundedLine = line.slice(0, 6);
  try {
    for (const uci of boundedLine) {
      board.move(descriptor(uci));
      if (certificate.kind === "mate" && board.isCheckmate()) return true;
    }
  } catch {
    return false;
  }
  return certificate.kind === "gain"
    && materialBalance(board, beneficiary) - baseline >= 1
    && namedTargetCaptured(candidate, boundedLine);
}

function tacticalAlternativeReplies(candidate: Candidate, bestMove: string, bestLines: string[][]): string[] {
  const alternative = append(candidate.history, bestMove);
  const board = replayHistory(alternative);
  const beneficiaryColor = opposite(candidate.side) === "white" ? "w" : "b";
  const replies = new Set<string>();

  for (const line of bestLines) {
    if (line[0] === bestMove && line[1]) replies.add(line[1]);
  }
  for (const { direction, tactic } of findCandidates(candidate.history, bestMove, candidate.side)) {
    if (direction === "allowed") replies.add(tactic);
  }

  const attacksBefore = new Set<string>();
  const targetSquares: Square[] = [];
  for (const rank of board.board()) {
    for (const piece of rank) {
      if (!piece || piece.color === beneficiaryColor || piece.type === "p" || piece.type === "k") continue;
      targetSquares.push(piece.square);
      for (const attacker of board.attackers(piece.square, beneficiaryColor)) {
        attacksBefore.add(`${attacker}:${piece.square}`);
      }
    }
  }

  for (const move of board.moves({ verbose: true })) {
    const uci = toUci(move);
    if (move.captured || move.san.includes("+") || move.san.includes("#")) replies.add(uci);
    board.move(move);
    const createsAttack = targetSquares.some((square) => board.attackers(square, beneficiaryColor)
      .some((attacker) => !attacksBefore.has(`${attacker}:${square}`)));
    if (createsAttack) replies.add(uci);
    board.undo();
  }
  return [...replies];
}

async function alternativeAvoidsConsequence(
  candidate: Candidate,
  bestLines: string[][],
  claimed: MaterialCertificate,
  signal: AbortSignal,
): Promise<boolean> {
  if (candidate.direction !== "allowed") return true;
  const bestMove = bestLines.at(-1)?.[0];
  if (!bestMove) return false;
  const alternative = append(candidate.history, bestMove);

  if (mateMoves(alternative).length > 0) return false;
  const replies = claimed.kind === "mate"
    ? [...new Set(bestLines.flatMap((line) => line[0] === bestMove && line[1] ? [line[1]] : []))]
    : tacticalAlternativeReplies(candidate, bestMove, bestLines);
  for (const reply of replies) {
    const consequence = await certifyGain(alternative, reply, opposite(candidate.side), signal);
    if (consequence.kind === "mate") return false;
    if (consequence.kind === "gain" && claimed.kind === "gain" && consequence.gain >= claimed.gain) return false;
    if (consequence.kind === "inconclusive") return false;
  }
  return true;
}

function finding(
  candidate: Candidate,
  passes: VerificationPass[],
  certificate: MaterialCertificate,
): FindingCore {
  const bestMove = passes[1].best.pv[0];
  const materialGain = certificate.kind === "gain" ? certificate.gain : 0;
  const mate = candidate.theme === "mate-one" || certificate.kind === "mate";
  const playedLine = candidate.direction === "missed"
    ? passes[1].played.pv
    : [candidate.played, ...(certificate.kind === "gain" || certificate.kind === "mate"
      ? certificate.line
      : [candidate.tactic])];
  const recommendedLine = candidate.direction === "missed"
    ? (certificate.kind === "gain" || certificate.kind === "mate" ? certificate.line : [candidate.tactic])
    : passes[1].best.pv;
  return {
    theme: candidate.theme,
    direction: candidate.direction,
    side: candidate.side,
    beforeFen: replayHistory(candidate.history).fen(),
    afterFen: fenAfter(candidate.history, candidate.played),
    played: candidate.played,
    recommended: candidate.direction === "missed" ? candidate.tactic : bestMove,
    playedLine,
    recommendedLine,
    tacticalPly: candidate.tacticalPly,
    targets: candidate.targets,
    consequence: { kind: mate ? "mate" : "material", gain: mate ? 0 : materialGain },
    verification: { first: passes[0], second: passes[1] },
  };
}

export async function verifyCandidate(
  candidate: Candidate,
  engine: AnalysisEngine,
  signal: AbortSignal,
): Promise<VerificationResult> {
  const passes: VerificationPass[] = [];
  const tacticalHistory = candidate.direction === "missed"
    ? candidate.history
    : append(candidate.history, candidate.played);

  try {
    for (const nodes of BUDGETS) {
      const pass = await runPass(candidate, engine, nodes, signal);
      if (resultAmbiguous(pass, candidate, tacticalHistory)) {
        return { kind: "inconclusive", reason: "Engine result was bounded or contained an invalid principal variation" };
      }
      passes.push(pass);
      const supported = candidate.theme === "mate-one"
        ? mateSupported(candidate, pass)
        : materialSupported(candidate, pass) || (
          candidate.theme === "fork"
          && mateSupported(candidate, pass)
        );
      if (!supported) return { kind: "rejected", reason: "The consequence was not stable at both engine budgets" };
    }
  } catch (error) {
    if (error instanceof EngineError && error.code === "protocol") {
      return { kind: "inconclusive", reason: `Engine protocol did not provide exact usable evidence: ${error.message}` };
    }
    throw error;
  }

  if (candidate.theme === "mate-one") {
    if (!mateMoves(tacticalHistory).includes(candidate.tactic)) {
      return { kind: "rejected", reason: "The claimed move is not an immediate legal mate" };
    }
    if (!await alternativeAvoidsConsequence(candidate, passes.map(({ best }) => best.pv), { kind: "mate", line: [candidate.tactic] }, signal)) {
      return { kind: "rejected", reason: "The immediate mate was not newly caused by the played move" };
    }
    if (passes.some((pass) => !engineLineSupports(candidate, pass.tactic.pv, { kind: "mate", line: [candidate.tactic] }))) {
      return { kind: "inconclusive", reason: "The engine principal variation does not complete the mating consequence" };
    }
    return { kind: "verified", finding: finding(candidate, passes, { kind: "mate", line: [candidate.tactic] }) };
  }

  const beneficiary = candidate.direction === "missed" ? candidate.side : opposite(candidate.side);
  const certificate = await certifyGain(tacticalHistory, candidate.tactic, beneficiary, signal);
  if (certificate.kind !== "gain" && certificate.kind !== "mate") return certificate;
  if (certificate.kind === "gain" && certificate.gain < 1) {
    return { kind: "rejected", reason: "The concrete line gains less than one pawn" };
  }
  if (certificate.kind === "gain" && !namedTargetCaptured(candidate, certificate.line)) {
    return { kind: "rejected", reason: "The fork line does not win either named target" };
  }
  if (passes.some((pass) => !engineLineSupports(candidate, pass.tactic.pv, certificate))) {
    return { kind: "inconclusive", reason: "The engine principal variation does not reach the certified consequence" };
  }
  if (!await alternativeAvoidsConsequence(candidate, passes.map(({ best }) => best.pv), certificate, signal)) {
    return { kind: "rejected", reason: "The same forced consequence survives the best alternative" };
  }
  return { kind: "verified", finding: finding(candidate, passes, certificate) };
}
