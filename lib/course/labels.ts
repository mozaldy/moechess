import type { Commentary } from "./types";

// "1. e4" for White's moves, "1... e5" for Black's, from the FEN after the move.
export function moveNumberLabel(fenAfter: string, san: string): string {
  const [, turn, , , , full] = fenAfter.split(" ");
  return turn === "b" ? `${full}. ${san}` : `${Number(full) - 1}... ${san}`;
}

const SOURCE_LABELS: Record<Commentary["source"], string> = {
  wikibooks: "Wikibooks",
  generated: "Generated from game data",
  sample: "Moechess sample notes",
};

export function commentarySourceLabel(source: Commentary["source"]): string {
  return SOURCE_LABELS[source];
}
