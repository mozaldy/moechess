import { contrastRatio, isHexColor } from "./contrast";
import { BOARD_SKINS, PIECE_SETS } from "./skins";
import type { Theme } from "./themes";
import { COLOR_TOKENS, CONTRAST_PAIRS, TOKEN_NAMES, type TokenName } from "./tokens";

export type ThemeValidation = { ok: true; theme: Theme } | { ok: false; problems: string[] };

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Token values end up inside CSS declarations; block anything that could
// escape the declaration or load a remote resource.
const UNSAFE_VALUE_RE = /[;{}<>\\]|url\s*\(|@import|expression\s*\(/i;

export function validateTheme(raw: unknown): ThemeValidation {
  const problems: string[] = [];
  const theme = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  if (theme.schemaVersion !== 1) problems.push("schemaVersion must be 1");
  if (typeof theme.id !== "string" || !ID_RE.test(theme.id)) problems.push("id must be lowercase words joined by hyphens");
  if (typeof theme.name !== "string" || theme.name.trim() === "") problems.push("name is required");
  if (typeof theme.pieceSetId !== "string" || !PIECE_SETS[theme.pieceSetId]) {
    problems.push(`unknown piece set "${String(theme.pieceSetId)}"`);
  }
  if (typeof theme.boardSkinId !== "string" || !BOARD_SKINS[theme.boardSkinId]) {
    problems.push(`unknown board skin "${String(theme.boardSkinId)}"`);
  }

  const tokens = (typeof theme.tokens === "object" && theme.tokens !== null ? theme.tokens : {}) as Record<string, unknown>;
  for (const name of Object.keys(tokens)) {
    if (!(TOKEN_NAMES as readonly string[]).includes(name)) problems.push(`unknown token "${name}"`);
  }
  for (const name of TOKEN_NAMES) {
    const value = tokens[name];
    if (typeof value !== "string" || value.trim() === "") {
      problems.push(`token "${name}" is missing`);
    } else if (UNSAFE_VALUE_RE.test(value)) {
      problems.push(`token "${name}" contains characters that aren't allowed`);
    } else if ((COLOR_TOKENS as readonly string[]).includes(name) && !isHexColor(value)) {
      problems.push(`token "${name}" must be a #RRGGBB colour`);
    }
  }

  const colorsOk = COLOR_TOKENS.every((name) => typeof tokens[name] === "string" && isHexColor(tokens[name] as string));
  if (colorsOk) {
    for (const [fg, bg, min] of CONTRAST_PAIRS) {
      const ratio = contrastRatio(tokens[fg] as string, tokens[bg] as string);
      if (ratio < min) problems.push(`"${fg}" on "${bg}" has contrast ${ratio.toFixed(2)}, needs ${min}`);
    }
  }

  return problems.length ? { ok: false, problems } : { ok: true, theme: raw as Theme };
}

export type { TokenName };
