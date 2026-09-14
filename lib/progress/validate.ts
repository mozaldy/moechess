import type { CardState, ProgressSnapshot } from "./types";

export const CURRENT_SCHEMA_VERSION = 1;

export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

// Key = the version a record is migrated FROM. Add an entry whenever
// CURRENT_SCHEMA_VERSION goes up.
export const MIGRATIONS: Record<number, Migration> = {};

export type ParseResult =
  | { kind: "ok"; snapshot: ProgressSnapshot; dropped: number }
  | { kind: "corrupt" }
  | { kind: "newer"; version: number };

export function emptySnapshot(): ProgressSnapshot {
  return { schemaVersion: 1, cards: {}, learnedLines: {}, explore: {} };
}

const FSRS_NUMBER_FIELDS = [
  "stability", "difficulty", "elapsed_days", "scheduled_days",
  "reps", "lapses", "learning_steps", "state",
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isCardState(id: string, value: unknown): value is CardState {
  if (!isObject(value) || value.id !== id || !/^[wb]:\S/.test(id)) return false;
  const { expected, status, fsrs } = value;
  if (!Array.isArray(expected) || expected.length === 0 || !expected.every((s) => typeof s === "string")) return false;
  if (status !== "new" && status !== "learning" && status !== "review") return false;
  if (!isObject(fsrs) || !isIsoDate(fsrs.due)) return false;
  if (fsrs.last_review !== undefined && !isIsoDate(fsrs.last_review)) return false;
  return FSRS_NUMBER_FIELDS.every((field) => typeof fsrs[field] === "number" && Number.isFinite(fsrs[field]));
}

export function parseSnapshot(
  text: string | null,
  migrations: Record<number, Migration> = MIGRATIONS,
  currentVersion: number = CURRENT_SCHEMA_VERSION,
): ParseResult {
  if (text === null) return { kind: "ok", snapshot: emptySnapshot(), dropped: 0 };

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { kind: "corrupt" };
  }
  if (!isObject(raw) || !Number.isInteger(raw.schemaVersion) || (raw.schemaVersion as number) < 0) {
    return { kind: "corrupt" };
  }

  let version = raw.schemaVersion as number;
  if (version > currentVersion) return { kind: "newer", version };
  let data = raw;
  while (version < currentVersion) {
    const migrate = migrations[version];
    if (!migrate) return { kind: "corrupt" };
    data = migrate(data);
    version += 1;
  }

  const snapshot = emptySnapshot();
  let dropped = 0;

  for (const [id, card] of Object.entries(isObject(data.cards) ? data.cards : {})) {
    if (isCardState(id, card)) snapshot.cards[card.id] = card;
    else dropped += 1;
  }
  for (const [key, entry] of Object.entries(isObject(data.learnedLines) ? data.learnedLines : {})) {
    if (isObject(entry) && isIsoDate(entry.learnedAt)) snapshot.learnedLines[key] = { learnedAt: entry.learnedAt };
    else dropped += 1;
  }
  for (const [slug, entry] of Object.entries(isObject(data.explore) ? data.explore : {})) {
    if (isObject(entry) && typeof entry.lastNodeId === "string") snapshot.explore[slug] = { lastNodeId: entry.lastNodeId };
    else dropped += 1;
  }

  return { kind: "ok", snapshot, dropped };
}
