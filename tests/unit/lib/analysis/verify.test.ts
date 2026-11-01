import { describe, expect, test } from "vitest";
import { EngineError, type AnalysisEngine, type SearchRequest, type SearchResult } from "@/lib/analysis/engine/types";
import type { Candidate } from "@/lib/analysis/tactics/types";
import { certifyGain } from "@/lib/analysis/tactics/material";
import { createCertificatePrefetch, engineLineSupports, passesMaterialGate, verifyCandidate } from "@/lib/analysis/tactics/verify";

const result = (
  value: number,
  bound: SearchResult["bound"] = "exact",
  pv: string[] = ["a1a8"],
  kind: SearchResult["score"]["kind"] = "cp",
): SearchResult => ({ score: { kind, value, perspective: "white" }, bound, pv, nodes: 200_000, depth: 12 });

class QueueEngine implements AnalysisEngine {
  readonly buildId = "test";
  readonly requests: SearchRequest[] = [];
  constructor(private readonly answers: Array<SearchResult | Error>) {}
  async init(): Promise<void> {}
  async analyze(request: SearchRequest): Promise<SearchResult> {
    this.requests.push(request);
    const answer = this.answers.shift();
    if (!answer) throw new Error("Missing queued engine answer");
    if (answer instanceof Error) throw answer;
    return { ...answer, nodes: request.nodes };
  }
  async cancel(): Promise<void> {}
  dispose(): void {}
}

const missedQueen: Candidate = {
  theme: "hanging",
  direction: "missed",
  history: { initialFen: "q5k1/8/8/8/8/8/8/R5K1 w - - 0 1", moves: [] },
  side: "white",
  played: "g1h2",
  tactic: "a1a8",
  targets: ["a8"],
  tacticalPly: 0,
};

describe("passesMaterialGate", () => {
  test("does not turn a bound or a small score difference into material evidence", () => {
    expect(passesMaterialGate({ best: result(200), played: result(120), tactic: result(200) })).toBe(false);
    expect(passesMaterialGate({ best: result(300, "lower"), played: result(0), tactic: result(300) })).toBe(false);
    expect(passesMaterialGate({ best: result(300), played: result(0), tactic: result(300) })).toBe(true);
  });
});

