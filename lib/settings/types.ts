import type { Side } from "@/lib/chess/position";
import { DEFAULT_THEME_ID, getTheme } from "@/lib/theme/themes";
import { DEFAULT_SESSION_SIZE } from "@/lib/training/review";

export const SETTINGS_KEY = "moechess:settings";
export const SESSION_SIZE_MIN = 5;
export const SESSION_SIZE_MAX = 100;

export interface Settings {
  schemaVersion: 1;
  side: Side;
  sessionSize: number;
  themeId: string;
}

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  side: "white",
  sessionSize: DEFAULT_SESSION_SIZE,
  themeId: DEFAULT_THEME_ID,
};

export interface SettingsStore {
  load(): Settings;
  save(settings: Settings): void;
  available(): boolean;
}

// Each field falls back on its own, so one bad value never resets the others.
export function parseSettings(text: string | null): Settings {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = text ? JSON.parse(text) : {};
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
  } catch {
    raw = {};
  }
  const size = raw.sessionSize;
  return {
    schemaVersion: 1,
    side: raw.side === "black" || raw.side === "white" ? raw.side : DEFAULT_SETTINGS.side,
    sessionSize: Number.isInteger(size) && (size as number) >= SESSION_SIZE_MIN && (size as number) <= SESSION_SIZE_MAX
      ? (size as number)
      : DEFAULT_SETTINGS.sessionSize,
    themeId: typeof raw.themeId === "string" ? getTheme(raw.themeId).id : DEFAULT_SETTINGS.themeId,
  };
}
