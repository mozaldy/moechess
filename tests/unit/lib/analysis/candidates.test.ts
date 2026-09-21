import { Chess } from "chess.js";
import { describe, expect, test } from "vitest";
import { START_FEN } from "@/lib/chess/position";
import { findCandidates, mateMoves, replayHistory } from "@/lib/analysis/tactics/candidates";
import { attackedTargets } from "@/lib/analysis/tactics/geometry";
import { TACTICAL_FIXTURES } from "@/tests/fixtures/tactics";

describe("tactical fixture corpus", () => {
  test("contains legal histories and played moves", () => {
    for (const fixture of TACTICAL_FIXTURES) {
      const board = replayHistory({ initialFen: fixture.initialFen, moves: fixture.moves });
      expect(board.move(fixture.played), fixture.name).not.toBeNull();
    }
  });

  test("enumerates every hand-labeled positive fixture as a candidate hypothesis", () => {
    const expectedTactics: Record<string, string> = {
      "missed mate in one": "g6g7",
      "allowed mate in one": "d8h4",
      "missed hanging queen": "a1a8",
      "allowed hanging queen": "a8a1",
      "missed knight fork": "c3d5",
      "allowed knight fork": "c6d4",
      "black missed mate in one": "b3b2",
      "black allowed mate in one": "e1a5",
      "black missed hanging queen": "h8h1",
      "black allowed hanging queen": "h1h8",
      "black missed knight fork": "f6e4",
      "black allowed knight fork": "f3e5",
      "promotion capture wins a hanging queen": "a7b8q",
      "promotion creates a knight fork": "d7d8n",
    };

    for (const fixture of TACTICAL_FIXTURES.filter(({ expected }) => expected === "verified")) {
      const tactic = expectedTactics[fixture.name];
      expect(tactic, `missing hand-labeled tactic for ${fixture.name}`).toBeTypeOf("string");
      expect(findCandidates(
        { initialFen: fixture.initialFen, moves: fixture.moves },
        fixture.played,
        replayHistory({ initialFen: fixture.initialFen, moves: fixture.moves }).turn() === "w" ? "white" : "black",
      ), fixture.name).toEqual(expect.arrayContaining([
        expect.objectContaining({
          theme: fixture.theme,
          direction: fixture.direction,
          tactic,
        }),
      ]));
    }
  });

  test("keeps consequence-sensitive negative cases as verifier hypotheses", () => {
    const expectedTactics: Record<string, string> = {
      "capturing attacker is recaptured": "a1a8",
      "hanging capture permits immediate mate": "b2b8",
      "allowed loss was unavoidable before the move": "a8a1",
      "played move retains another forced mate": "g6g7",
      "forking knight is immediately recaptured": "c3d5",
      "en passant creates a pawn fork": "e5d6",
    };

    for (const fixture of TACTICAL_FIXTURES.filter(({ name }) => name in expectedTactics)) {
      const board = replayHistory({ initialFen: fixture.initialFen, moves: fixture.moves });
      expect(findCandidates(
        { initialFen: fixture.initialFen, moves: fixture.moves },
        fixture.played,
        board.turn() === "w" ? "white" : "black",
      ), fixture.name).toEqual(expect.arrayContaining([
        expect.objectContaining({
          theme: fixture.theme,
          direction: fixture.direction,
          tactic: expectedTactics[fixture.name],
        }),
      ]));
    }
  });

  test("labels the en-passant fork as rejected because the queen captures the forking pawn", () => {
    const fixture = TACTICAL_FIXTURES.find(({ name }) => name === "en passant creates a pawn fork");
    expect(fixture).toMatchObject({ expected: "rejected" });

    const board = new Chess(fixture!.initialFen);
    expect(board.move("e5d6").isEnPassant()).toBe(true);
    expect(board.move("c7d6")).toMatchObject({ captured: "p" });
    expect(board.get("d6")).toEqual({ color: "b", type: "q" });
  });
});

describe("mate candidates", () => {
  test("finds a legal immediate mate", () => {
    expect(mateMoves({ initialFen: "7k/8/5KQ1/8/8/8/8/8 w - - 0 1", moves: [] }))
      .toContain("g6g7");
  });

  test("playing mate is not a missed-mate candidate", () => {
    const history = { initialFen: "7k/8/5KQ1/8/8/8/8/8 w - - 0 1", moves: [] };
    expect(findCandidates(history, "g6g7", "white").some((candidate) => candidate.theme === "mate-one"))
      .toBe(false);
  });

  test("finds mate allowed by the played move", () => {
    const history = { initialFen: START_FEN, moves: ["f2f3", "e7e5"] };
    expect(findCandidates(history, "g2g4", "white")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        theme: "mate-one",
        direction: "allowed",
        tactic: "d8h4",
        tacticalPly: 1,
      }),
    ]));
  });
});

