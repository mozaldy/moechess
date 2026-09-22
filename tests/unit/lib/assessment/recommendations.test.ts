import { describe, expect, test } from "vitest";
import { explainFinding } from "@/lib/assessment/explanations";
import { buildRecommendations } from "@/lib/assessment/recommendations";
import type { Assessment, Direction, GameAnalysis, ImportedGame, Theme } from "@/lib/assessment/types";
import { fixtureAnalysis, fixtureFinding, fixtureGame, fixtureSnapshot } from "@/tests/fixtures/assessment";

function records(
  entries: { id: string; theme?: Theme; direction?: Direction; gain?: number; mate?: boolean }[],
): { assessment: Assessment; analyses: GameAnalysis[]; games: ImportedGame[] } {
  const games = entries.map(({ id }, index) => fixtureGame({
    id,
    fingerprint: `fingerprint-${id}`,
    endTime: 1789862400 + index,
  }));
  const analyses = games.map((game, index) => {
    const entry = entries[index];
    return {
      ...fixtureAnalysis(game),
      findings: [fixtureFinding({
        id: `${game.id}:finding`,
        gameId: game.id,
        theme: entry.theme ?? "mate-one",
        direction: entry.direction ?? "allowed",
        consequence: entry.mate === false
          ? { kind: "material", gain: entry.gain ?? 1 }
          : { kind: "mate", gain: 0 },
      })],
    };
  });
  const assessment = {
    ...fixtureSnapshot(games[0] ?? fixtureGame()).current!,
    selectedIds: games.map(({ id }) => id),
    completedIds: games.map(({ id }) => id),
    state: "complete" as const,
  };
  return { assessment, analyses, games };
}

