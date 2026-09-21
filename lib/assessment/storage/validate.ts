import type {
  Assessment,
  Finding,
  GameAnalysis,
  ImportedGame,
  OpeningMatch,
  PlayerRecord,
  PlayerSnapshot,
} from "@/lib/assessment/types";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isChessComUrl(value: unknown, path: RegExp): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.port
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && (url.hostname === "chess.com" || url.hostname === "www.chess.com")
      && path.test(url.pathname);
  } catch {
    return false;
  }
}

function isOptionalPositiveNumber(value: unknown): boolean {
  return value === undefined
    || (typeof value === "number" && Number.isFinite(value) && value > 0);
}

function isSearchResult(value: unknown): boolean {
  if (!isObject(value) || !isObject(value.score)) return false;
  return (value.score.kind === "cp" || value.score.kind === "mate")
    && typeof value.score.value === "number"
    && Number.isFinite(value.score.value)
    && (value.score.perspective === "white" || value.score.perspective === "black")
    && (value.bound === "exact" || value.bound === "lower" || value.bound === "upper")
    && isStringArray(value.pv)
    && Number.isInteger(value.nodes)
    && (value.nodes as number) >= 0
    && Number.isInteger(value.depth)
    && (value.depth as number) >= 0;
}

function isVerificationPass(value: unknown): boolean {
  return isObject(value)
    && isSearchResult(value.best)
    && isSearchResult(value.played)
    && isSearchResult(value.tactic);
}

function isFinding(value: unknown): value is Finding {
  if (!isObject(value) || !isObject(value.consequence) || !isObject(value.verification)) return false;
  return typeof value.id === "string"
    && typeof value.gameId === "string"
    && typeof value.playerKey === "string"
    && Number.isInteger(value.ply)
    && (value.ply as number) >= 0
    && (value.theme === "hanging" || value.theme === "mate-one" || value.theme === "fork")
    && (value.direction === "missed" || value.direction === "allowed")
    && (value.side === "white" || value.side === "black")
    && typeof value.beforeFen === "string"
    && typeof value.afterFen === "string"
    && typeof value.played === "string"
    && typeof value.recommended === "string"
    && isStringArray(value.playedLine)
    && isStringArray(value.recommendedLine)
    && Number.isInteger(value.tacticalPly)
    && (value.tacticalPly as number) >= 0
    && isStringArray(value.targets)
    && (value.consequence.kind === "mate" || value.consequence.kind === "material")
    && typeof value.consequence.gain === "number"
    && Number.isFinite(value.consequence.gain)
    && typeof value.executed === "boolean"
    && typeof value.lowTime === "boolean"
    && isVerificationPass(value.verification.first)
    && isVerificationPass(value.verification.second);
}

function isOpeningMatch(value: unknown): value is OpeningMatch {
  return isObject(value)
    && typeof value.gameId === "string"
    && typeof value.label === "string"
    && (value.source === "chesscom" || value.source === "course" || value.source === "unknown")
    && (value.courseSlug === undefined || typeof value.courseSlug === "string")
    && (value.nodeId === undefined || typeof value.nodeId === "string")
    && isStringArray(value.lineIds)
    && (value.side === "white" || value.side === "black");
}

export function isPlayerRecord(value: unknown): value is PlayerRecord {
  return isObject(value)
    && typeof value.key === "string"
    && value.key.length > 0
    && typeof value.displayName === "string"
    && (value.lastImportAt === undefined || isIsoDate(value.lastImportAt))
    && (value.refreshAfter === undefined || isIsoDate(value.refreshAfter));
}

export function isAssessment(value: unknown): value is Assessment {
  if (!isObject(value) || !isObject(value.cursor)) return false;
  const selectedIds = value.selectedIds;
  return typeof value.id === "string"
    && value.id.length > 0
    && typeof value.playerKey === "string"
    && value.playerKey.length > 0
    && typeof value.signature === "string"
    && value.signature.length > 0
    && isStringArray(selectedIds)
    && new Set(selectedIds).size === selectedIds.length
    && ["importing", "ready", "analyzing", "paused", "complete", "failed"].includes(String(value.state))
    && (value.coverage === "partial" || value.coverage === "complete")
    && isStringArray(value.cursor.months)
    && Number.isInteger(value.cursor.nextMonth)
    && (value.cursor.nextMonth as number) >= 0
    && isStringArray(value.cursor.seenIds)
    && typeof value.cursor.windowStart === "string"
    && typeof value.cursor.windowEnd === "string"
    && Number.isInteger(value.cursor.invalid)
    && (value.cursor.invalid as number) >= 0
    && Number.isInteger(value.cursor.ineligible)
    && (value.cursor.ineligible as number) >= 0
    && isStringArray(value.completedIds)
    && new Set(value.completedIds).size === value.completedIds.length
    && value.completedIds.every((id) => selectedIds.includes(id))
    && (value.reason === undefined || typeof value.reason === "string")
    && (value.retryAt === undefined || isIsoDate(value.retryAt))
    && isIsoDate(value.createdAt)
    && isIsoDate(value.updatedAt);
}

