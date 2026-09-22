import { describe, expect, test } from "vitest";
import { matchOpenings, resolveCourseLinks } from "@/lib/analysis/openings/match";
import { loadCourse } from "@/lib/course/load";
import type { CourseTree } from "@/lib/course/types";
import { START_FEN } from "@/lib/chess/position";
import { fixtureGame } from "@/tests/fixtures/assessment";

const ruy = () => loadCourse("ruy-lopez")!;

test("does not call every e4 game a Ruy Lopez", () => {
  const game = fixtureGame({
    history: { initialFen: START_FEN, moves: ["e2e4", "c7c5"] },
    sans: ["e4", "c5"],
  });
  const matches = matchOpenings(game, [ruy()]);
  expect(matches.some((match) => match.courseSlug === "ruy-lopez")).toBe(false);
});

describe("matchOpenings", () => {
  test("matches a genuine Ruy Lopez at its defining position", () => {
    const game = fixtureGame({
      history: { initialFen: START_FEN, moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"] },
      sans: ["e4", "e5", "Nf3", "Nc6", "Bb5"],
      opening: undefined,
    });
    expect(matchOpenings(game, [ruy()])).toEqual([expect.objectContaining({
      label: "Ruy Lopez", source: "course", courseSlug: "ruy-lopez",
      nodeId: "e4 e5 Nf3 Nc6 Bb5",
      lineIds: ["berlin", "breyer", "chigorin", "exchange", "marshall", "open", "zaitsev"],
      side: "white",
    })]);
  });

  test("matches a transposition after the defining Ruy position", () => {
    const game = fixtureGame({
      history: { initialFen: START_FEN, moves: [
        "e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5c6", "d7c6",
        "d2d4", "f7f6", "e1g1",
      ] },
      sans: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Bxc6", "dxc6", "d4", "f6", "O-O"],
      opening: undefined,
    });
    expect(matchOpenings(game, [ruy()])[0]).toMatchObject({
      courseSlug: "ruy-lopez",
      nodeId: "e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O f6 d4",
      lineIds: ["exchange"],
    });
  });

  test("keeps a Chess.com source label but never uses its malformed URL as a link", () => {
    const game = fixtureGame({
      history: { initialFen: START_FEN, moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"] },
      sans: ["e4", "e5", "Nf3", "Nc6", "Bb5"],
      opening: { label: "Ruy Lopez", url: "javascript:alert(1)" },
    });
    const match = matchOpenings(game, [ruy()])[0];
    expect(match).toMatchObject({ label: "Ruy Lopez", source: "chesscom", courseSlug: "ruy-lopez" });
    expect(resolveCourseLinks(match, [ruy()]).explore).toMatch(/^\/course\/ruy-lopez\?/);
  });

  test("retains an unmatched source classification without inventing a course", () => {
    const game = fixtureGame({
      history: { initialFen: START_FEN, moves: ["e2e4", "c7c5"] },
      sans: ["e4", "c5"],
      opening: { label: "Sicilian Defense", url: "https://www.chess.com/openings/Sicilian-Defense" },
    });
    const [match] = matchOpenings(game, [ruy()]);
    expect(match).toEqual({
      gameId: "game-1", label: "Sicilian Defense", source: "chesscom", lineIds: [], side: "white",
    });
    expect(resolveCourseLinks(match, [ruy()])).toEqual({ lessons: [] });
  });

  test("uses a neutral label when neither source nor course identifies the opening", () => {
    const [match] = matchOpenings(fixtureGame({
      history: { initialFen: START_FEN, moves: ["d2d4", "d7d5"] }, sans: ["d4", "d5"], opening: undefined,
    }), [ruy()]);
    expect(match).toMatchObject({ label: "Opening not identified.", source: "unknown" });
  });
});

describe("resolveCourseLinks", () => {
  test("offers every compatible named lesson with the assessed side", () => {
    const tree = ruy();
    const game = fixtureGame({
      side: "black",
      history: { initialFen: START_FEN, moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"] },
      sans: ["e4", "e5", "Nf3", "Nc6", "Bb5"],
      opening: undefined,
    });
    const links = resolveCourseLinks(matchOpenings(game, [tree])[0], [tree]);
    expect(links.explore).toBe("/course/ruy-lopez?node=e4+e5+Nf3+Nc6+Bb5&side=black");
    expect(links.lessons).toHaveLength(7);
    expect(links.lessons[0]).toEqual({
      label: expect.stringMatching(/as Black$/),
      href: expect.stringMatching(/^\/course\/ruy-lopez\/learn\//),
      side: "black",
    });
  });

  test("drops links to nodes and lessons removed from current course data", () => {
    const tree = ruy();
    const match = {
      gameId: "game-1", label: "Ruy Lopez", source: "course" as const,
      courseSlug: "ruy-lopez", nodeId: "e4 e5 Nf3 Nc6 Bb5", lineIds: ["berlin", "removed"],
      side: "white" as const,
    };
    const withoutNode: CourseTree = { ...tree, nodes: { ...tree.nodes } };
    delete withoutNode.nodes[match.nodeId];
    expect(resolveCourseLinks(match, [withoutNode])).toEqual({
      lessons: [{ label: "Berlin Defence as White", href: "/course/ruy-lopez/learn/berlin", side: "white" }],
    });

    const withoutLine = { ...tree, lines: tree.lines.filter(({ id }) => id !== "berlin") };
    expect(resolveCourseLinks(match, [withoutLine])).toEqual({
      explore: "/course/ruy-lopez?node=e4+e5+Nf3+Nc6+Bb5&side=white", lessons: [],
    });
  });

  test("rejects stale or fabricated course slugs", () => {
    expect(resolveCourseLinks({
      gameId: "game-1", label: "Ruy Lopez", source: "course",
      courseSlug: "../evil", nodeId: "root", lineIds: ["berlin"], side: "white",
    }, [ruy()])).toEqual({ lessons: [] });
  });

  test("does not treat inherited object properties as current course nodes", () => {
    expect(resolveCourseLinks({
      gameId: "game-1", label: "Ruy Lopez", source: "course",
      courseSlug: "ruy-lopez", nodeId: "toString", lineIds: [], side: "white",
    }, [ruy()])).toEqual({ lessons: [] });
  });
});
