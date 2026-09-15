import { expect, test } from "vitest";
import { buildCourseTree, parsePgnFile } from "@/lib/course/build-tree";
import type { CourseMeta } from "@/lib/course/types";
import type { CardState } from "@/lib/progress/types";
import { cardsForLine, generateCards, type CardId } from "@/lib/training/cards";
import { reconcileProgressCards } from "@/lib/training/reconcile-cards";
import { learnCards, newCardState } from "@/lib/training/scheduler";

const NOW = new Date("2026-03-01T09:00:00.000Z");
const meta = (slug: string): CourseMeta => ({ slug, name: slug, eco: [], mainSide: "white", credits: [], contentLicense: "CC0" });
const ruy = buildCourseTree(meta("ruy"), parsePgnFile("ruy/lines.pgn", `[LineId "main"]
[LineName "Main"]

1. e4 e5 2. Nf3 Nc6 *
`));
const italian = buildCourseTree(meta("italian"), parsePgnFile("italian/lines.pgn", `[LineId "main"]
[LineName "Main"]

1. e4 e5 2. Bc4 Nf6 *
`));

// Cards as LearnView used to save them: built from one course only.
function learnedFrom(tree: typeof ruy): Record<CardId, CardState> {
  const specs = generateCards([tree], "white");
  const cards = learnCards(cardsForLine(tree, tree.lines[0], "white").map((id) => newCardState(specs.get(id)!, NOW)), NOW);
  return Object.fromEntries(cards.map((card) => [card.id, card]));
}

test("a position shared with another course keeps its schedule and merges expected moves", () => {
  const stored = learnedFrom(ruy);
  const [startId, sharedId] = cardsForLine(ruy, ruy.lines[0], "white");

  const result = reconcileProgressCards([ruy, italian], "white", stored, NOW);

  expect(result.reset).toEqual([]);
  expect(result.updated).toEqual([sharedId]);
  expect(result.cards[startId]).toBe(stored[startId]);
  expect(result.cards[sharedId]).toEqual({ ...stored[sharedId], expected: ["Nf3", "Bc4"] });
  expect(result.cards[sharedId].status).toBe("review");
});

test("a changed main move resets the card to new", () => {
  const stored = learnedFrom(ruy);
  const sharedId = cardsForLine(ruy, ruy.lines[0], "white")[1];

  // With the Italian first, the shared position's main move is Bc4.
  const result = reconcileProgressCards([italian, ruy], "white", stored, NOW);

  expect(result.reset).toEqual([sharedId]);
  expect(result.cards[sharedId]).toMatchObject({ status: "new", expected: ["Bc4", "Nf3"] });
});

test("only the chosen side's cards come back, and positions no course has are dropped", () => {
  const stored = learnedFrom(ruy);
  const blackCard: CardState = { ...Object.values(stored)[0], id: "b:8/8/8/8/8/8/8/8 b - -" };
  const goneCard: CardState = { ...Object.values(stored)[0], id: "w:8/8/8/8/8/8/8/8 w - -" };

  const result = reconcileProgressCards([ruy], "white", { ...stored, [blackCard.id]: blackCard, [goneCard.id]: goneCard }, NOW);

  expect(Object.keys(result.cards).sort()).toEqual(Object.keys(stored).sort());
  expect(result.reset).toEqual([]);
  expect(result.updated).toEqual([]);
});
