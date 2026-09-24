"use client";

import { useState, type FormEvent } from "react";
import type { PlayerRecord } from "@/lib/assessment/types";

export function ImportForm({ busy, players, onImport, onSelect }: {
  busy: boolean;
  players: PlayerRecord[];
  onImport: (username: string) => Promise<void>;
  onSelect: (username: string) => Promise<void>;
}): React.JSX.Element {
  const [username, setUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const disabled = busy || submitting;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = username.trim();
    if (!value || disabled) return;
    setSubmitting(true);
    try { await onImport(value); } finally { setSubmitting(false); }
  }

  return <div className="mc-assessment-import mc-panel">
    <h2 className="mc-panel-title">Bring in your games</h2>
    <form onSubmit={(event) => void submit(event)} className="mc-assessment-form">
      <label htmlFor="chesscom-username">Chess.com username</label>
      <div className="mc-button-row">
        <input id="chesscom-username" value={username} onChange={(event) => setUsername(event.target.value)}
          autoComplete="username" required disabled={disabled} maxLength={50} />
        <button type="submit" disabled={disabled || !username.trim()}>Import games</button>
      </div>
    </form>
    {players.length > 0 && <div>
      <h3 className="mc-panel-heading">Saved in this browser</h3>
      <div className="mc-button-row">{players.map((player) =>
        <button key={player.key} type="button" disabled={disabled}
          onClick={() => void onSelect(player.key)} aria-label={`Open ${player.displayName}`}>
          {player.displayName}
        </button>)}</div>
    </div>}
  </div>;
}
