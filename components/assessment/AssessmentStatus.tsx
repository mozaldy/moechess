"use client";

import { useEffect, useState } from "react";
import type { ControllerView } from "@/lib/assessment/controller";

function formatWindow(startIso: string, endIso: string): string | null {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return null;
  const format = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${format.format(start)} – ${format.format(new Date(end.getTime() - 1))}`;
}

export function useRetryWaitSeconds(retryAt?: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  const deadline = retryAt ? Date.parse(retryAt) : NaN;
  return Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
}

export function AssessmentStatus({ view, onStart, onResume, onCancel, onContinueInMemory }: {
  view: ControllerView;
  onStart: () => void;
  onResume: () => void;
  onCancel: () => void;
  onContinueInMemory: () => void;
}): React.JSX.Element {
  const assessment = view.snapshot?.draft ?? view.snapshot?.current;
  const selected = assessment?.selectedIds.length ?? 0;
  const done = view.report?.analyzedGames ?? 0;
  const skipped = (assessment?.cursor.invalid ?? 0) + (assessment?.cursor.ineligible ?? 0);
  const unfinished = Math.max(0, selected - done);
  const inProgress = view.phase === "importing" || view.phase === "analyzing";
  const waitSeconds = useRetryWaitSeconds(assessment?.retryAt);
  const message = view.message ?? assessment?.reason;
  const windowLabel = assessment ? formatWindow(assessment.cursor.windowStart, assessment.cursor.windowEnd) : null;

  return <section className="mc-assessment-status mc-panel" aria-labelledby="assessment-progress-title">
    <h2 id="assessment-progress-title" className="mc-panel-title">Assessment progress</h2>
    <div role="status" aria-live="polite">
      {assessment ? <>
        <p className="mc-assessment-count">{done} of {selected} games analyzed</p>
        {selected === 0 && (assessment.coverage === "complete" && view.phase !== "importing"
          ? <p>No eligible rated rapid games were found in the selected period.</p>
          : <p>No eligible games imported yet. The scan is unfinished.</p>)}
        <p>Imported: {selected} games</p>
        <p>Analyzed: {done} games</p>
        <p><span>Skipped: {skipped} game records</span> <span className="mc-muted">({assessment.cursor.invalid} invalid, {assessment.cursor.ineligible} ineligible)</span></p>
        <p>Unfinished: {unfinished} games</p>
        {windowLabel && <p>Game window: <span>{windowLabel}</span></p>}
        {view.report?.provisional && <p>Provisional result: more games may change these priorities.</p>}
        {assessment.coverage === "partial" && <p>Game coverage is partial. Resume to continue importing.</p>}
      </> : <p>{view.playerKey ? "No eligible games are ready yet. Import this player's games to begin." : "Choose a player to begin."}</p>}
      {view.sessionOnly && <p>Session only: results will be lost when this tab closes.</p>}
      {view.storage.kind !== "ok" && <p>{view.storage.message}</p>}
      {message && <p>{friendlyMessage(message)}</p>}
      {waitSeconds > 0 && <p>Try again in about {waitSeconds} seconds.</p>}
    </div>
    <div className="mc-button-row">
      {assessment && selected > 0 && (view.phase === "ready" || view.phase === "complete") &&
        <button type="button" onClick={onStart} disabled={view.storage.kind !== "ok" && !view.sessionOnly}>Start analysis</button>}
      {assessment && (selected > 0 || assessment.coverage === "partial") && (view.phase === "paused" || view.phase === "failed") &&
        <button type="button" onClick={onResume} disabled={waitSeconds > 0 || (view.storage.kind !== "ok" && !view.sessionOnly)}>{selected > 0 ? "Resume analysis" : "Resume import"}</button>}
      {inProgress && <button type="button" onClick={onCancel}>Pause assessment</button>}
      {assessment && view.storage.kind !== "ok" && !view.sessionOnly &&
        <button type="button" onClick={onContinueInMemory}>Continue for this session</button>}
    </div>
  </section>;
}

function friendlyMessage(message: string): string {
  const codes: Record<string, string> = {
    "not-found": "Chess.com could not find that player. Check the username and try again.",
    "rate-limit": "Chess.com is limiting requests. Try again after the wait shown below.",
    "invalid-response": "Chess.com returned game data that could not be read. Try importing again.",
    "network": "Could not reach Chess.com. Check your connection and resume.",
    "busy": "Another tab is analyzing games. Close it or wait, then resume.",
    "unsupported": "This browser cannot run this assessment. Try a current browser with local storage and Web Locks.",
    "canceled": "Assessment paused. Your completed games remain saved.",
  };
  const code = message.split(";")[0];
  return codes[code] ?? (message.length > 180 || /stack|engine|bestmove|stockfish|uci|at \w+ \(/i.test(message)
    ? "Assessment paused after an unexpected error. Resume to try again." : message);
}
