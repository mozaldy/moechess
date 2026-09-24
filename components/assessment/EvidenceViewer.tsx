"use client";

import { useState } from "react";
import { Board } from "@/components/board/Board";
import type { Finding, ImportedGame } from "@/lib/assessment/types";
import { buildReplay, findingReplay } from "@/lib/assessment/replay";

function safeGameUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return null;
    if (url.hostname !== "www.chess.com" && url.hostname !== "chess.com") return null;
    if (!/^\/game\/(?:live|daily)\/\d+\/?$/.test(url.pathname)) return null;
    return url.toString();
  } catch { return null; }
}

function actualContinuation(finding: Finding, game: ImportedGame): string[] {
  const prefix = buildReplay(game.history.initialFen, game.history.moves.slice(0, finding.ply));
  if (prefix.at(-1)?.fen !== finding.beforeFen || game.history.moves[finding.ply] !== finding.played) return [];
  return buildReplay(finding.beforeFen, game.history.moves.slice(finding.ply, finding.ply + 4))
    .slice(1).map((frame) => frame.moveLabel);
}

export function EvidenceViewer({ finding, game }: { finding: Finding; game: ImportedGame }): React.JSX.Element {
  const [branch, setBranch] = useState<"played" | "recommended">("played");
  const [index, setIndex] = useState(0);
  let frames;
  try {
    frames = findingReplay(finding, branch);
  } catch {
    return <p role="alert" className="mc-notice">Example unavailable because its saved moves could not be replayed.</p>;
  }
  let continuation: string[] = [];
  try { continuation = actualContinuation(finding, game); }
  catch { /* Optional source-game continuation is unavailable; verified evidence remains replayable. */ }

  const frame = frames[Math.min(index, frames.length - 1)];
  const gameUrl = safeGameUrl(game.url);
  return <div>
    <div className="mc-button-row" role="group" aria-label="Evidence line">
      <button type="button" aria-pressed={branch === "played"} onClick={() => { setBranch("played"); setIndex(0); }}>Played line</button>
      <button type="button" aria-pressed={branch === "recommended"} onClick={() => { setBranch("recommended"); setIndex(0); }}>Recommended line</button>
    </div>
    <p>{branch === "played" && finding.direction === "allowed" && !finding.executed
      ? "This move would have punished the mistake; your opponent did not play it."
      : branch === "played" ? "This line shows the verified consequence of the played move." : "This line shows the recommended move."}</p>
    <Board fen={frame.fen} orientation={finding.side} interactive={false} showMoveInput={false}
      label="Position from your game" lastMove={frame.lastMove} announcement={frame.moveLabel} />
    <div className="mc-button-row" role="group" aria-label="Replay controls">
      <button type="button" disabled={index === 0} onClick={() => setIndex((current) => current - 1)}>Previous move</button>
      <span aria-live="polite">{frame.moveLabel}</span>
      <button type="button" disabled={index >= frames.length - 1} onClick={() => setIndex((current) => current + 1)}>Next move</button>
    </div>
    {continuation.length > 0 && <p>Actual game continuation: {continuation.join(" ")}</p>}
    {gameUrl && <a href={gameUrl} target="_blank" rel="noopener noreferrer">View completed game on Chess.com</a>}
  </div>;
}