describe("buildRecommendations", () => {
  test("three mistakes in one game do not create a recurring priority", () => {
    const assessment = fixtureSnapshot().current!;
    assessment.completedIds = ["game-1"];
    const analysis = fixtureAnalysis();
    analysis.findings = [2, 4, 6].map((ply) => fixtureFinding({ id: `incident-${ply}`, ply }));
    const report = buildRecommendations(assessment, [analysis], [fixtureGame()]);
    expect(report.priorities).toHaveLength(0);
    expect(report.examples[0].affectedGames).toBe(1);
  });

  test("discards analysis from another signature", () => {
    const assessment = fixtureSnapshot().current!;
    assessment.completedIds = ["game-1"];
    const old = { ...fixtureAnalysis(), signature: "old-engine" };
    expect(buildRecommendations(assessment, [old], [fixtureGame()]).analyzedGames).toBe(0);
  });

  test("requires the active player, selection, completion, and current game fingerprint", () => {
    const { assessment, analyses, games } = records([
      { id: "valid" }, { id: "wrong-player" }, { id: "not-selected" },
      { id: "not-complete" }, { id: "stale" },
    ]);
    assessment.selectedIds = ["valid", "wrong-player", "not-complete", "stale"];
    assessment.completedIds = ["valid", "wrong-player", "not-selected", "stale"];
    analyses[1] = { ...analyses[1], playerKey: "someone-else" };
    analyses[4] = { ...analyses[4], fingerprint: "old-fingerprint" };
    const report = buildRecommendations(assessment, analyses, games);
    expect(report.analyzedGames).toBe(1);
    expect(report.examples[0].findings.map(({ gameId }) => gameId)).toEqual(["valid"]);
  });

  test("promotes a theme only after three distinct games", () => {
    const input = records([{ id: "g1" }, { id: "g2" }, { id: "g3" }]);
    const report = buildRecommendations(input.assessment, input.analyses, input.games);
    expect(report.priorities).toMatchObject([{
      key: "mate-one:allowed", affectedGames: 3, analyzedGames: 3,
    }]);
    expect(report.examples).toHaveLength(0);
  });

  test("keeps allowed and missed findings in separate groups", () => {
    const input = records([
      { id: "a1", direction: "allowed" }, { id: "a2", direction: "allowed" },
      { id: "m1", direction: "missed" }, { id: "m2", direction: "missed" },
    ]);
    const report = buildRecommendations(input.assessment, input.analyses, input.games);
    expect(report.examples.map(({ key, affectedGames }) => [key, affectedGames])).toEqual([
      ["mate-one:allowed", 2], ["mate-one:missed", 2],
    ]);
  });

  test("duplicate analysis records do not inflate a game's count", () => {
    const input = records([{ id: "g1" }, { id: "g2" }]);
    input.analyses.push({ ...input.analyses[0], completedAt: "2026-09-21T00:00:00.000Z" });
    const report = buildRecommendations(input.assessment, input.analyses, input.games);
    expect(report.analyzedGames).toBe(2);
    expect(report.examples[0].affectedGames).toBe(2);
  });

  test("sorts by affected games, mate, material gain, then lexical key and keeps three", () => {
    const input = records([
      { id: "ma1", theme: "mate-one", direction: "allowed" },
      { id: "ma2", theme: "mate-one", direction: "allowed" },
      { id: "ma3", theme: "mate-one", direction: "allowed" },
      { id: "f1", theme: "fork", direction: "missed", mate: false, gain: 5 },
      { id: "f2", theme: "fork", direction: "missed", mate: false, gain: 5 },
      { id: "f3", theme: "fork", direction: "missed", mate: false, gain: 5 },
      { id: "ha1", theme: "hanging", direction: "allowed", mate: false, gain: 3 },
      { id: "ha2", theme: "hanging", direction: "allowed", mate: false, gain: 3 },
      { id: "ha3", theme: "hanging", direction: "allowed", mate: false, gain: 3 },
      { id: "hm1", theme: "hanging", direction: "missed", mate: false, gain: 3 },
      { id: "hm2", theme: "hanging", direction: "missed", mate: false, gain: 3 },
      { id: "hm3", theme: "hanging", direction: "missed", mate: false, gain: 3 },
    ]);
    expect(buildRecommendations(input.assessment, input.analyses, input.games).priorities.map(({ key }) => key))
      .toEqual(["mate-one:allowed", "fork:missed", "hanging:allowed"]);
  });

  test("uses completed compatible games including clean games as the provisional denominator", () => {
    const input = records([{ id: "g1" }, { id: "g2" }]);
    input.analyses[1].findings = [];
    input.assessment.coverage = "partial";
    input.assessment.selectedIds.push("unfinished");
    const report = buildRecommendations(input.assessment, input.analyses, input.games);
    expect(report).toMatchObject({ analyzedGames: 2, provisional: true });
    expect(report.examples[0]).toMatchObject({ affectedGames: 1, analyzedGames: 2 });
  });

  test("returns an empty, non-provisional report when a complete assessment has no findings", () => {
    const input = records([{ id: "clean" }]);
    input.analyses[0].findings = [];
    expect(buildRecommendations(input.assessment, input.analyses, input.games)).toEqual({
      priorities: [], examples: [], analyzedGames: 1, provisional: false,
    });
  });
});

describe("explainFinding", () => {
  test("distinguishes a move that was played from one that could have been played", () => {
    const allowed = explainFinding(fixtureFinding());
    expect(allowed.explanation).toMatch(/played g4/i);
    expect(allowed.explanation).toMatch(/could have played g3/i);

    const missed = explainFinding(fixtureFinding({
      theme: "fork", direction: "missed", recommended: "b1c3", played: "b1a3",
      targets: ["d5", "e4"], consequence: { kind: "material", gain: 3 },
    }));
    expect(missed.explanation).toMatch(/could have played Nc3/i);
    expect(missed.explanation).toMatch(/played Na3/i);
  });

  test("mentions low time as context without claiming it caused the mistake", () => {
    const copy = explainFinding(fixtureFinding({ lowTime: true })).explanation;
    expect(copy).toMatch(/under 30 seconds/i);
    expect(copy).not.toMatch(/because|caused/i);
  });
});