describe("verifyCandidate", () => {
  test("uses two budgets and validates the candidate root separately", async () => {
    const engine = new QueueEngine([
      result(500, "exact", ["a1a8"]), result(0, "exact", ["g1h2"]), result(500, "exact", ["a1a8"]),
      result(520, "exact", ["a1a8"]), result(10, "exact", ["g1h2"]), result(510, "exact", ["a1a8"]),
    ]);
    const verified = await verifyCandidate(missedQueen, engine, new AbortController().signal);

    expect(verified).toMatchObject({
      kind: "verified",
      finding: {
        recommended: "a1a8",
        consequence: { kind: "material", gain: 9 },
        verification: {
          first: { best: { nodes: 200_000 } },
          second: { best: { nodes: 400_000 } },
        },
      },
    });
    expect(engine.requests.map(({ nodes, rootMoves }) => ({ nodes, rootMoves }))).toEqual([
      { nodes: 200_000, rootMoves: undefined },
      { nodes: 200_000, rootMoves: ["g1h2"] },
      { nodes: 200_000, rootMoves: ["a1a8"] },
      { nodes: 400_000, rootMoves: undefined },
      { nodes: 400_000, rootMoves: ["g1h2"] },
      { nodes: 400_000, rootMoves: ["a1a8"] },
    ]);
  });

  test("rejects a tactic whose selected move does not beat the played move", async () => {
    const answers = [200_000, 400_000].flatMap(() => [
      result(500, "exact", ["a1a8"]), result(0, "exact", ["g1h2"]), result(50, "exact", ["a1a8"]),
    ]);
    await expect(verifyCandidate(missedQueen, new QueueEngine(answers), new AbortController().signal))
      .resolves.toMatchObject({ kind: "rejected" });
  });

  test("skips the tactic search when best and played scores leave no consequence", async () => {
    const engine = new QueueEngine([result(120, "exact", ["a1a8"]), result(80, "exact", ["g1h2"])]);
    await expect(verifyCandidate(missedQueen, engine, new AbortController().signal))
      .resolves.toMatchObject({ kind: "rejected" });
    expect(engine.requests.map(({ rootMoves }) => rootMoves)).toEqual([undefined, ["g1h2"]]);
  });

  test("checks the material certificate before spending a tactic search", async () => {
    const candidate: Candidate = {
      ...missedQueen,
      history: { initialFen: "r5k1/1b6/8/8/8/8/8/Q5K1 w - - 0 1", moves: [] },
    };
    const engine = new QueueEngine([result(500, "exact", ["a1a8", "b7a8"]), result(0, "exact", ["g1h2"])]);
    await expect(verifyCandidate(candidate, engine, new AbortController().signal))
      .resolves.toMatchObject({ kind: "rejected", reason: "Defense b7a8 refutes the claimed gain" });
    expect(engine.requests).toHaveLength(2);
  });

  test("returns inconclusive for a bound or illegal principal variation", async () => {
    const bound = new QueueEngine([result(500, "lower"), result(0, "exact", ["g1h2"]), result(500)]);
    await expect(verifyCandidate(missedQueen, bound, new AbortController().signal))
      .resolves.toMatchObject({ kind: "inconclusive" });

    const illegal = new QueueEngine([result(500, "exact", ["a1a8"]), result(0, "exact", ["g1h3"]), result(500)]);
    await expect(verifyCandidate(missedQueen, illegal, new AbortController().signal))
      .resolves.toMatchObject({ kind: "inconclusive" });
  });

  test("rethrows engine lifecycle errors so a game is not marked clean", async () => {
    const engine = new QueueEngine([new EngineError("timeout", "watchdog")]);
    await expect(verifyCandidate(missedQueen, engine, new AbortController().signal))
      .rejects.toMatchObject({ code: "timeout" });
  });

  test("rejects the defended-rook false positive even with favorable scores", async () => {
    const candidate: Candidate = {
      ...missedQueen,
      history: { initialFen: "r5k1/1b6/8/8/8/8/8/Q5K1 w - - 0 1", moves: [] },
      tactic: "a1a8",
      targets: ["a8"],
    };
    const answers = [200_000, 400_000].flatMap(() => [
      result(500, "exact", ["a1a8", "b7a8"]), result(0, "exact", ["g1h2"]), result(500, "exact", ["a1a8", "b7a8"]),
    ]);
    await expect(verifyCandidate(candidate, new QueueEngine(answers), new AbortController().signal))
      .resolves.toMatchObject({ kind: "rejected" });
  });

  test("uses mate semantics instead of centipawn arithmetic", async () => {
    const mate: Candidate = {
      theme: "mate-one", direction: "missed",
      history: { initialFen: "7k/8/5KQ1/8/8/8/8/8 w - - 0 1", moves: [] },
      side: "white", played: "g6h7", tactic: "g6g7", targets: [], tacticalPly: 0,
    };
    const answers = [200_000, 400_000].flatMap(() => [
      result(1, "exact", ["g6g7"], "mate"), result(-900, "exact", ["g6h7"]), result(1, "exact", ["g6g7"], "mate"),
    ]);
    await expect(verifyCandidate(mate, new QueueEngine(answers), new AbortController().signal))
      .resolves.toMatchObject({ kind: "verified", finding: { consequence: { kind: "mate" } } });
  });

  test("verifies an allowed immediate mate only when a legal alternative avoids it", async () => {
    const candidate: Candidate = {
      theme: "mate-one", direction: "allowed",
      history: { initialFen: "rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2", moves: [] },
      side: "white", played: "g2g4", tactic: "d8h4", targets: [], tacticalPly: 1,
    };
    const answers = [200_000, 400_000].flatMap(() => [
      result(100, "exact", ["e2e4"]),
      result(-1, "exact", ["g2g4", "d8h4"], "mate"),
      result(-1, "exact", ["d8h4"], "mate"),
    ]);
    await expect(verifyCandidate(candidate, new QueueEngine(answers), new AbortController().signal))
      .resolves.toMatchObject({ kind: "verified", finding: { tacticalPly: 1, recommended: "e2e4" } });
  });

  test("rejects a missed immediate mate when the played move retains forced mate", async () => {
    const candidate: Candidate = {
      theme: "mate-one", direction: "missed",
      history: { initialFen: "7k/8/5KQ1/8/8/8/8/8 w - - 0 1", moves: [] },
      side: "white", played: "g6h6", tactic: "g6g7", targets: [], tacticalPly: 0,
    };
    const engine = new QueueEngine([
      result(1, "exact", ["g6g7"], "mate"),
      result(2, "exact", ["g6h6", "h8g8", "h6g7"], "mate"),
      result(1, "exact", ["g6g7"], "mate"),
    ]);
    await expect(verifyCandidate(candidate, engine, new AbortController().signal))
      .resolves.toMatchObject({ kind: "rejected" });
  });

  test("rejects a fork certificate that wins an unrelated piece", async () => {
    const candidate: Candidate = { ...missedQueen, theme: "fork", targets: ["b6", "e7"] };
    const answers = [200_000, 400_000].flatMap(() => [
      result(500, "exact", ["a1a8"]), result(0, "exact", ["g1h2"]), result(500, "exact", ["a1a8"]),
    ]);
    await expect(verifyCandidate(candidate, new QueueEngine(answers), new AbortController().signal))
      .resolves.toMatchObject({ kind: "rejected", reason: expect.stringMatching(/named target/) });
  });

  test("excludes a fork when the engine line never reaches either named target", async () => {
    const candidate: Candidate = {
      theme: "fork", direction: "missed",
      history: { initialFen: "8/4k3/1q6/8/8/2N5/8/4K3 w - - 0 1", moves: [] },
      side: "white", played: "c3b1", tactic: "c3d5", targets: ["b6", "e7"], tacticalPly: 0,
    };
    const answers = [200_000, 400_000].flatMap(() => [
      result(300, "exact", ["c3d5"]), result(0, "exact", ["c3b1"]), result(300, "exact", ["c3d5"]),
    ]);
    await expect(verifyCandidate(candidate, new QueueEngine(answers), new AbortController().signal))
      .resolves.toMatchObject({ kind: "inconclusive", reason: expect.stringMatching(/principal variation/) });
  });

  test("does not accept an engine line whose next reply erases a temporary gain", async () => {
    const candidate: Candidate = {
      ...missedQueen,
      history: { initialFen: "q7/6b1/6k1/8/8/8/1Q6/R5K1 w - - 0 1", moves: [] },
      tactic: "a1a8",
      targets: ["a8"],
    };
    expect(engineLineSupports(
      candidate,
      ["a1a8", "g7b2"],
      { kind: "gain", gain: 9, line: ["a1a8"] },
    )).toBe(false);
  });

  test("rejects an allowed loss when the best root permits a different quiet fork", async () => {
    const candidate: Candidate = {
      theme: "hanging", direction: "allowed",
      history: { initialFen: "7k/8/8/1n1p4/8/n1R1K3/2B5/8 w - - 0 1", moves: [] },
      side: "white", played: "c2b1", tactic: "a3b1", targets: ["b1"], tacticalPly: 1,
    };
    const answers = [200_000, 400_000].flatMap(() => [
      result(300, "exact", ["c2a4", "d5d4", "e3f2", "d4c3"]),
      result(0, "exact", ["c2b1", "a3b1"]),
      result(0, "exact", ["a3b1"]),
    ]);
    await expect(verifyCandidate(candidate, new QueueEngine(answers), new AbortController().signal))
      .resolves.toMatchObject({ kind: "rejected", reason: expect.stringMatching(/alternative/) });
  });

  test("rejects an allowed loss when the best root still loses equal material", async () => {
    const candidate: Candidate = {
      theme: "hanging", direction: "allowed",
      history: { initialFen: "r5r1/1k6/8/8/8/8/8/Q5K1 w - - 0 1", moves: [] },
      side: "white", played: "g1h2", tactic: "a8a1", targets: ["a1"], tacticalPly: 1,
    };
    const answers = [200_000, 400_000].flatMap(() => [
      result(300, "exact", ["a1g7"]), result(0, "exact", ["g1h2"]), result(0, "exact", ["a8a1"]),
    ]);
    await expect(verifyCandidate(candidate, new QueueEngine(answers), new AbortController().signal))
      .resolves.toMatchObject({ kind: "rejected", reason: expect.stringMatching(/alternative/) });
  });
});

