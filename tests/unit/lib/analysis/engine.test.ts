import { START_FEN } from "@/lib/chess/position";
import { createBrowserEngine, EngineError } from "@/lib/analysis/engine/browser-engine";
import { engineCacheKey, parseInfo, positionCommand } from "@/lib/analysis/engine/uci";
import { afterEach, describe, expect, test, vi } from "vitest";

type WorkerListener = (event: MessageEvent<string> | ErrorEvent) => void;

function workerDouble() {
  const listeners = new Map<string, Set<WorkerListener>>();
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    addEventListener: vi.fn((type: string, listener: WorkerListener) => {
      const current = listeners.get(type) ?? new Set<WorkerListener>();
      current.add(listener);
      listeners.set(type, current);
    }),
    removeEventListener: vi.fn((type: string, listener: WorkerListener) => {
      listeners.get(type)?.delete(listener);
    }),
  } as unknown as Worker;

  return {
    worker,
    postMessage: worker.postMessage as unknown as ReturnType<typeof vi.fn>,
    terminate: worker.terminate as unknown as ReturnType<typeof vi.fn>,
    emit(line: string) {
      for (const listener of listeners.get("message") ?? []) {
        listener(new MessageEvent("message", { data: line }));
      }
    },
    crash(message = "worker crashed") {
      for (const listener of listeners.get("error") ?? []) {
        listener(new ErrorEvent("error", { message }));
      }
    },
    messageListeners() {
      return [...(listeners.get("message") ?? [])];
    },
  };
}

async function initializedEngine() {
  const fake = workerDouble();
  const engine = createBrowserEngine(() => fake.worker);
  const init = engine.init(new AbortController().signal);
  expect(fake.postMessage).toHaveBeenCalledWith("uci");
  fake.emit("uciok");
  await Promise.resolve();
  expect(fake.postMessage).toHaveBeenCalledWith("setoption name Hash value 16");
  expect(fake.postMessage).toHaveBeenCalledWith("setoption name MultiPV value 1");
  expect(fake.postMessage).toHaveBeenCalledWith("isready");
  fake.emit("readyok");
  await init;
  return { engine, fake };
}

