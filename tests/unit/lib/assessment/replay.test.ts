import { describe, expect, test } from "vitest";
import { buildReplay, findingReplay } from "@/lib/assessment/replay";
import { START_FEN } from "@/lib/chess/position";
import { fixtureFinding } from "@/tests/fixtures/assessment";

describe("assessment evidence replay", () => {
  test("replays mate with SAN, numbered label, full FEN, and last move", () => {
    const frames = buildReplay("7k/8/5KQ1/8/8/8/8/8 w - - 0 1", ["g6g7"]);
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({ san: null, moveLabel: "Starting position", lastMove: null });
    expect(frames[1]).toMatchObject({ san: "Qg7#", moveLabel: "1. Qg7#", lastMove: { from: "g6", to: "g7" } });
    expect(frames[1].fen).toBe("7k/6Q1/5K2/8/8/8/8/8 b - - 1 1");
  });

  test("numbers black moves from a nonstarting fullmove", () => {
    const frames = buildReplay("7k/8/8/8/8/8/8/4K3 b - - 7 12", ["h8h7"]);
    expect(frames[1].moveLabel).toBe("12... Kh7");
  });

  test("replays promotion legally", () => {
    const frames = buildReplay("4k3/1P6/8/8/8/8/8/4K3 w - - 0 1", ["b7b8q"]);
    expect(frames[1]).toMatchObject({ san: "b8=Q+", lastMove: { from: "b7", to: "b8" } });
  });

  test("rejects illegal or malformed saved moves", () => {
    expect(() => buildReplay(START_FEN, ["e2e5"])).toThrow();
    expect(() => buildReplay(START_FEN, ["e2e4<script>"])).toThrow();
  });

  test("plays both branches from the decision position, allowing tactic at ply one", () => {
    const finding = fixtureFinding();
    expect(findingReplay(finding, "played").map((frame) => frame.moveLabel))
      .toEqual(["Starting position", "2. g4", "2... Qh4#"]);
    expect(findingReplay(finding, "recommended").map((frame) => frame.moveLabel))
      .toEqual(["Starting position", "2. g3"]);
  });

  test("rejects evidence whose root or saved after-position does not match", () => {
    expect(() => findingReplay(fixtureFinding({ playedLine: ["g2g3"] }), "played")).toThrow();
    expect(() => findingReplay(fixtureFinding({ afterFen: START_FEN }), "played")).toThrow();
  });
});
