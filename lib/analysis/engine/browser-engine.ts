import manifest from "@/public/engines/stockfish/manifest.json";
import { isUciMove, parseInfo, positionCommand, validateHistory } from "./uci";
import {
  EngineError,
  type AnalysisEngine,
  type SearchRequest,
  type SearchResult,
  type Side,
} from "./types";

export { EngineError } from "./types";

const INIT_TIMEOUT_MS = 30_000;
const SEARCH_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 1_000;

type LineWaiter = {
  generation: number;
  accept: (line: string) => boolean;
  resolve: () => void;
  reject: (error: EngineError) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abort?: () => void;
};

type ActiveSearch = {
  generation: number;
  rootSide: Side;
  perspective: Side;
  latest: SearchResult | null;
  resolve: (result: SearchResult) => void;
  reject: (error: EngineError) => void;
  timer: ReturnType<typeof setTimeout>;
};

class BrowserEngine implements AnalysisEngine {
  readonly buildId = manifest.buildId;
  private worker: Worker | null = null;
  private workerMessageListener: ((event: MessageEvent<unknown>) => void) | null = null;
  private workerErrorListener: ((event: ErrorEvent) => void) | null = null;
  private generation = 0;
  private ready = false;
  private initializing: Promise<void> | null = null;
  private waiters = new Set<LineWaiter>();
  private activeSearch: ActiveSearch | null = null;
  private searchReserved = false;
  private stopping: { generation: number; promise: Promise<void> } | null = null;

  constructor(private readonly workerFactory: () => Worker) {}

  init(signal: AbortSignal): Promise<void> {
    if (this.ready && this.worker) return Promise.resolve();
    if (this.initializing) return this.initializing;
    if (signal.aborted) return Promise.reject(new EngineError("aborted", "Engine initialization was aborted"));
    if (this.stopping) return this.stopping.promise.then(() => this.init(signal));

    const worker = this.workerFactory();
    const generation = ++this.generation;
    this.worker = worker;
    this.attachWorker(worker, generation);
    const startedAt = Date.now();

    const initialize = async () => {
      try {
        worker.postMessage("uci");
        await this.waitFor(generation, (line) => line === "uciok", this.remainingInitTime(startedAt), "init", signal);
        this.assertCurrent(generation);
        worker.postMessage("setoption name Hash value 16");
        worker.postMessage("setoption name MultiPV value 1");
        worker.postMessage("isready");
        await this.waitFor(generation, (line) => line === "readyok", this.remainingInitTime(startedAt), "init", signal);
        this.assertCurrent(generation);
        this.ready = true;
      } catch (error) {
        this.terminateGeneration(generation);
        throw error;
      } finally {
        this.initializing = null;
      }
    };

    this.initializing = initialize();
    return this.initializing;
  }

  async analyze(request: SearchRequest, signal: AbortSignal): Promise<SearchResult> {
    if (!this.ready || !this.worker) throw new EngineError("init", "Engine is not initialized");
    if (this.searchReserved) throw new EngineError("protocol", "An engine search is already active");
    if (signal.aborted) throw new EngineError("aborted", "Engine search was aborted");
    validateRequest(request);

    this.searchReserved = true;
    const generation = this.generation;
    const worker = this.worker;
    const abort = () => {
      const active = this.activeSearch;
      if (active?.generation === generation) {
        this.finishSearch(active, new EngineError("aborted", "Engine search was aborted"));
      }
      void this.stopAndTerminate(generation);
    };
    signal.addEventListener("abort", abort, { once: true });

    try {
      worker.postMessage("ucinewgame");
      worker.postMessage("setoption name Clear Hash");
      worker.postMessage("isready");
      try {
        await this.waitFor(generation, (line) => line === "readyok", SEARCH_TIMEOUT_MS, "timeout", signal);
      } catch (error) {
        if (error instanceof EngineError && (error.code === "aborted" || error.code === "timeout")) {
          void this.stopAndTerminate(generation);
        }
        throw error;
      }
      this.assertCurrent(generation);

      worker.postMessage(positionCommand(request.history));
      const roots = request.rootMoves?.length ? ` searchmoves ${request.rootMoves.join(" ")}` : "";
      worker.postMessage(`go nodes ${request.nodes}${roots}`);

      return await new Promise<SearchResult>((resolve, reject) => {
        const active: ActiveSearch = {
          generation,
          rootSide: sideToMove(request.history),
          perspective: request.perspective,
          latest: null,
          resolve,
          reject,
          timer: setTimeout(() => {
            this.finishSearch(active, new EngineError("timeout", "Engine search exceeded 15 seconds"));
            void this.stopAndTerminate(generation);
          }, SEARCH_TIMEOUT_MS),
        };
        this.activeSearch = active;
        if (signal.aborted) abort();
      });
    } finally {
      signal.removeEventListener("abort", abort);
      this.searchReserved = false;
    }
  }

  async cancel(): Promise<void> {
    const generation = this.generation;
    if (!this.worker) return;
    const active = this.activeSearch;
    if (active?.generation === generation) {
      this.finishSearch(active, new EngineError("aborted", "Engine search was canceled"));
    }
    await this.stopAndTerminate(generation);
  }

  dispose(): void {
    const active = this.activeSearch;
    if (active) this.finishSearch(active, new EngineError("aborted", "Engine was disposed"));
    this.terminateGeneration(this.generation);
  }

  private remainingInitTime(startedAt: number): number {
    const remaining = INIT_TIMEOUT_MS - (Date.now() - startedAt);
    if (remaining <= 0) throw new EngineError("init", "Engine initialization exceeded 30 seconds");
    return remaining;
  }

