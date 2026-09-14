import type { PieceCode } from "@/lib/chess/position";
import type { Credit } from "@/lib/course/types";

export const PIECE_CODES: PieceCode[] = [
  "wK", "wQ", "wR", "wB", "wN", "wP", "bK", "bQ", "bR", "bB", "bN", "bP",
];

export interface PieceSet {
  id: string;
  name: string;
  credit: Credit;
  pieces: Partial<Record<PieceCode, string>>;
}

export type BoardSkin =
  | { id: string; name: string; kind: "tokens" }
  | { id: string; name: string; kind: "texture"; lightTexture: string; darkTexture: string };

export const DEFAULT_PIECE_SET_ID = "cburnett";
export const DEFAULT_BOARD_SKIN_ID = "tokens";

export const PIECE_SETS: Record<string, PieceSet> = {
  cburnett: {
    id: "cburnett",
    name: "Cburnett",
    credit: {
      label: "Chess pieces",
      author: "Colin M.L. Burnett",
      url: "https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces",
      license: "CC BY-SA 3.0",
    },
    pieces: Object.fromEntries(PIECE_CODES.map((code) => [code, `/pieces/cburnett/${code}.svg`])),
  },
};

export const BOARD_SKINS: Record<string, BoardSkin> = {
  tokens: { id: "tokens", name: "Theme colours", kind: "tokens" },
};

export function getPieceSet(id: string | null | undefined): PieceSet {
  return (id && PIECE_SETS[id]) || PIECE_SETS[DEFAULT_PIECE_SET_ID];
}

export function getBoardSkin(id: string | null | undefined): BoardSkin {
  return (id && BOARD_SKINS[id]) || BOARD_SKINS[DEFAULT_BOARD_SKIN_ID];
}

// A set that lacks a piece falls back to the default set for that piece.
export function pieceUrl(set: PieceSet, code: PieceCode): string {
  return set.pieces[code] ?? (PIECE_SETS[DEFAULT_PIECE_SET_ID].pieces[code] as string);
}

export function defaultPieceUrl(code: PieceCode): string {
  return PIECE_SETS[DEFAULT_PIECE_SET_ID].pieces[code] as string;
}
