import { expect, test } from "vitest";
import { START_FEN, applySan } from "@/lib/chess/position";
import { commentarySourceLabel, moveNumberLabel } from "@/lib/course/labels";

test("move number labels", () => {
  const e4 = applySan(START_FEN, "e4")!;
  const e5 = applySan(e4.fenAfter, "e5")!;
  const nf3 = applySan(e5.fenAfter, "Nf3")!;
  expect(moveNumberLabel(e4.fenAfter, "e4")).toBe("1. e4");
  expect(moveNumberLabel(e5.fenAfter, "e5")).toBe("1... e5");
  expect(moveNumberLabel(nf3.fenAfter, "Nf3")).toBe("2. Nf3");
});

test("commentary source labels", () => {
  expect(commentarySourceLabel("wikibooks")).toBe("Wikibooks");
  expect(commentarySourceLabel("sample")).toBe("Moechess sample notes");
});
