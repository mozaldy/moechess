import type { GameHistory, Side } from "@/lib/analysis/engine/types";
import type { Direction, Theme } from "@/lib/assessment/types";

export interface Candidate {
  theme: Theme;
  direction: Direction;
  history: GameHistory;
  side: Side;
  played: string;
  tactic: string;
  targets: string[];
  tacticalPly: 0 | 1;
}

export interface TacticalFixture {
  name: string;
  initialFen: string;
  moves: string[];
  played: string;
  theme: Theme;
  direction: Direction;
  expected: "verified" | "rejected";
  explanation: string;
}