  private assertCurrent(generation: number): void {
    if (generation !== this.generation || !this.worker) {
      throw new EngineError("aborted", "Engine generation was replaced");
    }
  }

  private attachWorker(worker: Worker, generation: number): void {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (generation !== this.generation || worker !== this.worker || typeof event.data !== "string") return;
      for (const waiter of [...this.waiters]) {
        if (waiter.generation === generation && waiter.accept(event.data)) {
          this.settleWaiter(waiter, true);
        }
      }

      const active = this.activeSearch;
      if (!active || active.generation !== generation) return;
      const info = parseInfo(event.data, active.rootSide, active.perspective);
      if (info) active.latest = info;
      if (!event.data.startsWith("bestmove ")) return;

      const bestMove = event.data.trim().split(/\s+/)[1];
      const result = active.latest;
      if (
        !isUciMove(bestMove) ||
        !result ||
        result.bound !== "exact" ||
        result.pv.length === 0 ||
        result.pv[0] !== bestMove
      ) {
        this.finishSearch(active, new EngineError("protocol", "Engine returned an inconclusive bestmove result"));
        return;
      }
      this.finishSearch(active, result);
    };

    const onError = (event: ErrorEvent) => {
      if (generation !== this.generation || worker !== this.worker) return;
      const error = new EngineError("crashed", event.message || "Engine worker crashed");
      this.rejectWaiters(generation, error);
      if (this.activeSearch?.generation === generation) this.finishSearch(this.activeSearch, error);
      this.terminateGeneration(generation);
    };

    this.workerMessageListener = onMessage;
    this.workerErrorListener = onError;
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
  }

  private waitFor(
    generation: number,
    accept: (line: string) => boolean,
    timeoutMs: number,
    timeoutCode: "init" | "timeout",
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const waiter: LineWaiter = {
        generation,
        accept,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.settleWaiter(waiter, false, new EngineError(timeoutCode, `${timeoutCode === "init" ? "Initialization" : "Engine operation"} timed out`));
        }, timeoutMs),
        signal,
      };
      if (signal) {
        waiter.abort = () => this.settleWaiter(waiter, false, new EngineError("aborted", "Engine operation was aborted"));
        signal.addEventListener("abort", waiter.abort, { once: true });
      }
      this.waiters.add(waiter);
      if (signal?.aborted) waiter.abort?.();
    });
  }

  private settleWaiter(waiter: LineWaiter, accepted: boolean, error?: EngineError): void {
    if (!this.waiters.delete(waiter)) return;
    clearTimeout(waiter.timer);
    if (waiter.signal && waiter.abort) waiter.signal.removeEventListener("abort", waiter.abort);
    if (accepted) waiter.resolve();
    else waiter.reject(error ?? new EngineError("protocol", "Engine protocol wait failed"));
  }

  private rejectWaiters(generation: number, error: EngineError): void {
    for (const waiter of [...this.waiters]) {
      if (waiter.generation === generation) this.settleWaiter(waiter, false, error);
    }
  }

  private finishSearch(active: ActiveSearch, outcome: SearchResult | EngineError): void {
    if (this.activeSearch !== active) return;
    this.activeSearch = null;
    clearTimeout(active.timer);
    if (outcome instanceof EngineError) active.reject(outcome);
    else active.resolve(outcome);
  }

  private async stopAndTerminate(generation: number): Promise<void> {
    if (this.stopping?.generation === generation) return this.stopping.promise;
    if (generation !== this.generation || !this.worker) return;
    const worker = this.worker;
    this.ready = false;
    const promise = (async () => {
      worker.postMessage("stop");
      try {
        await this.waitFor(generation, (line) => line.startsWith("bestmove "), STOP_TIMEOUT_MS, "timeout");
      } catch {
        // The worker is terminated below whether or not it acknowledges stop.
      }
      this.terminateGeneration(generation);
    })();
    this.stopping = { generation, promise };
    try {
      await promise;
    } finally {
      if (this.stopping?.promise === promise) this.stopping = null;
    }
  }

  private terminateGeneration(generation: number): void {
    if (generation !== this.generation) return;
    const worker = this.worker;
    if (worker) {
      if (this.workerMessageListener) worker.removeEventListener("message", this.workerMessageListener);
      if (this.workerErrorListener) worker.removeEventListener("error", this.workerErrorListener);
      worker.terminate();
    }
    this.rejectWaiters(generation, new EngineError("aborted", "Engine generation ended"));
    this.worker = null;
    this.workerMessageListener = null;
    this.workerErrorListener = null;
    this.ready = false;
    this.generation += 1;
  }
}

function validateRequest(request: SearchRequest): void {
  validateHistory(request.history);
  if (!Number.isSafeInteger(request.nodes) || request.nodes <= 0) {
    throw new EngineError("protocol", "Node budget must be a positive integer");
  }
  if (request.rootMoves && (request.rootMoves.length === 0 || request.rootMoves.some((move) => !isUciMove(move)))) {
    throw new EngineError("protocol", "Root moves must contain valid UCI moves");
  }
}

function sideToMove(requestHistory: SearchRequest["history"]): Side {
  const initialSide = requestHistory.initialFen.trim().split(/\s+/)[1] === "b" ? "black" : "white";
  return requestHistory.moves.length % 2 === 0
    ? initialSide
    : initialSide === "white" ? "black" : "white";
}

export function createBrowserEngine(
  workerFactory: () => Worker = () => new Worker(manifest.workerUrl),
): AnalysisEngine {
  return new BrowserEngine(workerFactory);
}
