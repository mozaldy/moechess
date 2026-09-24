import { Chess } from "chess.js";
import { expect, test } from "vitest";
import { createGameSearchEngine } from "@/lib/analysis/engine/search-cache";
import { EngineError, type AnalysisEngine, type SearchRequest, type SearchResult } from "@/lib/analysis/engine/types";

const request: SearchRequest = {
  history: { initialFen: "q5k1/8/8/8/8/8/8/R5K1 w - - 0 1", moves: [] },
  perspective: "white",
  nodes: 200_000,
};

const historyRequest: SearchRequest = {
  history: { initialFen: new Chess().fen(), moves: ["e2e4"] },
  perspective: "black",
  nodes: 200_000,
  rootMoves: ["e7e5"],
};

const usable: SearchResult = {
  score: { kind: "cp", value: 42, perspective: "black" },
  bound: "exact", pv: ["e7e5", "g1f3"], nodes: 200_000, depth: 12,
};

function fakeEngine(): AnalysisEngine & { calls: SearchRequest[] } {
  const calls: SearchRequest[] = [];
  return {
    buildId: "stockfish-test",
    calls,
    async init() {},
    async analyze(input) {
      calls.push(input);
      return { score: { kind: "cp", value: 42, perspective: input.perspective }, bound: "exact", pv: ["a1a8"], nodes: input.nodes, depth: 12 };
    },
    async cancel() {},
    dispose() {},
  };
}

test("reuses a successful identical search within one game while keeping budgets distinct", async () => {
  const source = fakeEngine();
  const engine = createGameSearchEngine(source);
  const signal = new AbortController().signal;
  const first = await engine.analyze(request, signal);
  expect(await engine.analyze({ ...request, history: { ...request.history, moves: [] } }, signal)).toEqual(first);
  await engine.analyze({ ...request, nodes: 400_000 }, signal);
  expect(source.calls).toHaveLength(2);
  expect(source.calls.map(({ nodes }) => nodes)).toEqual([200_000, 400_000]);
});

test("does not reuse a search when multiple root moves change order", async () => {
  const source = fakeEngine();
  const engine = createGameSearchEngine(source);
  const signal = new AbortController().signal;
  await engine.analyze({ ...request, rootMoves: ["a1a8", "a1a7"] }, signal);
  await engine.analyze({ ...request, rootMoves: ["a1a7", "a1a8"] }, signal);
  expect(source.calls).toHaveLength(2);
});

const unusableResults: Array<[string, SearchResult]> = [
  ["bounded score", { ...usable, bound: "lower" }],
  ["empty variation", { ...usable, pv: [] }],
  ["wrong score perspective", { ...usable, score: { ...usable.score, perspective: "white" } }],
  ["variation illegal after recorded history", { ...usable, pv: ["e2e4"] }],
  ["illegal later variation move", { ...usable, pv: ["e7e5", "e7e6"] }],
  ["variation outside constrained roots", { ...usable, pv: ["c7c5"] }],
];

test.each(unusableResults)("retries %s and then caches valid exact evidence", async (_name, unusable) => {
  const source = fakeEngine();
  let searches = 0;
  source.analyze = async () => {
    searches++;
    return searches === 1 ? unusable : usable;
  };
  const engine = createGameSearchEngine(source);
  const signal = new AbortController().signal;
  expect(await engine.analyze(historyRequest, signal)).toEqual(unusable);
  expect(await engine.analyze(historyRequest, signal)).toEqual(usable);
  expect(await engine.analyze(historyRequest, signal)).toEqual(usable);
  expect(searches).toBe(2);
});

test("rejects an aborted cache hit and does not share entries with the next game", async () => {
  const source = fakeEngine();
  const firstGame = createGameSearchEngine(source);
  await firstGame.analyze(request, new AbortController().signal);
  const controller = new AbortController();
  controller.abort();
  await expect(firstGame.analyze(request, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(source.calls).toHaveLength(1);
  await createGameSearchEngine(source).analyze(request, new AbortController().signal);
  expect(source.calls).toHaveLength(2);
});

test("does not cache failed searches and clears entries when the engine is canceled", async () => {
  const source = fakeEngine();
  let fail = true;
  const originalAnalyze = source.analyze;
  source.analyze = async (input, signal): Promise<SearchResult> => {
    if (fail) {
      fail = false;
      throw new EngineError("protocol", "missing exact result");
    }
    return originalAnalyze(input, signal);
  };
  const engine = createGameSearchEngine(source);
  const signal = new AbortController().signal;
  await expect(engine.analyze(request, signal)).rejects.toMatchObject({ code: "protocol" });
  await engine.analyze(request, signal);
  await engine.cancel();
  await engine.analyze(request, signal);
  expect(source.calls).toHaveLength(2);
});