export function isImportedGame(value: unknown): value is ImportedGame {
  if (!isObject(value) || !isObject(value.history) || !isObject(value.clocks)) return false;
  return typeof value.playerKey === "string"
    && value.playerKey.length > 0
    && typeof value.id === "string"
    && value.id.length > 0
    && /^[a-z0-9_-]+$/.test(value.playerKey)
    && /^[A-Za-z0-9_-]+$/.test(value.id)
    && isChessComUrl(value.url, /^\/game\/(?:live|daily)\/\d+\/?$/)
    && typeof value.fingerprint === "string"
    && value.fingerprint.length > 0
    && typeof value.pgn === "string"
    && typeof value.history.initialFen === "string"
    && isStringArray(value.history.moves)
    && value.history.moves.every((move) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move))
    && isStringArray(value.sans)
    && typeof value.endTime === "number"
    && Number.isSafeInteger(value.endTime)
    && value.endTime > 0
    && (value.side === "white" || value.side === "black")
    && typeof value.white === "string"
    && value.white.length > 0
    && typeof value.black === "string"
    && value.black.length > 0
    && isOptionalPositiveNumber(value.whiteRating)
    && isOptionalPositiveNumber(value.blackRating)
    && typeof value.whiteResult === "string"
    && typeof value.blackResult === "string"
    && typeof value.timeControl === "string"
    && /^\d+(?:\+\d+)?$/.test(value.timeControl)
    && (value.opening === undefined || (isObject(value.opening)
      && typeof value.opening.label === "string"
      && value.opening.label.length > 0
      && (value.opening.url === undefined
        || isChessComUrl(value.opening.url, /^\/openings\/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\/?$/))))
    && Object.entries(value.clocks).every(([ply, clock]) => /^\d+$/.test(ply)
      && typeof clock === "number"
      && Number.isFinite(clock)
      && clock >= 0);
}

export function isGameAnalysis(value: unknown): value is GameAnalysis {
  if (!isObject(value) || !Array.isArray(value.findings) || !Array.isArray(value.openings)) return false;
  return typeof value.playerKey === "string"
    && value.playerKey.length > 0
    && typeof value.gameId === "string"
    && value.gameId.length > 0
    && typeof value.fingerprint === "string"
    && value.fingerprint.length > 0
    && typeof value.signature === "string"
    && value.signature.length > 0
    && value.findings.every((finding) => isFinding(finding)
      && finding.playerKey === value.playerKey
      && finding.gameId === value.gameId)
    && isObject(value.exclusions)
    && Object.values(value.exclusions).every((count) => Number.isInteger(count) && (count as number) >= 0)
    && value.openings.every((opening) => isOpeningMatch(opening) && opening.gameId === value.gameId)
    && isIsoDate(value.completedAt);
}

export function validateSnapshot(snapshot: unknown): snapshot is PlayerSnapshot {
  if (!isObject(snapshot) || !isPlayerRecord(snapshot.player)) return false;
  const playerKey = snapshot.player.key;
  if (snapshot.current !== null && (!isAssessment(snapshot.current) || snapshot.current.playerKey !== playerKey)) {
    return false;
  }
  if (snapshot.draft !== null && (!isAssessment(snapshot.draft) || snapshot.draft.playerKey !== playerKey)) {
    return false;
  }
  if (snapshot.current && snapshot.draft && snapshot.current.id === snapshot.draft.id) return false;
  return Array.isArray(snapshot.games)
    && snapshot.games.every((game) => isImportedGame(game) && game.playerKey === playerKey)
    && Array.isArray(snapshot.analyses)
    && snapshot.analyses.every((analysis) => isGameAnalysis(analysis) && analysis.playerKey === playerKey);
}

export function pauseOrphanedJob(assessment: Assessment): Assessment {
  if (assessment.state !== "importing" && assessment.state !== "analyzing") return assessment;
  return { ...assessment, state: "paused" };
}

export function compatibleAnalysis(
  analysis: GameAnalysis,
  game: ImportedGame,
  assessments: Assessment[],
): boolean {
  return analysis.playerKey === game.playerKey
    && analysis.gameId === game.id
    && analysis.fingerprint === game.fingerprint
    && assessments.some((assessment) =>
      assessment.playerKey === analysis.playerKey
      && assessment.signature === analysis.signature
      && assessment.selectedIds.includes(analysis.gameId));
}
