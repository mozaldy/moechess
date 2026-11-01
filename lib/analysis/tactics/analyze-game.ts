import type { Finding, GameAnalysis, ImportedGame, Theme } from "@/lib/assessment/types";
import type { AnalysisEngine } from "@/lib/analysis/engine/types";
import { createGameSearchEngine } from "@/lib/analysis/engine/search-cache";
import { yieldToEventLoop } from "@/lib/analysis/yield";
import { findCandidates, replayHistory } from "./candidates";
import { createCertificatePrefetch, verifyCandidate } from "./verify";

const precedence: Record<Theme, number> = { "mate-one": 0, fork: 1, hanging: 2 };

function abortError(): DOMException {
  return new DOMException("Analysis was aborted", "AbortError");
}

function assertActive(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function addExclusion(exclusions: Record<string, number>, reason: string): void {
  exclusions[reason] = (exclusions[reason] ?? 0) + 1;
}

function playerTurn(game: ImportedGame, ply: number): boolean {
  const history = { initialFen: game.history.initialFen, moves: game.history.moves.slice(0, ply) };
  const turn = replayHistory(history).turn() === "w" ? "white" : "black";
  return turn === game.side;
}

export async function analyzeGame(
  game: ImportedGame,
  engine: AnalysisEngine,
  signature: string,
  signal: AbortSignal,
): Promise<GameAnalysis> {
  assertActive(signal);
  const verified: Finding[] = [];
  const exclusions: Record<string, number> = {};
  const gameEngine = createGameSearchEngine(engine);

  for (let ply = 0; ply < game.history.moves.length; ply += 1) {
    if (!playerTurn(game, ply)) continue;
    assertActive(signal);
    const played = game.history.moves[ply];
    const history = { initialFen: game.history.initialFen, moves: game.history.moves.slice(0, ply) };
    const candidates = findCandidates(history, played, game.side);
    const certificates = createCertificatePrefetch(candidates, signal);

    for (const candidate of candidates) {
      const result = await verifyCandidate(candidate, gameEngine, signal, certificates);
      assertActive(signal);
      if (result.kind !== "verified") {
        addExclusion(exclusions, result.reason);
        continue;
      }
      const clock = game.clocks[ply];
      verified.push({
        ...result.finding,
        id: `${game.id}:${game.fingerprint}:${ply}`,
        gameId: game.id,
        playerKey: game.playerKey,
        ply,
        executed: candidate.direction === "allowed" && game.history.moves[ply + 1] === candidate.tactic,
        lowTime: Number.isFinite(clock) && clock >= 0 && clock < 30,
      });
    }

    await yieldToEventLoop();
    assertActive(signal);
  }

  const byPly = new Map<number, Finding>();
  for (const finding of verified) {
    const previous = byPly.get(finding.ply);
    if (!previous || precedence[finding.theme] < precedence[previous.theme]) byPly.set(finding.ply, finding);
  }
  assertActive(signal);
  return {
    playerKey: game.playerKey,
    gameId: game.id,
    fingerprint: game.fingerprint,
    signature,
    findings: [...byPly.values()].sort((left, right) => left.ply - right.ply),
    exclusions,
    openings: [],
    completedAt: new Date().toISOString(),
  };
}