describe("material and fork candidates", () => {
  test("identifies a missed hanging queen capture as a hypothesis", () => {
    const history = { initialFen: "q5k1/8/8/8/8/8/8/R5K1 w - - 0 1", moves: [] };
    expect(findCandidates(history, "g1h2", "white")).toContainEqual(expect.objectContaining({
      theme: "hanging",
      direction: "missed",
      tactic: "a1a8",
      targets: ["a8"],
      tacticalPly: 0,
    }));
  });

  test("identifies a newly allowed hanging queen capture", () => {
    const history = { initialFen: "r5k1/8/8/8/8/8/8/1Q4K1 w - - 0 1", moves: [] };
    expect(findCandidates(history, "b1a1", "white")).toContainEqual(expect.objectContaining({
      theme: "hanging",
      direction: "allowed",
      tactic: "a8a1",
      targets: ["a1"],
      tacticalPly: 1,
    }));
  });

  test("identifies a knight fork without declaring it a finding", () => {
    const history = { initialFen: "8/4k3/1q6/8/8/2N5/8/4K3 w - - 0 1", moves: [] };
    const candidates = findCandidates(history, "c3b1", "white");
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        theme: "fork",
        direction: "missed",
        tactic: "c3d5",
        targets: expect.arrayContaining(["e7", "b6"]),
      }),
    ]));
  });

  test("identifies a knight fork allowed by the played move", () => {
    const history = { initialFen: "4k3/8/2n5/8/8/8/4K3/1Q6 w - - 0 1", moves: [] };
    expect(findCandidates(history, "b1b3", "white")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        theme: "fork",
        direction: "allowed",
        tactic: "c6d4",
        targets: expect.arrayContaining(["e2", "b3"]),
        tacticalPly: 1,
      }),
    ]));
  });

  test("uses the same legal enumeration when Black is the assessed side", () => {
    const missed = { initialFen: "1k5r/8/8/8/8/8/8/1K5Q b - - 0 1", moves: [] };
    expect(findCandidates(missed, "b8a7", "black")).toContainEqual(expect.objectContaining({
      theme: "hanging",
      direction: "missed",
      tactic: "h8h1",
      targets: ["h1"],
      side: "black",
    }));

    const allowed = { initialFen: "6q1/3k4/8/8/8/5N2/8/3K4 b - - 0 1", moves: [] };
    expect(findCandidates(allowed, "g8g6", "black")).toContainEqual(expect.objectContaining({
      theme: "fork",
      direction: "allowed",
      tactic: "f3e5",
      targets: expect.arrayContaining(["d7", "g6"]),
    }));
  });
});

describe("history and legal-move boundaries", () => {
  test("replays the complete history so repetition remains terminal", () => {
    const history = {
      initialFen: START_FEN,
      moves: [
        "g1f3", "g8f6", "f3g1", "f6g8",
        "g1f3", "g8f6", "f3g1", "f6g8",
      ],
    };
    expect(replayHistory(history).isThreefoldRepetition()).toBe(true);
    expect(mateMoves(history)).toEqual([]);
    expect(findCandidates(history, "e2e4", "white")).toEqual([]);
  });

  test("rejects a side that does not match the decision turn", () => {
    expect(() => findCandidates({ initialFen: START_FEN, moves: [] }, "e2e4", "black"))
      .toThrow(/side/i);
  });

  test("does not emit a geometrically tempting move when the attacker is pinned", () => {
    const history = { initialFen: "4r1k1/8/8/8/8/8/q3R3/4K3 w - - 0 1", moves: [] };
    const candidates = findCandidates(history, "e1f1", "white");
    expect(candidates.some((candidate) => candidate.tactic === "e2a2")).toBe(false);
  });
});

describe("special moves and geometry", () => {
  test("retains promotion suffixes on hanging-piece captures", () => {
    const history = { initialFen: "1q5k/P7/8/8/8/8/8/7K w - - 0 1", moves: [] };
    expect(findCandidates(history, "h1g1", "white")).toEqual(expect.arrayContaining([
      expect.objectContaining({ theme: "hanging", tactic: "a7b8q", targets: ["b8"] }),
    ]));
  });

  test("recognizes an en-passant move that creates a pawn fork", () => {
    const history = { initialFen: "7k/2q1r3/8/3pP3/8/8/8/K7 w - d6 0 1", moves: [] };
    expect(findCandidates(history, "e5e6", "white")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        theme: "fork",
        tactic: "e5d6",
        targets: expect.arrayContaining(["c7", "e7"]),
      }),
    ]));
  });

  test("recognizes an underpromotion that creates a fork", () => {
    const history = { initialFen: "k7/1r1P1r2/8/8/8/8/8/7K w - - 0 1", moves: [] };
    expect(findCandidates(history, "h1g1", "white")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        theme: "fork",
        tactic: "d7d8n",
        targets: ["b7", "f7"],
      }),
    ]));
  });

  test("stops sliding attacks at the first occupied square", () => {
    const board = new Chess("4k3/8/8/8/q1pQ2R1/8/8/4K3 w - - 0 1");
    expect(attackedTargets(board, "d4")).toEqual(["c4"]);
  });
});
