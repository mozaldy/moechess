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

export function passesMaterialGate(pass: VerificationPass): boolean {
  const { best, played, tactic } = pass;
  return [best, played, tactic].every((result) => result.bound === "exact" && result.score.kind === "cp")
    && best.score.perspective === played.score.perspective
    && tactic.score.perspective === played.score.perspective
    && best.score.value - played.score.value >= 100;
}

const AMBIGUOUS = "Engine result was bounded or contained an invalid principal variation";
const UNSTABLE = "The consequence was not stable at both engine budgets";

type Unverified = Extract<VerificationResult, { kind: "rejected" | "inconclusive" }>;
type PassResult = { kind: "pass"; pass: VerificationPass } | Unverified;

/**
 * Whether the best and played searches alone leave room for the candidate's consequence.
 * Each theme's support test below also requires this, so a false result is a rejection
 * whatever the tactic search returns. Every candidate at a decision shares these two
 * searches, which lets quiet decisions skip one tactic search per candidate.
 */
function consequencePossible(candidate: Candidate, best: SearchResult, played: SearchResult): boolean {
  const material = best.score.kind === "cp" && played.score.kind === "cp"
    && best.score.value - played.score.value >= 100;
  const mate = candidate.direction === "missed"
    ? best.score.kind === "mate" && best.score.value > 0 && !(played.score.kind === "mate" && played.score.value > 0)
    : played.score.kind === "mate" && played.score.value < 0 && !(best.score.kind === "mate" && best.score.value < 0);
  if (candidate.theme === "mate-one") return mate;
  if (candidate.theme === "hanging") return material;
  return material || mate;
}

async function runPass(
  candidate: Candidate,
  engine: AnalysisEngine,
  nodes: number,
  signal: AbortSignal,
  beforeTactic: (best: SearchResult, played: SearchResult) => Promise<Unverified | null>,
): Promise<PassResult> {
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
  if (!validResult(best, candidate.history, candidate.side)
    || !validResult(played, candidate.history, candidate.side, candidate.played)) {
    return { kind: "inconclusive", reason: AMBIGUOUS };
  }
  if (!consequencePossible(candidate, best, played)) return { kind: "rejected", reason: UNSTABLE };
  const blocked = await beforeTactic(best, played);
  if (blocked) return blocked;
  const tacticalHistory = candidate.direction === "missed"
    ? candidate.history
    : append(candidate.history, candidate.played);
  const tactic = await analyze("tactic", {
    ...root,
    history: tacticalHistory,
    rootMoves: [candidate.tactic],
  });
  if (!validResult(tactic, tacticalHistory, candidate.side, candidate.tactic)) {
    return { kind: "inconclusive", reason: AMBIGUOUS };
  }
  return { kind: "pass", pass: { best, played, tactic } };
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

function certificateFailure(candidate: Candidate, certificate: MaterialCertificate): Unverified | null {
  if (certificate.kind !== "gain" && certificate.kind !== "mate") return certificate;
  if (certificate.kind === "gain" && certificate.gain < 1) {
    return { kind: "rejected", reason: "The concrete line gains less than one pawn" };
  }
  if (certificate.kind === "gain" && !namedTargetCaptured(candidate, certificate.line)) {
    return { kind: "rejected", reason: "The fork line does not win either named target" };
  }
  return null;
}

export interface CertificateSource {
  certificate(candidate: Candidate, best: SearchResult, played: SearchResult): Promise<MaterialCertificate>;
}

function tacticalSetup(candidate: Candidate): { history: GameHistory; beneficiary: Side } {
  return candidate.direction === "missed"
    ? { history: candidate.history, beneficiary: candidate.side }
    : { history: append(candidate.history, candidate.played), beneficiary: opposite(candidate.side) };
}

function certify(candidate: Candidate, signal: AbortSignal): Promise<MaterialCertificate> {
  const { history, beneficiary } = tacticalSetup(candidate);
  return certifyGain(history, candidate.tactic, beneficiary, signal);
}

/**
 * Certificates for the candidates of one decision, computed in order on the main thread.
 * Every candidate at a decision shares its best and played searches, so the first request
 * shows which later material candidates will also need a certificate. Those are queued at
 * once and certified while the engine worker runs the earlier candidates' tactic searches.
 * Each queued candidate would request its certificate anyway; only the timing changes.
 */
export function createCertificatePrefetch(candidates: Candidate[], signal: AbortSignal): CertificateSource {
  const queued = new Map<Candidate, Promise<MaterialCertificate>>();
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = (candidate: Candidate): Promise<MaterialCertificate> => {
    const next = chain.then(() => certify(candidate, signal));
    chain = next.catch(() => undefined);
    queued.set(candidate, next);
    return next;
  };
  return {
    certificate(candidate, best, played) {
      const start = Math.max(0, candidates.indexOf(candidate));
      for (const later of candidates.slice(start)) {
        if (queued.has(later) || later.theme === "mate-one") continue;
        if (later !== candidate && !consequencePossible(later, best, played)) continue;
        // Abandoned speculation must not surface as an unhandled rejection.
        enqueue(later).catch(() => undefined);
      }
      return queued.get(candidate) ?? enqueue(candidate);
    },
  };
}

const directCertificates = (signal: AbortSignal): CertificateSource => ({
  certificate: (candidate) => certify(candidate, signal),
});

export async function verifyCandidate(
  candidate: Candidate,
  engine: AnalysisEngine,
  signal: AbortSignal,
  certificates: CertificateSource = directCertificates(signal),
): Promise<VerificationResult> {
  const passes: VerificationPass[] = [];
  const tacticalHistory = candidate.direction === "missed"
    ? candidate.history
    : append(candidate.history, candidate.played);
  // A material claim needs its concrete certificate whatever the engine says. The
  // certificate is cheaper than a tactic search, so it runs first and only once.
  let certificate: MaterialCertificate | null = null;
  const certifyBeforeTactic = async (best: SearchResult, played: SearchResult): Promise<Unverified | null> => {
    if (candidate.theme === "mate-one" || certificate) return null;
    certificate = await certificates.certificate(candidate, best, played);
    return certificateFailure(candidate, certificate);
  };

  try {
    for (const nodes of BUDGETS) {
      const result = await runPass(candidate, engine, nodes, signal, certifyBeforeTactic);
      if (result.kind !== "pass") return result;
      const { pass } = result;
      passes.push(pass);
      const supported = candidate.theme === "mate-one"
        ? mateSupported(candidate, pass)
        : materialSupported(candidate, pass) || (
          candidate.theme === "fork"
          && mateSupported(candidate, pass)
        );
      if (!supported) return { kind: "rejected", reason: UNSTABLE };
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

  const claim = certificate as MaterialCertificate | null;
  if (!claim || (claim.kind !== "gain" && claim.kind !== "mate")) {
    throw new Error("A material candidate reached verification without its certificate");
  }
  const certified = claim;
  if (passes.some((pass) => !engineLineSupports(candidate, pass.tactic.pv, certified))) {
    return { kind: "inconclusive", reason: "The engine principal variation does not reach the certified consequence" };
  }
  if (!await alternativeAvoidsConsequence(candidate, passes.map(({ best }) => best.pv), certified, signal)) {
    return { kind: "rejected", reason: "The same forced consequence survives the best alternative" };
  }
  return { kind: "verified", finding: finding(candidate, passes, certified) };
}
