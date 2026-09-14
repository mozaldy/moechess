import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { listCourseSlugs, loadAllCourses, loadCourse } from "@/lib/course/load";
import { CourseValidationError } from "@/lib/course/errors";

describe("real content", () => {
  test("every course in content/courses builds", () => {
    const courses = loadAllCourses();
    expect(courses.length).toBeGreaterThan(0);
    for (const course of courses) {
      expect(course.lines.length).toBeGreaterThan(0);
      for (const line of course.lines) {
        for (const id of line.nodeIds) expect(course.nodes[id]).toBeDefined();
      }
    }
  });

  test("the Ruy Lopez sample has its seven lines and shared trunk", () => {
    const tree = loadCourse("ruy-lopez")!;
    expect(tree.lines.map((l) => l.id)).toEqual([
      "berlin", "exchange", "open", "marshall", "chigorin", "breyer", "zaitsev",
    ]);
    const bb5 = tree.nodes["e4 e5 Nf3 Nc6 Bb5"];
    expect(bb5.children).toEqual(["e4 e5 Nf3 Nc6 Bb5 Nf6", "e4 e5 Nf3 Nc6 Bb5 a6"]);
    expect(bb5.arrows).toEqual([
      { from: "b5", to: "c6", brush: "G" },
      { from: "c6", to: "e5", brush: "G" },
    ]);
  });

  test("unknown slugs return null", () => {
    expect(loadCourse("does-not-exist")).toBeNull();
    expect(listCourseSlugs()).toContain("ruy-lopez");
  });
});

describe("metadata validation", () => {
  function fixture(meta: object, pgn = `[LineId "a"]\n[LineName "A"]\n\n1. e4 *\n`) {
    const dir = mkdtempSync(path.join(tmpdir(), "mc-course-"));
    mkdirSync(path.join(dir, "demo"));
    writeFileSync(path.join(dir, "demo", "course.json"), JSON.stringify(meta));
    writeFileSync(path.join(dir, "demo", "lines.pgn"), pgn);
    return dir;
  }

  test("slug must match the folder and required fields must exist", () => {
    const dir = fixture({ slug: "other", name: "", eco: "C60", mainSide: "green", credits: [], contentLicense: "CC0" });
    try {
      loadCourse("demo", dir);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CourseValidationError);
      expect((e as CourseValidationError).problems).toEqual([
        'demo/course.json: slug "other" must match folder name "demo"',
        "demo/course.json: name is required",
        "demo/course.json: eco must be an array of strings",
        'demo/course.json: mainSide must be "white" or "black"',
      ]);
    }
  });

  test("a course folder without PGN files fails", () => {
    const dir = fixture({ slug: "demo", name: "Demo", eco: [], mainSide: "white", credits: [], contentLicense: "CC0" }, "");
    expect(() => loadCourse("demo", dir)).toThrowError(/demo: no lines found/);
  });
});