async function startSearch(engine: ReturnType<typeof createBrowserEngine>, fake: ReturnType<typeof workerDouble>) {
  const analysis = engine.analyze({
    history: { initialFen: START_FEN, moves: ["e2e4", "e7e5"] },
    perspective: "white",
    nodes: 200_000,
  }, new AbortController().signal);
  expect(fake.postMessage).toHaveBeenCalledWith("ucinewgame");
  expect(fake.postMessage).toHaveBeenCalledWith("setoption name Clear Hash");
  fake.emit("readyok");
  await Promise.resolve();
  expect(fake.postMessage).toHaveBeenCalledWith(`position fen ${START_FEN} moves e2e4 e7e5`);
  expect(fake.postMessage).toHaveBeenCalledWith("go nodes 200000");
  return { analysis };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("UCI parsing", () => {
  test("normalizes black-root scores and retains bounds", () => {
    const line = "info depth 12 nodes 200000 score cp 220 lowerbound pv a8a1 g1h2";
    expect(parseInfo(line, "black", "white")).toMatchObject({
      score: { kind: "cp", value: -220, perspective: "white" },
      bound: "upper",
      pv: ["a8a1", "g1h2"],
      nodes: 200000,
      depth: 12,
    });
    expect(parseInfo("info string downloading", "white", "white")).toBeNull();
  });

  test("normalizes mate scores without changing an exact bound", () => {
    expect(parseInfo("info depth 4 nodes 81 score mate -2 pv h8g8 g6g7", "black", "white")).toEqual({
      score: { kind: "mate", value: 2, perspective: "white" },
      bound: "exact",
      pv: ["h8g8", "g6g7"],
      nodes: 81,
      depth: 4,
    });
  });

  test("rejects malformed numeric and move tokens", () => {
    expect(parseInfo("info depth twelve nodes 2 score cp 3 pv e2e4", "white", "white")).toBeNull();
    expect(parseInfo("info depth 1 nodes 2 score cp nope pv e2e4", "white", "white")).toBeNull();
    expect(parseInfo("info depth 1 nodes 2 score cp 3 pv e9e4", "white", "white")).toBeNull();
  });

  test("parses each info record independently in multi-line output", () => {
    const lines = [
      "info string NNUE evaluation using nn-1c0000000000.nnue",
      "info depth 1 nodes 7 score cp 13 pv e2e4",
      "info depth 2 nodes 19 score cp 21 pv d2d4 d7d5",
    ];
    expect(lines.map((line) => parseInfo(line, "white", "white")).filter(Boolean)).toEqual([
      { score: { kind: "cp", value: 13, perspective: "white" }, bound: "exact", pv: ["e2e4"], nodes: 7, depth: 1 },
      { score: { kind: "cp", value: 21, perspective: "white" }, bound: "exact", pv: ["d2d4", "d7d5"], nodes: 19, depth: 2 },
    ]);
  });

  test("represents a syntactically valid info record with a missing PV", () => {
    expect(parseInfo("info depth 0 nodes 0 score cp 0", "white", "white")).toEqual({
      score: { kind: "cp", value: 0, perspective: "white" },
      bound: "exact",
      pv: [],
      nodes: 0,
      depth: 0,
    });
  });
});

describe("UCI commands", () => {
  test("includes the complete move history in position commands and cache keys", () => {
    const base = { initialFen: START_FEN, moves: [] };
    const repeated = { ...base, moves: ["g1f3", "g8f6", "f3g1", "f6g8"] };
    const request = { history: base, perspective: "white" as const, nodes: 200000 };
    expect(positionCommand(repeated)).toBe(`position fen ${START_FEN} moves g1f3 g8f6 f3g1 f6g8`);
    expect(engineCacheKey("fixture", request)).not.toBe(
      engineCacheKey("fixture", { ...request, history: repeated }),
    );
  });

  test("canonicalizes constrained root moves in cache keys", () => {
    const request = {
      history: { initialFen: START_FEN, moves: [] },
      perspective: "white" as const,
      nodes: 400000,
      rootMoves: ["g1f3", "e2e4"],
    };
    expect(engineCacheKey("fixture", request)).toBe(
      engineCacheKey("fixture", { ...request, rootMoves: ["e2e4", "g1f3"] }),
    );
  });

  test("rejects FEN and UCI tokens that could inject commands", () => {
    expect(() => positionCommand({ initialFen: `${START_FEN}\nquit`, moves: [] })).toThrow(EngineError);
    expect(() => positionCommand({ initialFen: START_FEN, moves: ["e2e4\ngo infinite"] })).toThrow(EngineError);
  });
});

describe("browser engine lifecycle", () => {
  test("handshakes and resolves only after exact scored bestmove output", async () => {
    const { engine, fake } = await initializedEngine();
    const { analysis } = await startSearch(engine, fake);
    fake.emit("info depth 10 nodes 200000 score cp 31 pv g1f3 b8c6");
    fake.emit("bestmove g1f3 ponder b8c6");
    await expect(analysis).resolves.toEqual({
      score: { kind: "cp", value: 31, perspective: "white" },
      bound: "exact",
      pv: ["g1f3", "b8c6"],
      nodes: 200000,
      depth: 10,
    });
    engine.dispose();
  });

  test("keeps a usable exact result when the final node-limit update is a bound", async () => {
    const { engine, fake } = await initializedEngine();
    const { analysis } = await startSearch(engine, fake);

    fake.emit("info depth 16 nodes 176511 score cp -68 pv g1f3 b8c6");
    fake.emit(
      "info depth 17 nodes 200251 score cp -65 lowerbound pv g1f3 b8c6",
    );
    fake.emit("bestmove g1f3 ponder b8c6");

    await expect(analysis).resolves.toEqual({
      score: { kind: "cp", value: -68, perspective: "white" },
      bound: "exact",
      pv: ["g1f3", "b8c6"],
      nodes: 176511,
      depth: 16,
    });

    engine.dispose();
  });

  test("adds validated constrained root moves to the go command", async () => {
    const { engine, fake } = await initializedEngine();
    const analysis = engine.analyze({
      history: { initialFen: START_FEN, moves: [] },
      perspective: "white",
      nodes: 400000,
      rootMoves: ["e2e4", "d2d4"],
    }, new AbortController().signal);
    fake.emit("readyok");
    await Promise.resolve();
    expect(fake.postMessage).toHaveBeenCalledWith("go nodes 400000 searchmoves e2e4 d2d4");
    fake.emit("info depth 1 nodes 9 score cp 1 pv e2e4");
    fake.emit("bestmove e2e4");
    await analysis;
    engine.dispose();
  });

  test.each([
    ["bestmove without info", []],
    ["bound-only result", ["info depth 4 nodes 20 score cp 9 lowerbound pv g1f3"]],
    ["missing PV", ["info depth 0 nodes 0 score cp 0"]],
  ])("rejects a %s as inconclusive", async (_name, infoLines) => {
    const { engine, fake } = await initializedEngine();
    const { analysis } = await startSearch(engine, fake);
    for (const line of infoLines) fake.emit(line);
    fake.emit("bestmove g1f3");
    await expect(analysis).rejects.toMatchObject({ code: "protocol" });
    engine.dispose();
  });

  test("rejects a bestmove that does not correspond to the scored PV", async () => {
    const { engine, fake } = await initializedEngine();
    const { analysis } = await startSearch(engine, fake);
    fake.emit("info depth 4 nodes 20 score cp 9 pv e2e4 e7e5");
    fake.emit("bestmove g1f3");
    await expect(analysis).rejects.toMatchObject({ code: "protocol" });
    engine.dispose();
  });

  test("rejects a terminal position response instead of waiting for the watchdog", async () => {
    const { engine, fake } = await initializedEngine();
    const analysis = engine.analyze({
      history: { initialFen: "7k/8/5KQ1/8/8/8/8/8 b - - 1 1", moves: [] },
      perspective: "white",
      nodes: 200000,
    }, new AbortController().signal);
    fake.emit("readyok");
    await Promise.resolve();
    fake.emit("info depth 0 nodes 0 score mate 0");
    fake.emit("bestmove (none)");
    await expect(analysis).rejects.toMatchObject({ code: "protocol" });
    engine.dispose();
  });

  test("permits only one active search", async () => {
    const { engine, fake } = await initializedEngine();
    const { analysis: first } = await startSearch(engine, fake);
    const second = engine.analyze({
      history: { initialFen: START_FEN, moves: [] }, perspective: "white", nodes: 200000,
    }, new AbortController().signal);
    await expect(second).rejects.toMatchObject({ code: "protocol" });
    fake.emit("info depth 1 nodes 1 score cp 0 pv g1f3");
    fake.emit("bestmove g1f3");
    await first;
    engine.dispose();
  });

  test("reports worker crashes during initialization", async () => {
    const fake = workerDouble();
    const engine = createBrowserEngine(() => fake.worker);
    const init = engine.init(new AbortController().signal);
    fake.crash("boom");
    await expect(init).rejects.toMatchObject({ code: "crashed" });
    expect(fake.terminate).toHaveBeenCalledOnce();
  });

  test("aborts initialization and can initialize a fresh worker later", async () => {
    const first = workerDouble();
    const second = workerDouble();
    const factory = vi.fn().mockReturnValueOnce(first.worker).mockReturnValueOnce(second.worker);
    const engine = createBrowserEngine(factory);
    const controller = new AbortController();
    const init = engine.init(controller.signal);
    const rejection = expect(init).rejects.toMatchObject({ code: "aborted" });
    controller.abort();
    await rejection;
    expect(first.terminate).toHaveBeenCalledOnce();

    const reinit = engine.init(new AbortController().signal);
    first.emit("uciok");
    first.emit("readyok");
    second.emit("uciok");
    await Promise.resolve();
    second.emit("readyok");
    await reinit;
    expect(factory).toHaveBeenCalledTimes(2);
    engine.dispose();
  });

  test("aborts an active search and ignores stale generation output", async () => {
    vi.useFakeTimers();
    const first = workerDouble();
    const second = workerDouble();
    const factory = vi.fn().mockReturnValueOnce(first.worker).mockReturnValueOnce(second.worker);
    const engine = createBrowserEngine(factory);
    const init = engine.init(new AbortController().signal);
    first.emit("uciok");
    await Promise.resolve();
    first.emit("readyok");
    await init;
    const staleListeners = first.messageListeners();

    const controller = new AbortController();
    const analysis = engine.analyze({
      history: { initialFen: START_FEN, moves: [] }, perspective: "white", nodes: 200000,
    }, controller.signal);
    first.emit("readyok");
    await Promise.resolve();
    const rejection = expect(analysis).rejects.toMatchObject({ code: "aborted" });
    controller.abort();
    await rejection;
    await vi.advanceTimersByTimeAsync(1000);

    const reinit = engine.init(new AbortController().signal);
    second.emit("uciok");
    await Promise.resolve();
    second.emit("readyok");
    await reinit;
    expect(first.terminate).toHaveBeenCalledOnce();

    const { analysis: secondAnalysis } = await startSearch(engine, second);
    for (const line of [
      "info depth 1 nodes 1 score cp 99 pv e2e4",
      "bestmove e2e4",
    ]) {
      for (const listener of staleListeners) {
        listener(new MessageEvent("message", { data: line }));
      }
    }
    second.emit("info depth 8 nodes 200000 score cp 12 pv g1f3 b8c6");
    second.emit("bestmove g1f3");
    await expect(secondAnalysis).resolves.toMatchObject({
      score: { kind: "cp", value: 12, perspective: "white" },
      pv: ["g1f3", "b8c6"],
    });
    engine.dispose();
  });

  test("does not accept another search while an aborted worker is draining", async () => {
    vi.useFakeTimers();
    const { engine, fake } = await initializedEngine();
    const controller = new AbortController();
    const analysis = engine.analyze({
      history: { initialFen: START_FEN, moves: [] }, perspective: "white", nodes: 200000,
    }, controller.signal);
    fake.emit("readyok");
    await Promise.resolve();
    const rejection = expect(analysis).rejects.toMatchObject({ code: "aborted" });
    controller.abort();
    await rejection;

    await expect(engine.analyze({
      history: { initialFen: START_FEN, moves: [] }, perspective: "white", nodes: 200000,
    }, new AbortController().signal)).rejects.toMatchObject({ code: "init" });

    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.terminate).toHaveBeenCalledOnce();
  });

  test("times out searches with a typed error", async () => {
    vi.useFakeTimers();
    const { engine, fake } = await initializedEngine();
    const { analysis } = await startSearch(engine, fake);
    const rejection = expect(analysis).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(15000);
    await rejection;
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.terminate).toHaveBeenCalledOnce();
  });

  test("terminates an engine that never acknowledges stop", async () => {
    vi.useFakeTimers();
    const { engine, fake } = await initializedEngine();
    const canceled = engine.cancel();
    expect(fake.postMessage).toHaveBeenCalledWith("stop");
    await vi.advanceTimersByTimeAsync(1000);
    await canceled;
    expect(fake.terminate).toHaveBeenCalledOnce();
  });
});
