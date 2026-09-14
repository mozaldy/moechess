import { describe, expect, test } from "vitest";
import { buildCourseTree, parsePgnFile } from "@/lib/course/build-tree";
import type { CourseMeta } from "@/lib/course/types";
import { layoutBranchMap, stackLabels } from "@/lib/branch-map/layout";

const meta: CourseMeta = { slug: "ruy", name: "Ruy", eco: [], mainSide: "white", credits: [], contentLicense: "CC0" };
const tree = buildCourseTree(meta, parsePgnFile("ruy/lines.pgn", `[LineId "berlin"]
[LineName "Berlin"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 4. O-O *

[LineId "morphy"]
[LineName "Morphy"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 (3... d6) 4. Ba4 *
`));

const byId = (layout: ReturnType<typeof layoutBranchMap>, id: string) => layout.nodes.find((n) => n.id === id)!;

describe("stackLabels", () => {
  test("keeps labels apart without reordering them", () => {
    expect(stackLabels([100, 100, 100], 16)).toEqual([100, 116, 132]);
    expect(stackLabels([200, 50, 58], 16)).toEqual([200, 50, 66]);
    expect(stackLabels([], 16)).toEqual([]);
  });
});

describe("layoutBranchMap", () => {
  test("the trunk shares a lane and each branch gets its own", () => {
    const layout = layoutBranchMap(tree);
    expect(layout.lanes).toBe(3);
    expect(layout.depth).toBe(7);
    expect(byId(layout, "root")).toMatchObject({ x: 0, y: 0, san: null, lineIds: ["berlin", "morphy"] });
    expect(byId(layout, "e4 e5 Nf3 Nc6 Bb5")).toMatchObject({ x: 0, y: 5 });
    expect(byId(layout, "e4 e5 Nf3 Nc6 Bb5 Nf6")).toMatchObject({ x: 0, y: 6, lineIds: ["berlin"] });
    expect(byId(layout, "e4 e5 Nf3 Nc6 Bb5 a6")).toMatchObject({ x: 1, y: 6, lineIds: ["morphy"] });
    expect(byId(layout, "e4 e5 Nf3 Nc6 Bb5 d6")).toMatchObject({ x: 2, y: 6, lineIds: [] });
  });

  test("line names label the last move of each line", () => {
    const layout = layoutBranchMap(tree);
    expect(byId(layout, "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O").label).toBe("Berlin");
    expect(byId(layout, "e4 e5 Nf3 Nc6 Bb5 a6 Ba4").label).toBe("Morphy");
    expect(byId(layout, "e4 e5 Nf3 Nc6 Bb5 d6").label).toBeUndefined();
  });

  test("edges connect every visible parent and child, carrying their lines", () => {
    const layout = layoutBranchMap(tree);
    expect(layout.edges).toHaveLength(layout.nodes.length - 1);
    expect(layout.edges).toContainEqual({ from: "e4 e5 Nf3 Nc6 Bb5", to: "e4 e5 Nf3 Nc6 Bb5 a6", lineIds: ["morphy"] });
  });

  test("deep branches collapse into a stub", () => {
    const layout = layoutBranchMap(tree, { collapseDepth: 3 });
    expect(layout.nodes.some((n) => n.id === "e4 e5 Nf3 Nc6")).toBe(false);
    expect(byId(layout, "e4 e5 Nf3::more")).toMatchObject({
      kind: "collapsed", nodeId: "e4 e5 Nf3", y: 4, hiddenCount: 2, lineIds: ["berlin", "morphy"],
    });
    expect(layout.lanes).toBe(1);
  });

  test("the current path and expanded nodes stay open", () => {
    const current = "e4 e5 Nf3 Nc6 Bb5 a6";
    const layout = layoutBranchMap(tree, { collapseDepth: 3, currentNodeId: current });
    expect(byId(layout, current)).toMatchObject({ kind: "move", y: 6 });
    expect(byId(layout, "e4 e5 Nf3 Nc6 Bb5 a6 Ba4").kind).toBe("move");
    expect(byId(layout, "e4 e5 Nf3 Nc6 Bb5 Nf6::more").hiddenCount).toBe(1);

    const opened = layoutBranchMap(tree, {
      collapseDepth: 3, currentNodeId: current, expanded: new Set(["e4 e5 Nf3 Nc6 Bb5 Nf6"]),
    });
    expect(byId(opened, "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O").kind).toBe("move");
    expect(opened.nodes.some((n) => n.kind === "collapsed")).toBe(false);
  });
});
