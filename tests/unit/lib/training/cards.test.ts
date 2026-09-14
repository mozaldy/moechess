import { describe, expect, test } from "vitest";
import { buildCourseTree, parsePgnFile } from "@/lib/course/build-tree";
import type { CourseMeta, CourseTree } from "@/lib/course/types";
import { cardForNode, cardId, cardsForLine, generateCards } from "@/lib/training/cards";

function course(slug: string, pgn: string): CourseTree {
  const meta: CourseMeta = { slug, name: slug, eco: [], mainSide: "white", credits: [], contentLicense: "CC0" };
  return buildCourseTree(meta, parsePgnFile(`${slug}/lines.pgn`, pgn));
}

const ruy = course("ruy", `[LineId "berlin"]
[LineName "Berlin"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 4. O-O *

[LineId "morphy"]
[LineName "Morphy"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 (3... d6) 4. Ba4 *
`);

describe("generateCards", () => {
  test("white cards are positions where white is to move and the course continues", () => {
    const cards = generateCards([ruy], "white");
    expect([...cards.values()].map((c) => c.expected)).toEqual([
      ["e4"], ["Nf3"], ["Bb5"], ["O-O"], ["Ba4"],
    ]);
    const first = cards.get(cardId("white", ruy.nodes.root.position))!;
    expect(first).toMatchObject({ side: "white", nodeIds: ["root"], courseSlugs: ["ruy"] });
    expect(first.id.startsWith("w:")).toBe(true);
  });

  test("black cards list every accepted reply, main move first", () => {
    const cards = generateCards([ruy], "black");
    const afterBb5 = cards.get(cardId("black", ruy.nodes["e4 e5 Nf3 Nc6 Bb5"].position))!;
    expect(afterBb5.expected).toEqual(["Nf6", "a6", "d6"]);
    expect(cards.size).toBe(3);
  });

  test("transpositions across courses share one card", () => {
    const italianA = course("a", `[LineId "a"]\n[LineName "A"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 *\n`);
    const italianB = course("b", `[LineId "b"]\n[LineName "B"]\n\n1. e4 e5 2. Bc4 Nc6 3. Nf3 Nf6 *\n`);
    const cards = generateCards([italianA, italianB], "black");
    const shared = cards.get(cardId("black", italianA.nodes["e4 e5 Nf3 Nc6 Bc4"].position))!;
    expect(shared.expected).toEqual(["Bc5", "Nf6"]);
    expect(shared.courseSlugs).toEqual(["a", "b"]);
    expect(shared.nodeIds).toEqual(["e4 e5 Nf3 Nc6 Bc4", "e4 e5 Bc4 Nc6 Nf3"]);
  });
});

describe("line helpers", () => {
  test("cardsForLine returns the learner's positions in move order", () => {
    const berlin = ruy.lines[0];
    expect(cardsForLine(ruy, berlin, "white")).toEqual([
      cardId("white", ruy.nodes.root.position),
      cardId("white", ruy.nodes["e4 e5"].position),
      cardId("white", ruy.nodes["e4 e5 Nf3 Nc6"].position),
      cardId("white", ruy.nodes["e4 e5 Nf3 Nc6 Bb5 Nf6"].position),
    ]);
    expect(cardsForLine(ruy, berlin, "black")).toHaveLength(3);
  });

  test("cardForNode is null for the opponent's turn and for leaves", () => {
    expect(cardForNode(ruy, "e4", "white")).toBeNull();
    expect(cardForNode(ruy, "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O", "black")).toBeNull();
    expect(cardForNode(ruy, "e4", "black")).toBe(cardId("black", ruy.nodes.e4.position));
  });
});
