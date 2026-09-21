export type Side = "white" | "black";
export type UciMove = string;

export interface GameHistory {
  initialFen: string;
  moves: UciMove[];
}

export type Score = { kind: "cp" | "mate"; value: number; perspective: Side };

export interface SearchRequest {
  history: GameHistory;
  perspective: Side;
  nodes: number;
  rootMoves?: UciMove[];
}

export interface SearchResult {
  score: Score;
  bound: "exact" | "lower" | "upper";
  pv: UciMove[];
  nodes: number;
  depth: number;
}

export interface AnalysisEngine {
  readonly buildId: string;
  init(signal: AbortSignal): Promise<void>;
  analyze(request: SearchRequest, signal: AbortSignal): Promise<SearchResult>;
  cancel(): Promise<void>;
  dispose(): void;
}

export type EngineErrorCode = "init" | "protocol" | "aborted" | "timeout" | "crashed";

export class EngineError extends Error {
  constructor(
    public readonly code: EngineErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EngineError";
  }
}
