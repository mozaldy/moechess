import type { GameHistory, SearchResult, Side } from "@/lib/analysis/engine/types";

export type Theme = "hanging" | "mate-one" | "fork";
export type Direction = "missed" | "allowed";

export interface ImportedGame {
  playerKey: string;
  id: string;
  url: string;
  fingerprint: string;
  pgn: string;
  history: GameHistory;
  sans: string[];
  endTime: number;
  side: Side;
  white: string;
  black: string;
  whiteRating?: number;
  blackRating?: number;
  whiteResult: string;
  blackResult: string;
  timeControl: string;
  opening?: { label: string; url?: string };
  clocks: Record<number, number>;
}

export type NormalizedGameResult =
  | { kind: "game"; game: ImportedGame }
  | { kind: "skip"; reason: "ineligible" | "invalid" | "custom-start" };

export interface Finding {
  id: string;
  gameId: string;
  playerKey: string;
  ply: number;
  theme: Theme;
  direction: Direction;
  side: Side;
  beforeFen: string;
  afterFen: string;
  played: string;
  recommended: string;
  playedLine: string[];
  recommendedLine: string[];
  tacticalPly: number;
  targets: string[];
  consequence: { kind: "mate" | "material"; gain: number };
  executed: boolean;
  lowTime: boolean;
  verification: { first: VerificationPass; second: VerificationPass };
}

export interface VerificationPass {
  best: SearchResult;
  played: SearchResult;
  tactic: SearchResult;
}

export interface OpeningMatch {
  gameId: string;
  label: string;
  source: "chesscom" | "course" | "unknown";
  courseSlug?: string;
  nodeId?: string;
  lineIds: string[];
  side: Side;
}

export interface GameAnalysis {
  playerKey: string;
  gameId: string;
  fingerprint: string;
  signature: string;
  findings: Finding[];
  exclusions: Record<string, number>;
  openings: OpeningMatch[];
  completedAt: string;
}

export interface ImportCursor {
  months: string[];
  nextMonth: number;
  seenIds: string[];
  windowStart: string;
  windowEnd: string;
  invalid: number;
  ineligible: number;
}

export interface Assessment {
  id: string;
  playerKey: string;
  signature: string;
  selectedIds: string[];
  state: "importing" | "ready" | "analyzing" | "paused" | "complete" | "failed";
  coverage: "partial" | "complete";
  cursor: ImportCursor;
  completedIds: string[];
  reason?: string;
  retryAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlayerRecord {
  key: string;
  displayName: string;
  lastImportAt?: string;
  refreshAfter?: string;
}

export interface PlayerSnapshot {
  player: PlayerRecord;
  current: Assessment | null;
  draft: Assessment | null;
  games: ImportedGame[];
  analyses: GameAnalysis[];
}
