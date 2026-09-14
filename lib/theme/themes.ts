import type { TokenName } from "./tokens";

export interface Theme {
  schemaVersion: 1;
  id: string;
  name: string;
  tokens: Record<TokenName, string>;
  pieceSetId: string;
  boardSkinId: string;
}

// Font tokens point at the faces loaded by next/font in app/layout.tsx.
const shape = {
  "font-display": "var(--mc-face-display), system-ui, sans-serif",
  "font-body": "var(--mc-face-body), system-ui, sans-serif",
  "radius-panel": "14px",
  "radius-button": "999px",
  "border-width": "2px",
  "duration-move": "180ms",
  "duration-feedback": "420ms",
} as const;

export const SUMMER_SKY: Theme = {
  schemaVersion: 1,
  id: "summer-sky",
  name: "Summer Sky",
  pieceSetId: "cburnett",
  boardSkinId: "tokens",
  tokens: {
    bg: "#DDEBFF",
    surface: "#FFFFFF",
    ink: "#25184A",
    "ink-muted": "#5A4E80",
    outline: "#25184A",
    focus: "#5B2BD9",
    "board-light": "#FFF4DC",
    "board-dark": "#8E7CC3",
    "accent-course": "#FFC63D",
    "on-accent": "#25184A",
    correct: "#1FB88A",
    "on-correct": "#25184A",
    mistake: "#FF4F7B",
    "on-mistake": "#25184A",
    "brush-g": "#E09A00",
    "brush-r": "#FF4F7B",
    "brush-y": "#FFC63D",
    "brush-b": "#3C7BF0",
    ...shape,
  },
};

export const NIGHT_SHIFT: Theme = {
  schemaVersion: 1,
  id: "night-shift",
  name: "Night Shift",
  pieceSetId: "cburnett",
  boardSkinId: "tokens",
  tokens: {
    bg: "#1A1433",
    surface: "#2A2150",
    ink: "#F3EEFF",
    "ink-muted": "#B9ADE0",
    outline: "#B9ADE0",
    focus: "#FFC63D",
    "board-light": "#CFC3F0",
    "board-dark": "#5B4A99",
    "accent-course": "#FFC63D",
    "on-accent": "#1A1433",
    correct: "#3DDBA8",
    "on-correct": "#1A1433",
    mistake: "#FF6B92",
    "on-mistake": "#1A1433",
    "brush-g": "#FFC63D",
    "brush-r": "#FF6B92",
    "brush-y": "#FFE08A",
    "brush-b": "#7FB0FF",
    ...shape,
  },
};

export const BUILT_IN_THEMES: Theme[] = [SUMMER_SKY, NIGHT_SHIFT];
export const DEFAULT_THEME_ID = SUMMER_SKY.id;

export function getTheme(id: string | null | undefined): Theme {
  return BUILT_IN_THEMES.find((theme) => theme.id === id) ?? SUMMER_SKY;
}
