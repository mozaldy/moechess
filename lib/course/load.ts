import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { buildCourseTree, parsePgnFile, type SourceGame } from "./build-tree";
import { CourseValidationError } from "./errors";
import type { CourseMeta, CourseTree, Credit } from "./types";

export const COURSES_DIR = path.join(process.cwd(), "content/courses");

export function listCourseSlugs(dir: string = COURSES_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(dir, entry.name, "course.json")))
    .map((entry) => entry.name)
    .sort();
}

function validateMeta(slug: string, raw: unknown): CourseMeta {
  const file = `${slug}/course.json`;
  const problems: string[] = [];
  const m = (raw ?? {}) as Record<string, unknown>;
  if (m.slug !== slug) problems.push(`${file}: slug "${String(m.slug)}" must match folder name "${slug}"`);
  if (typeof m.name !== "string" || m.name.trim() === "") problems.push(`${file}: name is required`);
  if (!Array.isArray(m.eco) || !m.eco.every((e) => typeof e === "string")) {
    problems.push(`${file}: eco must be an array of strings`);
  }
  if (m.mainSide !== "white" && m.mainSide !== "black") {
    problems.push(`${file}: mainSide must be "white" or "black"`);
  }
  const creditsOk = Array.isArray(m.credits) && m.credits.every((c: Credit) =>
    typeof c?.label === "string" && typeof c?.license === "string");
  if (!creditsOk) problems.push(`${file}: credits must be an array of { label, license }`);
  if (typeof m.contentLicense !== "string" || m.contentLicense === "") {
    problems.push(`${file}: contentLicense is required`);
  }
  if (problems.length) throw new CourseValidationError(problems);
  return m as unknown as CourseMeta;
}

export function loadCourse(slug: string, dir: string = COURSES_DIR): CourseTree | null {
  const courseDir = path.join(dir, slug);
  const metaPath = path.join(courseDir, "course.json");
  if (!existsSync(metaPath)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(metaPath, "utf8"));
  } catch (error) {
    throw new CourseValidationError([`${slug}/course.json: invalid JSON: ${(error as Error).message}`]);
  }
  const meta = validateMeta(slug, raw);

  const games: SourceGame[] = readdirSync(courseDir)
    .filter((name) => name.endsWith(".pgn"))
    .sort()
    .flatMap((name) => parsePgnFile(`${slug}/${name}`, readFileSync(path.join(courseDir, name), "utf8")));
  if (games.length === 0) throw new CourseValidationError([`${slug}: no lines found (add a .pgn file)`]);

  return buildCourseTree(meta, games);
}

export function loadAllCourses(dir: string = COURSES_DIR): CourseTree[] {
  return listCourseSlugs(dir).map((slug) => loadCourse(slug, dir)!);
}
