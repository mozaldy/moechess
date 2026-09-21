import { describe, expect, test } from "vitest";
import { START_FEN } from "@/lib/chess/position";
import { ASSESSMENT_POLICY, analysisSignature } from "@/lib/assessment/policy";
import { historyBefore } from "@/lib/import/chesscom/history";
import { normalizeGame, normalizeUsername } from "@/lib/import/chesscom/normalize";
import { fixtureGame, rawGame } from "@/tests/fixtures/assessment";

const completedDraw = {
  pgn: '[White "other"]\n[Black "learner"]\n[Result "1/2-1/2"]\n\n1. e4 e5 2. Nf3 Nf6 1/2-1/2',
  white: { username: "other", rating: 910, result: "agreed" },
  black: { username: "learner", rating: 920, result: "agreed" },
};

describe("normalizeUsername", () => {
  test("trims and case-folds a public Chess.com username", () => {
    expect(normalizeUsername("  Learner  ")).toBe("learner");
  });

  test.each(["", "   ", "bad/name", "bad\\name", "https://chess.com/member/me", "www.chess.com", "bad\u0000name"])(
    "rejects unsafe username %j",
    (input) => expect(() => normalizeUsername(input)).toThrow(),
  );
});

describe("normalizeGame", () => {
  test("accepts a completed loss and normalizes identity", async () => {
    const result = await normalizeGame(rawGame(), normalizeUsername("  Learner  "));
    expect(result.kind).toBe("game");
    if (result.kind !== "game") throw new Error("Expected fixture game");
    expect(result.game).toMatchObject({
      playerKey: "learner",
      id: "game-1",
      side: "white",
      white: "learner",
      black: "opponent",
      whiteRating: 900,
      blackRating: 950,
      whiteResult: "checkmated",
      blackResult: "win",
      timeControl: "600",
      endTime: 1789862400,
      history: { initialFen: START_FEN, moves: ["f2f3", "e7e5", "g2g4", "d8h4"] },
      sans: ["f3", "e5", "g4", "Qh4#"],
      clocks: {},
    });
    expect(result.game.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  test("accepts the entered player as black and a completed draw", async () => {
    const result = await normalizeGame(rawGame(completedDraw), "learner");
    expect(result).toMatchObject({ kind: "game", game: { side: "black" } });
  });

  test.each([
    ["unrated", { rated: false }],
    ["bullet", { time_class: "bullet" }],
    ["ongoing", {
      pgn: '[White "learner"]\n[Black "opponent"]\n[Result "*"]\n\n1. f3 e5 *',
      white: { username: "learner", rating: 900, result: "unknown" },
      black: { username: "opponent", rating: 950, result: "unknown" },
    }],
  ])("skips an ineligible %s game", async (_label, overrides) => {
    await expect(normalizeGame(rawGame(overrides), "learner"))
      .resolves.toEqual({ kind: "skip", reason: "ineligible" });
  });

  test("separates a custom-start game from invalid data", async () => {
    const pgn = '[SetUp "1"]\n[FEN "7k/8/8/8/8/8/8/K7 w - - 0 1"]\n[White "other"]\n[Black "learner"]\n[Result "1/2-1/2"]\n\n1. Kb1 Kg7 1/2-1/2';
    await expect(normalizeGame(rawGame({ ...completedDraw, pgn }), "learner"))
      .resolves.toEqual({ kind: "skip", reason: "custom-start" });
  });

  test.each([
    ["untrusted game link", { url: "javascript:alert(1)" }],
    ["wrong game host", { url: "https://evil.example/game/live/1001" }],
    ["unexpected game port", { url: "https://www.chess.com:444/game/live/1001" }],
    ["unexpected game path", { url: "https://www.chess.com/member/learner" }],
    ["missing completion time", { end_time: undefined }],
    ["non-positive time control", { time_control: "0" }],
    ["malformed time control", { time_control: "rapid" }],
    ["non-positive rating", { white: { username: "learner", rating: 0, result: "checkmated" } }],
    ["player not in API record", { white: { username: "someone", rating: 900, result: "checkmated" } }],
    ["PGN/API identity mismatch", {
      pgn: '[White "someone"]\n[Black "opponent"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1',
    }],
    ["contradictory result", { black: { username: "opponent", rating: 950, result: "checkmated" } }],
    ["unknown completion result", { white: { username: "learner", rating: 900, result: "unknown" } }],
    ["result reason contradicting checkmate", { white: { username: "learner", rating: 900, result: "resigned" } }],
    ["invalid SAN after a legal prefix", {
      pgn: '[White "learner"]\n[Black "opponent"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qz9 0-1',
    }],
  ])("rejects %s", async (_label, overrides) => {
    await expect(normalizeGame(rawGame(overrides), "learner"))
      .resolves.toEqual({ kind: "skip", reason: "invalid" });
  });

  test("keeps source comments containing HTML inert", async () => {
    const pgn = '[White "learner"]\n[Black "opponent"]\n[Result "0-1"]\n\n1. f3 {<img src=x onerror=alert(1)>} e5 2. g4 Qh4# 0-1';
    const result = await normalizeGame(rawGame({ pgn }), "learner");
    expect(result.kind).toBe("game");
    if (result.kind !== "game") throw new Error("Expected game");
    expect(result.game.pgn).not.toContain("<img");
    expect(result.game.sans).toEqual(["f3", "e5", "g4", "Qh4#"]);
  });

  test("allows missing opening and clock fields", async () => {
    const result = await normalizeGame(rawGame(), "learner");
    expect(result).toMatchObject({ kind: "game", game: { clocks: {} } });
    if (result.kind !== "game") throw new Error("Expected game");
    expect(result.game.opening).toBeUndefined();
  });

  test("normalizes trusted opening metadata and parseable clocks", async () => {
    const pgn = '[White "learner"]\n[Black "opponent"]\n[Result "0-1"]\n\n1. f3 {[%clk 0:09:59]} e5 {[%clk 0:09:58.5]} 2. g4 {[%clk nope]} Qh4# {[%clk 0:09:55]} 0-1';
    const result = await normalizeGame(rawGame({
      pgn,
      eco: "https://www.chess.com/openings/Kings-Pawn-Opening",
    }), "learner");
    expect(result).toMatchObject({
      kind: "game",
      game: {
        opening: {
          label: "Kings Pawn Opening",
          url: "https://www.chess.com/openings/Kings-Pawn-Opening",
        },
        clocks: { 0: 599, 1: 598.5, 3: 595 },
      },
    });
  });

  test.each([
    "https://evil.example/openings/Trap",
    "https://www.chess.com/openings/%3Cimg%3E",
  ])("rejects untrusted opening URL %s", async (eco) => {
    await expect(normalizeGame(rawGame({ eco }), "learner"))
      .resolves.toEqual({ kind: "skip", reason: "invalid" });
  });

  test("replays promotion and en-passant mainlines as UCI", async () => {
    const pgn = '[White "learner"]\n[Black "opponent"]\n[Result "1-0"]\n\n1. e4 h5 2. e5 d5 3. exd6 h4 4. a4 h3 5. a5 hxg2 6. a6 gxh1=Q 7. axb7 Qxg1 8. bxa8=Q 1-0';
    const result = await normalizeGame(rawGame({
      pgn,
      white: { username: "learner", rating: 900, result: "win" },
      black: { username: "opponent", rating: 950, result: "resigned" },
    }), "learner");
    expect(result).toMatchObject({
      kind: "game",
      game: {
        history: {
          moves: ["e2e4", "h7h5", "e4e5", "d7d5", "e5d6", "h5h4", "a2a4", "h4h3", "a4a5", "h3g2", "a5a6", "g2h1q", "a6b7", "h1g1", "b7a8q"],
        },
      },
    });
  });

  test("falls back to the source URL game id when UUID is absent", async () => {
    const result = await normalizeGame(rawGame({ uuid: undefined }), "learner");
    expect(result).toMatchObject({ kind: "game", game: { id: "1001" } });
  });

  test("changes the fingerprint when corrected mainline content changes", async () => {
    const corrected = '[White "learner"]\n[Black "opponent"]\n[Result "0-1"]\n\n1. f4 e5 2. g4 Qh4# 0-1';
    const [before, after] = await Promise.all([
      normalizeGame(rawGame(), "learner"),
      normalizeGame(rawGame({ pgn: corrected }), "learner"),
    ]);
    expect(before.kind).toBe("game");
    expect(after.kind).toBe("game");
    if (before.kind !== "game" || after.kind !== "game") throw new Error("Expected games");
    expect(after.game.fingerprint).not.toBe(before.game.fingerprint);
  });

  test("ignores source accuracy values and non-mainline comments for identity", async () => {
    const commented = '[White "learner"]\n[Black "opponent"]\n[Result "0-1"]\n\n1. f3 {new note} e5 2. g4 Qh4# 0-1';
    const [plain, enriched] = await Promise.all([
      normalizeGame(rawGame(), "learner"),
      normalizeGame(rawGame({ pgn: commented, accuracies: { white: 99, black: 1 } }), "learner"),
    ]);
    if (plain.kind !== "game" || enriched.kind !== "game") throw new Error("Expected games");
    expect(enriched.game.fingerprint).toBe(plain.game.fingerprint);
    expect(enriched.game).not.toHaveProperty("accuracies");
  });
});

describe("historyBefore", () => {
  test("returns history through the requested zero-based ply boundary", () => {
    expect(historyBefore(fixtureGame(), 2)).toEqual({
      initialFen: START_FEN,
      moves: ["f2f3", "e7e5"],
    });
  });

  test.each([-1, 1.5, 5])("rejects invalid ply %s", (ply) => {
    expect(() => historyBefore(fixtureGame(), ply)).toThrow(RangeError);
  });
});

describe("assessment policy", () => {
  test("pins global limits and includes all analysis-affecting values in its signature", () => {
    expect(ASSESSMENT_POLICY).toMatchObject({
      importMonths: 12,
      maxGames: 50,
      requestTimeoutMs: 30_000,
      retryDelaysMs: [2_000, 5_000],
      refreshCooldownMs: 60_000,
      verificationNodes: [200_000, 400_000],
      searchWatchdogMs: 15_000,
      cancelTimeoutMs: 1_000,
      materialEvidencePlies: 6,
      evaluationThresholdCp: 100,
      materialThreshold: 1,
      lowTimeSeconds: 30,
      recurringGameThreshold: 3,
      maxPriorities: 3,
      detectorVersion: 1,
      templateVersion: 1,
    });
    expect(analysisSignature("fixture-engine")).toContain("fixture-engine");
    expect(analysisSignature("fixture-engine")).toContain("200000");
    expect(analysisSignature("fixture-engine")).toContain("400000");
    expect(analysisSignature("fixture-engine")).not.toBe(analysisSignature("other-engine"));
  });
});
