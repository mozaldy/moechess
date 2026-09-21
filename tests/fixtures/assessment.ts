import { analysisSignature } from "@/lib/assessment/policy";
import type {
  Assessment,
  GameAnalysis,
  ImportedGame,
  PlayerSnapshot,
} from "@/lib/assessment/types";
import { START_FEN } from "@/lib/chess/position";

export function rawGame(overrides: Record<string, unknown> = {}) {
  return {
    uuid: "game-1",
    url: "https://www.chess.com/game/live/1001",
    pgn: '[White "learner"]\n[Black "opponent"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1',
    rated: true,
    rules: "chess",
    time_class: "rapid",
    time_control: "600",
    end_time: 1789862400,
    white: { username: "learner", rating: 900, result: "checkmated" },
    black: { username: "opponent", rating: 950, result: "win" },
    ...overrides,
  };
}

export function fixtureGame(overrides: Partial<ImportedGame> = {}): ImportedGame {
  return {
    playerKey: "learner",
    id: "game-1",
    url: "https://www.chess.com/game/live/1001",
    fingerprint: "fixture-v1",
    pgn: '[White "learner"]\n[Black "opponent"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1',
    history: { initialFen: START_FEN, moves: ["f2f3", "e7e5", "g2g4", "d8h4"] },
    sans: ["f3", "e5", "g4", "Qh4#"],
    endTime: 1789862400,
    side: "white",
    white: "learner",
    black: "opponent",
    whiteRating: 900,
    blackRating: 950,
    whiteResult: "checkmated",
    blackResult: "win",
    timeControl: "600",
    clocks: {},
    ...overrides,
  };
}

const FIXTURE_DATE = "2026-09-20T12:00:00.000Z";

export function fixtureSnapshot(game = fixtureGame()): PlayerSnapshot {
  const current: Assessment = {
    id: `assessment-${game.playerKey}`,
    playerKey: game.playerKey,
    signature: analysisSignature("fixture-engine"),
    selectedIds: [game.id],
    state: "ready",
    coverage: "complete",
    cursor: {
      months: ["2026/09"],
      nextMonth: 1,
      seenIds: [game.id],
      windowStart: "2025-10-01T00:00:00.000Z",
      windowEnd: "2026-09-30T23:59:59.999Z",
      invalid: 0,
      ineligible: 0,
    },
    completedIds: [],
    createdAt: FIXTURE_DATE,
    updatedAt: FIXTURE_DATE,
  };

  return {
    player: { key: game.playerKey, displayName: game.playerKey },
    current,
    draft: null,
    games: [game],
    analyses: [],
  };
}

export function fixtureAnalysis(game = fixtureGame()): GameAnalysis {
  return {
    playerKey: game.playerKey,
    gameId: game.id,
    fingerprint: game.fingerprint,
    signature: analysisSignature("fixture-engine"),
    findings: [],
    exclusions: {},
    openings: [],
    completedAt: FIXTURE_DATE,
  };
}
