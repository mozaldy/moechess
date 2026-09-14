import { describe, expect, test } from "vitest";
import { buildCourseTree, parsePgnFile } from "@/lib/course/build-tree";
import { CourseValidationError } from "@/lib/course/errors";
import { findLine, linesThrough, pathTo } from "@/lib/course/queries";
import type { CourseMeta } from "@/lib/course/types";

const meta: CourseMeta = {
  slug: "fixture", name: "Fixture", eco: ["C60"], mainSide: "white",
  credits: [], contentLicense: "CC BY-SA 4.0",
};

const PGN = `[Event "?"]
[LineId "berlin"]
[LineName "Berlin Defence"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 {The Ruy Lopez. [%cal Gb5c6] [%csl Ge5]} 3... Nf6 4. O-O *

[Event "?"]
[LineId "morphy"]
[LineName "Morphy Defence"]
[CommentSource "wikibooks"]
[CommentRef "https://en.wikibooks.org/wiki/Chess_Opening_Theory"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 {Asks the bishop. } (3... d6 {Steinitz.}) 4. Ba4 *
`;

function build(text = PGN) {
  return buildCourseTree(meta, parsePgnFile("fixture/lines.pgn", text));
}

describe("parsePgnFile", () => {
  test("records the line each game starts on", () => {
    const games = parsePgnFile("fixture/lines.pgn", PGN);
    expect(games.map((g) => g.startLine)).toEqual([1, 7]);
  });

  test("syntax errors name the file, line and column", () => {
    expect(() => parsePgnFile("fixture/bad.pgn", `[Event "?"]\n\n1. e4 {unclosed *`))
      .toThrowError(/fixture\/bad\.pgn:3:\d+/);
  });
});

describe("buildCourseTree", () => {
  test("merges shared moves into one trunk", () => {
    const tree = build();
    const bb5 = tree.nodes["e4 e5 Nf3 Nc6 Bb5"];
    expect(bb5.children).toEqual(["e4 e5 Nf3 Nc6 Bb5 Nf6", "e4 e5 Nf3 Nc6 Bb5 a6", "e4 e5 Nf3 Nc6 Bb5 d6"]);
    expect(tree.nodes.root.children).toEqual(["e4"]);
    expect(tree.nodes.e4.parentId).toBe("root");
  });

  test("attaches comments, arrows and highlights", () => {
    const tree = build();
    const bb5 = tree.nodes["e4 e5 Nf3 Nc6 Bb5"];
    expect(bb5.comment).toEqual({ text: "The Ruy Lopez.", source: "sample" });
    expect(bb5.arrows).toEqual([{ from: "b5", to: "c6", brush: "G" }]);
    expect(bb5.highlights).toEqual([{ square: "e5", brush: "G" }]);
    expect(tree.nodes["e4 e5 Nf3 Nc6 Bb5 a6"].comment).toEqual({
      text: "Asks the bishop.", source: "wikibooks",
      sourceRef: "https://en.wikibooks.org/wiki/Chess_Opening_Theory",
    });
  });

  test("variations become alternatives, not lines", () => {
    const tree = build();
    expect(tree.nodes["e4 e5 Nf3 Nc6 Bb5 d6"].comment?.text).toBe("Steinitz.");
    expect(tree.lines.map((l) => l.id)).toEqual(["berlin", "morphy"]);
    expect(findLine(tree, "berlin")!.nodeIds.at(-1)).toBe("e4 e5 Nf3 Nc6 Bb5 Nf6 O-O");
  });

  test("stores canonical SAN, FEN and position keys", () => {
    const tree = build();
    const castle = tree.nodes["e4 e5 Nf3 Nc6 Bb5 Nf6 O-O"];
    expect(castle.san).toBe("O-O");
    expect(castle.position.split(" ")[1]).toBe("b");
    expect(castle.fen.split(" ")).toHaveLength(6);
  });

  test("queries", () => {
    const tree = build();
    expect(pathTo(tree, "e4 e5 Nf3").map((n) => n.san)).toEqual(["e4", "e5", "Nf3"]);
    expect(linesThrough(tree, "e4 e5 Nf3 Nc6 Bb5").map((l) => l.id)).toEqual(["berlin", "morphy"]);
    expect(linesThrough(tree, "e4 e5 Nf3 Nc6 Bb5 a6").map((l) => l.id)).toEqual(["morphy"]);
  });

  test("illegal moves fail with file, game start line and move", () => {
    const bad = `[Event "?"]\n[LineId "x"]\n[LineName "X"]\n\n1. e4 e5 2. Ke3 *\n`;
    try {
      build(bad);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CourseValidationError);
      expect((e as CourseValidationError).problems).toEqual([
        'fixture/lines.pgn (game starting line 1, line "x"): illegal move 2. Ke3',
      ]);
    }
  });

  test("missing or duplicate line tags fail", () => {
    const bad = `[Event "?"]\n[LineName "No id"]\n\n1. e4 *\n\n[Event "?"]\n[LineId "a"]\n[LineName "A"]\n\n1. d4 *\n\n[Event "?"]\n[LineId "a"]\n[LineName "A again"]\n\n1. c4 *\n`;
    expect(() => build(bad)).toThrowError(CourseValidationError);
    try { build(bad); } catch (e) {
      const problems = (e as CourseValidationError).problems;
      expect(problems).toContain("fixture/lines.pgn (game starting line 1): missing LineId tag");
      expect(problems).toContain('fixture/lines.pgn (game starting line 12): duplicate LineId "a"');
    }
  });

  test("conflicting annotations on a shared node fail", () => {
    const bad = `[Event "?"]\n[LineId "a"]\n[LineName "A"]\n\n1. e4 {One.} e5 *\n\n[Event "?"]\n[LineId "b"]\n[LineName "B"]\n\n1. e4 {Two.} c5 *\n`;
    expect(() => build(bad)).toThrowError(/conflicting annotation on 1\. e4/);
  });
});
