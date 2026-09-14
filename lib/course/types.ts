import type { PositionKey, Side, Square } from "@/lib/chess/position";

export type Brush = "G" | "R" | "Y" | "B";
export interface Arrow { from: Square; to: Square; brush: Brush }
export interface Highlight { square: Square; brush: Brush }
export interface Credit { label: string; author?: string; url?: string; license: string }
export interface Commentary { text: string; source: "wikibooks" | "generated" | "sample"; sourceRef?: string }
export interface CourseMeta {
  slug: string; name: string; eco: string[]; mainSide: Side;
  credits: Credit[]; contentLicense: string;
}
export interface CourseNode {
  id: string;             // "root", or space-joined canonical SAN path: "e4 e5 Nf3"
  fen: string;            // full FEN after this move
  position: PositionKey;
  san: string | null;     // null for root
  parentId: string | null;
  children: string[];     // first = main move
  comment?: Commentary;
  arrows?: Arrow[];
  highlights?: Highlight[];
}
export interface Line { id: string; name: string; nodeIds: string[] } // root excluded
export interface CourseTree {
  meta: CourseMeta;
  rootId: "root";
  nodes: Record<string, CourseNode>;
  lines: Line[];
}
