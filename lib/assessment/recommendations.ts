import { ASSESSMENT_POLICY } from "@/lib/assessment/policy";
import type {
  Assessment, Direction, Finding, GameAnalysis, ImportedGame, Theme,
} from "@/lib/assessment/types";
import { explainFinding } from "./explanations";

export interface StudyPriority {
  key: string;
  theme: Theme;
  direction: Direction;
  affectedGames: number;
  analyzedGames: number;
  findings: Finding[];
  title: string;
  advice: string;
}

export interface RecommendationSet {
  priorities: StudyPriority[];
  examples: StudyPriority[];
  analyzedGames: number;
  provisional: boolean;
}

interface Group {
  key: string;
  theme: Theme;
  direction: Direction;
  gameIds: Set<string>;
  findings: Finding[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function severity(group: Group): { mate: number; gain: number } {
  let mate = 0;
  let gain = 0;
  for (const finding of group.findings) {
    if (finding.consequence.kind === "mate") mate = 1;
    else gain = Math.max(gain, finding.consequence.gain);
  }
  return { mate, gain };
}

function compareGroups(left: Group, right: Group): number {
  const affected = right.gameIds.size - left.gameIds.size;
  if (affected !== 0) return affected;
  const a = severity(left);
  const b = severity(right);
  if (a.mate !== b.mate) return b.mate - a.mate;
  if (a.gain !== b.gain) return b.gain - a.gain;
  return compareText(left.key, right.key);
}

function representative(group: Group): Finding {
  return [...group.findings].sort((left, right) => {
    if (left.consequence.kind !== right.consequence.kind) {
      return left.consequence.kind === "mate" ? -1 : 1;
    }
    if (left.consequence.kind === "material" && right.consequence.kind === "material"
      && left.consequence.gain !== right.consequence.gain) {
      return right.consequence.gain - left.consequence.gain;
    }
    return compareText(left.id, right.id);
  })[0];
}

function toPriority(group: Group, analyzedGames: number): StudyPriority {
  const finding = representative(group);
  const copy = explainFinding(finding);
  return {
    key: group.key,
    theme: group.theme,
    direction: group.direction,
    affectedGames: group.gameIds.size,
    analyzedGames,
    findings: [...group.findings].sort((left, right) => compareText(left.id, right.id)),
    title: copy.title,
    advice: copy.advice,
  };
}

export function buildRecommendations(
  assessment: Assessment,
  analyses: GameAnalysis[],
  games: ImportedGame[],
): RecommendationSet {
  const fingerprints = new Map(games
    .filter((game) => game.playerKey === assessment.playerKey)
    .map((game) => [game.id, game.fingerprint]));
  const selected = new Set(assessment.selectedIds);
  const completed = new Set(assessment.completedIds);
  const compatible = analyses.filter((analysis) =>
    analysis.playerKey === assessment.playerKey
    && analysis.signature === assessment.signature
    && selected.has(analysis.gameId)
    && completed.has(analysis.gameId)
    && fingerprints.get(analysis.gameId) === analysis.fingerprint);

  // A completed game has one atomic analysis record. If legacy or recovered data
  // contains duplicates, the latest array entry replaces the earlier one.
  const byGame = new Map(compatible.map((analysis) => [analysis.gameId, analysis]));
  const groups = new Map<string, Group>();
  for (const analysis of byGame.values()) {
    for (const finding of analysis.findings) {
      if (finding.gameId !== analysis.gameId || finding.playerKey !== assessment.playerKey) continue;
      const key = `${finding.theme}:${finding.direction}`;
      const group = groups.get(key) ?? {
        key, theme: finding.theme, direction: finding.direction,
        gameIds: new Set<string>(), findings: [],
      };
      group.gameIds.add(analysis.gameId);
      group.findings.push(finding);
      groups.set(key, group);
    }
  }

  const analyzedGames = byGame.size;
  const ordered = [...groups.values()].sort(compareGroups);
  const priorities = ordered
    .filter((group) => group.gameIds.size >= ASSESSMENT_POLICY.recurringGameThreshold)
    .slice(0, ASSESSMENT_POLICY.maxPriorities)
    .map((group) => toPriority(group, analyzedGames));
  const examples = ordered
    .filter((group) => group.gameIds.size > 0
      && group.gameIds.size < ASSESSMENT_POLICY.recurringGameThreshold)
    .map((group) => toPriority(group, analyzedGames));
  const provisional = assessment.coverage !== "complete"
    || assessment.state !== "complete"
    || analyzedGames < assessment.selectedIds.length;

  return { priorities, examples, analyzedGames, provisional };
}
