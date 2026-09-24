import { Chess } from "chess.js";
import { isUciMove } from "./uci";
import type { AnalysisEngine, SearchRequest, SearchResult } from "./types";

function usableEvidence(request: SearchRequest, result: SearchResult): boolean {
  if (result.bound !== "exact" || result.score.perspective !== request.perspective || result.pv.length === 0) return false;
  if (request.rootMoves && !request.rootMoves.includes(result.pv[0])) return false;

  try {
    const board = new Chess(request.history.initialFen);
    for (const move of [...request.history.moves, ...result.pv]) {
      if (!isUciMove(move)) return false;
      board.move({ from: move.slice(0, 2), to: move.slice(2, 4), ...(move[4] ? { promotion: move[4] } : {}) });
    }
    return true;
  } catch {
    return false;
  }
}

/** Reuses completed searches only for the lifetime of one game analysis. */
export function createGameSearchEngine(engine: AnalysisEngine): AnalysisEngine {
  const results = new Map<string, SearchResult>();
  const assertActive = (signal: AbortSignal): void => {
    if (signal.aborted) throw new DOMException("Analysis was aborted", "AbortError");
  };

  return {
    buildId: engine.buildId,
    async init(signal) {
      results.clear();
      await engine.init(signal);
    },
    async analyze(request, signal) {
      assertActive(signal);
      // Keep root move order: UCI searchmoves order can affect tied best moves.
      const key = JSON.stringify([
        engine.buildId, request.history.initialFen, request.history.moves,
        request.perspective, request.nodes, request.rootMoves ?? null,
      ]);
      const cached = results.get(key);
      if (cached) return cached;
      const result = await engine.analyze(request, signal);
      assertActive(signal);
      if (usableEvidence(request, result)) results.set(key, result);
      return result;
    },
    async cancel() {
      results.clear();
      await engine.cancel();
    },
    dispose() {
      results.clear();
      engine.dispose();
    },
  };
}