describe("createCertificatePrefetch", () => {
  const position = { initialFen: "r5k1/1b6/8/8/8/3n4/8/Q5K1 w - - 0 1", moves: [] };
  const takeRook: Candidate = { ...missedQueen, history: position, tactic: "a1a8", targets: ["a8"] };
  const takeKnight: Candidate = { ...missedQueen, history: position, tactic: "a1d4", targets: ["d4"] };
  const mate: Candidate = { ...missedQueen, history: position, theme: "mate-one", tactic: "a1a8", targets: [] };

  test("queues later material candidates and returns the certificates a direct check would", async () => {
    const signal = new AbortController().signal;
    const prefetch = createCertificatePrefetch([takeRook, mate, takeKnight], signal);
    const first = prefetch.certificate(takeRook, result(500), result(0, "exact", ["g1h2"]));
    const queued = prefetch.certificate(takeKnight, result(500), result(0, "exact", ["g1h2"]));
    expect(prefetch.certificate(takeKnight, result(500), result(0, "exact", ["g1h2"]))).toBe(queued);
    expect(await first).toEqual(await certifyGain(position, "a1a8", "white", signal));
    expect(await queued).toEqual(await certifyGain(position, "a1d4", "white", signal));
  });

  test("rejects a requested certificate after abort without leaking queued rejections", async () => {
    const controller = new AbortController();
    const prefetch = createCertificatePrefetch([takeRook, takeKnight], controller.signal);
    controller.abort();
    await expect(prefetch.certificate(takeRook, result(500), result(0, "exact", ["g1h2"])))
      .rejects.toMatchObject({ name: "AbortError" });
  });
});
