export const COLOR_TOKENS = [
  "bg",
  "surface",
  "ink",
  "ink-muted",
  "outline",
  "focus",
  "board-light",
  "board-dark",
  "accent-course",
  "on-accent",
  "correct",
  "on-correct",
  "mistake",
  "on-mistake",
  "brush-g",
  "brush-r",
  "brush-y",
  "brush-b",
] as const;

export const SHAPE_TOKENS = [
  "font-display",
  "font-body",
  "radius-panel",
  "radius-button",
  "border-width",
  "duration-move",
  "duration-feedback",
] as const;

export const TOKEN_NAMES = [...COLOR_TOKENS, ...SHAPE_TOKENS] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];
export type TokenName = (typeof TOKEN_NAMES)[number];

export function cssVar(name: TokenName): `--mc-${TokenName}` {
  return `--mc-${name}`;
}

// [foreground, background, minimum WCAG ratio]. Text pairs need 4.5, UI outlines 3.
export const CONTRAST_PAIRS: [ColorToken, ColorToken, number][] = [
  ["ink", "bg", 4.5],
  ["ink", "surface", 4.5],
  ["ink-muted", "bg", 4.5],
  ["ink-muted", "surface", 4.5],
  ["on-accent", "accent-course", 4.5],
  ["on-correct", "correct", 4.5],
  ["on-mistake", "mistake", 4.5],
  ["outline", "surface", 3],
  ["focus", "bg", 3],
  ["focus", "surface", 3],
];
