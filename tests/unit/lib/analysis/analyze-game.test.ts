import { readFileSync } from "node:fs";
import { Chess } from "chess.js";
import { expect, test } from "vitest";
import type { ImportedGame } from "@/lib/assessment/types";
import type { AnalysisEngine, SearchRequest, SearchResult } from "@/lib/analysis/engine/types";
import { analyzeGame } from "@/lib/analysis/tactics/analyze-game";
import { findCandidates, toUci } from "@/lib/analysis/tactics/candidates";

const cp = (request: SearchRequest): SearchResult => ({
  score: { kind: "cp", value: request.rootMoves?.[0] === "a1a8" ? 500 : request.rootMoves?.[0] === "g1h2" ? 0 : 500, perspective: request.perspective },
  bound: "exact",
  pv: request.rootMoves ?? ["a1a8"],
  nodes: request.nodes,
  depth: 12,
});

class FakeEngine implements AnalysisEngine {
  readonly buildId = "test";
  constructor(private readonly onAnalyze: (request: SearchRequest, signal: AbortSignal) => SearchResult | Promise<SearchResult> = cp) {}
  async init(): Promise<void> {}
  async analyze(request: SearchRequest, signal: AbortSignal): Promise<SearchResult> { return this.onAnalyze(request, signal); }
  async cancel(): Promise<void> {}
  dispose(): void {}
}

function game(overrides: Partial<ImportedGame> = {}): ImportedGame {
  return {
    playerKey: "learner", id: "game-1", url: "https://www.chess.com/game/live/1", fingerprint: "fp-1", pgn: "",
    history: { initialFen: "q5k1/8/8/8/8/8/8/R5K1 w - - 0 1", moves: ["g1h2"] }, sans: ["Kh2"],
    endTime: 1_700_000_000, side: "white", white: "learner", black: "opponent", whiteResult: "resigned", blackResult: "win",
    timeControl: "600", clocks: { 0: 29.5 }, ...overrides,
  };
}

test("analyzes only player decisions and labels low time from the decision clock", async () => {
  const analysis = await analyzeGame(game(), new FakeEngine(), "sig-1", new AbortController().signal);
  expect(analysis).toMatchObject({
    playerKey: "learner", gameId: "game-1", fingerprint: "fp-1", signature: "sig-1", openings: [],
    findings: [{ id: "game-1:fp-1:0", ply: 0, lowTime: true, executed: false }],
  });
});

test("deduplicates one decision by mate then fork then hanging precedence", async () => {
  const matingGame = game({
    history: { initialFen: "7k/4b1r1/6Q1/8/8/8/8/K5R1 w - - 0 1", moves: ["g6h6"] },
    sans: ["Qh6+"], clocks: {},
  });
  expect(findCandidates({ ...matingGame.history, moves: [] }, "g6h6", "white").map(({ theme }) => theme))
    .toEqual(expect.arrayContaining(["fork", "mate-one"]));
  const mateResult = (request: SearchRequest): SearchResult => {
    const root = request.rootMoves?.[0];
    const winsByMate = root === undefined || root === "g6g7";
    return {
      score: { kind: winsByMate ? "mate" : "cp", value: winsByMate ? 1 : -900, perspective: request.perspective },
      bound: "exact", pv: request.rootMoves ?? ["g6g7"], nodes: request.nodes, depth: 12,
    };
  };
  const analysis = await analyzeGame(matingGame, new FakeEngine(mateResult), "sig", new AbortController().signal);
  expect(analysis.findings).toHaveLength(1);
  expect(analysis.findings[0].theme).toBe("mate-one");
});

test("does not return a completed analysis when cancellation reaches the final decision", async () => {
  const controller = new AbortController();
  let searches = 0;
  const engine = new FakeEngine((request) => {
    searches += 1;
    if (searches === 6) controller.abort();
    return cp(request);
  });
  await expect(analyzeGame(game(), engine, "sig", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
});

test("marks an allowed threat executed only when the recorded reply is the tactic", async () => {
  const allowed = game({
    history: { initialFen: "r5k1/8/8/8/8/8/8/1Q4K1 w - - 0 1", moves: ["b1a1", "a8a1"] },
    sans: ["Qa1", "Rxa1"], clocks: { 0: 30 },
  });
  const engine = new FakeEngine((request) => ({
    score: {
      kind: "cp",
      value: request.rootMoves?.[0] === "b1a1" || request.rootMoves?.[0] === "a8a1"
        || request.rootMoves?.[0] === "b1a2" || request.rootMoves?.[0] === "b1b8" ? -900 : 100,
      perspective: request.perspective,
    },
    bound: "exact", pv: request.rootMoves ?? ["b1b2"], nodes: request.nodes, depth: 12,
  }));
  const analysis = await analyzeGame(allowed, engine, "sig", new AbortController().signal);
  expect(analysis.findings).toEqual(expect.arrayContaining([
    expect.objectContaining({ direction: "allowed", executed: true, lowTime: false }),
  ]));
});

test("keeps every rejection while reusing repeated game-position searches", async () => {
  const pgn = readFileSync("tests/fixtures/assessment-performance.pgn", "utf8").split(/(?=\[Event )/)[0].trim();
  const board = new Chess();
  board.loadPgn(pgn);
  const moves = board.history({ verbose: true }).map(toUci);
  let searches = 0;
  const engine = new FakeEngine((request) => {
    searches++;
    const position = new Chess(request.history.initialFen);
    for (const move of request.history.moves) position.move(move);
    const best = request.rootMoves?.[0] ?? toUci(position.moves({ verbose: true })[0]);
    return { score: { kind: "cp", value: 0, perspective: request.perspective }, bound: "exact", pv: [best], nodes: request.nodes, depth: 12 };
  });
  const result = await analyzeGame(game({ history: { initialFen: new Chess().fen(), moves }, sans: board.history(), clocks: {} }), engine, "sig", new AbortController().signal);
  expect(result.findings).toEqual([]);
  expect(result.exclusions).toEqual({ "The consequence was not stable at both engine budgets": 36 });
  expect(searches).toBeLessThan(108);
});
