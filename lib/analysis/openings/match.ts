import type { ImportedGame, OpeningMatch } from "@/lib/assessment/types";
import { moveFromSquares, positionKey } from "@/lib/chess/position";
import type { CourseNode, CourseTree } from "@/lib/course/types";

export interface CourseLinks {
  explore?: string;
  lessons: { label: string; href: string; side: OpeningMatch["side"] }[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function gamePositions(game: ImportedGame): string[] {
  const positions = [positionKey(game.history.initialFen)];
  let fen = game.history.initialFen;
  for (const uci of game.history.moves) {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) break;
    const move = moveFromSquares(fen, uci.slice(0, 2), uci.slice(2, 4), uci[4]);
    if (!move) break;
    fen = move.fenAfter;
    positions.push(move.keyAfter);
  }
  return positions;
}

function nodeDepth(node: CourseNode): number {
  return node.id === "root" ? 0 : node.id.split(" ").length;
}

function nodesByPosition(course: CourseTree): Map<string, CourseNode[]> {
  const index = new Map<string, CourseNode[]>();
  for (const node of Object.values(course.nodes)) {
    const nodes = index.get(node.position) ?? [];
    nodes.push(node);
    index.set(node.position, nodes);
  }
  for (const nodes of index.values()) {
    nodes.sort((left, right) => nodeDepth(right) - nodeDepth(left) || compareText(left.id, right.id));
  }
  return index;
}

function definingIndex(course: CourseTree, positions: string[]): number {
  if (course.meta.slug !== "ruy-lopez") return 1;
  const defining = course.nodes["e4 e5 Nf3 Nc6 Bb5"];
  return defining ? positions.indexOf(defining.position) : -1;
}

function courseMatch(game: ImportedGame, course: CourseTree, positions: string[]): OpeningMatch | null {
  const start = definingIndex(course, positions);
  if (start < 0) return null;
  const index = nodesByPosition(course);
  let selected: CourseNode | undefined;
  let selectedPly = -1;
  for (let ply = Math.max(1, start); ply < positions.length; ply += 1) {
    const node = index.get(positions[ply])?.[0];
    const isDeeper = node && (!selected || nodeDepth(node) > nodeDepth(selected));
    const isLaterTie = node && selected && nodeDepth(node) === nodeDepth(selected) && ply >= selectedPly;
    if (node && node.id !== "root" && (isDeeper || isLaterTie)) {
      selected = node;
      selectedPly = ply;
    }
  }
  if (!selected) return null;
  const lineIds = course.lines
    .filter((line) => line.nodeIds.some((nodeId) => course.nodes[nodeId]?.position === selected.position))
    .map(({ id }) => id)
    .sort(compareText);
  const sourceLabel = game.opening?.label.trim();
  return {
    gameId: game.id,
    label: sourceLabel || course.meta.name,
    source: sourceLabel ? "chesscom" : "course",
    courseSlug: course.meta.slug,
    nodeId: selected.id,
    lineIds,
    side: game.side,
  };
}

export function matchOpenings(game: ImportedGame, courses: CourseTree[]): OpeningMatch[] {
  const positions = gamePositions(game);
  const matched = courses
    .map((course) => courseMatch(game, course, positions))
    .filter((match): match is OpeningMatch => match !== null)
    .sort((left, right) => compareText(left.courseSlug!, right.courseSlug!));
  if (matched.length > 0) return matched;

  const label = game.opening?.label.trim();
  return [{
    gameId: game.id,
    label: label || "Opening not identified.",
    source: label ? "chesscom" : "unknown",
    lineIds: [],
    side: game.side,
  }];
}

export function resolveCourseLinks(match: OpeningMatch, courses: CourseTree[]): CourseLinks {
  if (!match.courseSlug) return { lessons: [] };
  const course = courses.find(({ meta }) => meta.slug === match.courseSlug);
  if (!course) return { lessons: [] };

  const lessons = match.lineIds.flatMap((lineId) => {
    const line = course.lines.find(({ id }) => id === lineId);
    if (!line) return [];
    const side = match.side === "white" ? "White" : "Black";
    return [{
      label: `${line.name} as ${side}`,
      href: `/course/${encodeURIComponent(course.meta.slug)}/learn/${encodeURIComponent(line.id)}`,
      side: match.side,
    }];
  });
  const node = match.nodeId && Object.hasOwn(course.nodes, match.nodeId)
    ? course.nodes[match.nodeId]
    : undefined;
  if (!node) return { lessons };
  const explore = `/course/${encodeURIComponent(course.meta.slug)}?` + new URLSearchParams({
    node: node.id,
    side: match.side,
  }).toString();
  return { explore, lessons };
}
