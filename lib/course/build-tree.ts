import { parseGames } from "@mliebelt/pgn-parser";
import { START_FEN, applySan, positionKey } from "@/lib/chess/position";
import { CourseValidationError } from "./errors";
import type {
  Arrow, Brush, Commentary, CourseMeta, CourseNode, CourseTree, Highlight, Line,
} from "./types";

// Shape verified against @mliebelt/pgn-parser 1.4.19 runtime output. Its bundled
// types describe `variations` incorrectly, so we declare what we read.
export interface ParsedMove {
  notation: { notation: string };
  commentDiag?: { comment?: string; colorArrows?: string[]; colorFields?: string[] } | null;
  variations: ParsedMove[][];
}
export interface ParsedGame {
  tags?: Record<string, unknown>;
  moves: ParsedMove[];
}
export interface SourceGame {
  file: string;
  startLine: number;
  game: ParsedGame;
}

const COMMENT_SOURCES = ["wikibooks", "generated", "sample"] as const;
const ARROW_RE = /^([GRYB])([a-h][1-8])([a-h][1-8])$/;
const FIELD_RE = /^([GRYB])([a-h][1-8])$/;

function gameStartLines(text: string): number[] {
  const starts: number[] = [];
  let inHeader = false;
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === "") return;
    const isHeader = line.startsWith("[");
    if (isHeader && !inHeader) starts.push(index + 1);
    inHeader = isHeader;
  });
  return starts;
}

export function parsePgnFile(file: string, text: string): SourceGame[] {
  let games: ParsedGame[];
  try {
    games = parseGames(text, { startRule: "games" }) as unknown as ParsedGame[];
  } catch (error) {
    const loc = (error as { location?: { start?: { line: number; column: number } } }).location?.start;
    const where = loc ? `${file}:${loc.line}:${loc.column}` : file;
    throw new CourseValidationError([`${where}: PGN syntax error: ${(error as Error).message}`]);
  }
  const starts = gameStartLines(text);
  return games.map((game, i) => ({ file, startLine: starts[i] ?? 1, game }));
}

function tag(game: ParsedGame, name: string): string | undefined {
  const value = game.tags?.[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function moveLabel(fen: string, san: string): string {
  const [, turn, , , , full] = fen.split(" ");
  return turn === "w" ? `${full}. ${san}` : `${full}... ${san}`;
}

interface Annotation {
  comment?: Commentary;
  arrows?: Arrow[];
  highlights?: Highlight[];
}

function annotationOf(move: ParsedMove, source: Commentary["source"], sourceRef?: string): Annotation {
  const diag = move.commentDiag ?? undefined;
  const text = diag?.comment?.trim();
  const arrows = (diag?.colorArrows ?? [])
    .map((a) => ARROW_RE.exec(a))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ brush: m[1] as Brush, from: m[2], to: m[3] }))
    .map(({ from, to, brush }) => ({ from, to, brush }));
  const highlights = (diag?.colorFields ?? [])
    .map((f) => FIELD_RE.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ square: m[2], brush: m[1] as Brush }));
  return {
    ...(text ? { comment: { text, source, ...(sourceRef ? { sourceRef } : {}) } } : {}),
    ...(arrows.length ? { arrows } : {}),
    ...(highlights.length ? { highlights } : {}),
  };
}

function isEmpty(a: Annotation): boolean {
  return !a.comment && !a.arrows && !a.highlights;
}

function sameAnnotation(node: CourseNode, a: Annotation): boolean {
  return JSON.stringify({ c: node.comment, a: node.arrows, h: node.highlights })
    === JSON.stringify({ c: a.comment, a: a.arrows, h: a.highlights });
}

export function buildCourseTree(meta: CourseMeta, games: SourceGame[]): CourseTree {
  const problems: string[] = [];
  const root: CourseNode = {
    id: "root", fen: START_FEN, position: positionKey(START_FEN),
    san: null, parentId: null, children: [],
  };
  const nodes: Record<string, CourseNode> = { root };
  const lines: Line[] = [];
  const seenLineIds = new Set<string>();

  for (const { file, startLine, game } of games) {
    const lineId = tag(game, "LineId");
    const lineName = tag(game, "LineName");
    const where = `${file} (game starting line ${startLine}${lineId ? `, line "${lineId}"` : ""})`;
    if (!lineId) problems.push(`${file} (game starting line ${startLine}): missing LineId tag`);
    if (!lineName) problems.push(`${where}: missing LineName tag`);
    if (lineId && seenLineIds.has(lineId)) {
      problems.push(`${file} (game starting line ${startLine}): duplicate LineId "${lineId}"`);
    }
    if (lineId) seenLineIds.add(lineId);

    const sourceTag = tag(game, "CommentSource") ?? "sample";
    if (!COMMENT_SOURCES.includes(sourceTag as Commentary["source"])) {
      problems.push(`${where}: unknown CommentSource "${sourceTag}"`);
    }
    const source = (COMMENT_SOURCES.includes(sourceTag as Commentary["source"]) ? sourceTag : "sample") as Commentary["source"];
    const sourceRef = tag(game, "CommentRef");

    const walk = (parent: CourseNode, moves: ParsedMove[]): string[] => {
      const path: string[] = [];
      let current = parent;
      for (const move of moves) {
        const before = current;
        const applied = applySan(before.fen, move.notation.notation);
        if (!applied) {
          problems.push(`${where}: illegal move ${moveLabel(before.fen, move.notation.notation)}`);
          return path;
        }
        const id = before.id === "root" ? applied.san : `${before.id} ${applied.san}`;
        let node = nodes[id];
        if (!node) {
          node = {
            id, fen: applied.fenAfter, position: applied.keyAfter, san: applied.san,
            parentId: before.id, children: [],
          };
          nodes[id] = node;
          before.children.push(id);
        }
        const annotation = annotationOf(move, source, sourceRef);
        if (!isEmpty(annotation)) {
          if (!node.comment && !node.arrows && !node.highlights) {
            Object.assign(node, annotation);
          } else if (!sameAnnotation(node, annotation)) {
            problems.push(`${where}: conflicting annotation on ${moveLabel(before.fen, applied.san)}`);
          }
        }
        for (const variation of move.variations) walk(before, variation);
        path.push(id);
        current = node;
      }
      return path;
    };

    const nodeIds = walk(root, game.moves);
    if (nodeIds.length === 0 && game.moves.length === 0) problems.push(`${where}: line has no moves`);
    if (lineId && lineName) lines.push({ id: lineId, name: lineName, nodeIds });
  }

  if (problems.length) throw new CourseValidationError(problems);
  return { meta, rootId: "root", nodes, lines };
}
