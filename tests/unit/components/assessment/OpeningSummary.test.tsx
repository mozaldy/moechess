import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { OpeningSummary } from "@/components/assessment/OpeningSummary";
import { buildCourseTree, parsePgnFile } from "@/lib/course/build-tree";
import type { CourseMeta } from "@/lib/course/types";

test("a named lesson link identifies the player's side before opening it", () => {
  const meta: CourseMeta = { slug: "ruy", name: "Ruy Lopez", eco: [], mainSide: "white", credits: [], contentLicense: "CC0" };
  const course = buildCourseTree(meta, parsePgnFile("ruy/lines.pgn", `[LineId "berlin"]
[LineName "Berlin"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 *`));
  render(<OpeningSummary courses={[course]} matches={[{
    gameId: "game-1", label: "Ruy Lopez", source: "course", courseSlug: "ruy",
    nodeId: "e4 e5 Nf3 Nc6 Bb5", lineIds: ["berlin"], side: "white",
  }]} />);
  expect(screen.getByRole("link", { name: "Learn Berlin as White" })).toHaveAttribute("href", "/course/ruy/learn/berlin");
});
