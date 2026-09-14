"use client";

import { useState } from "react";
import { useWorkspace } from "./Providers";

const MESSAGES = {
  unavailable: "Progress won't be saved in this browser. Allow site data for Moechess in your browser settings to keep it.",
  recovered: "Some saved progress couldn't be read and was reset. A backup was kept in this browser.",
  "newer-schema": "Your progress was saved by a newer version of Moechess. Reload the page to update. Until then, new progress won't be saved.",
} as const;

export function StorageBanner() {
  const { status } = useWorkspace();
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (status.kind === "ok" || dismissed === status.kind) return null;

  return (
    <div className="mc-storage-banner" data-kind={status.kind} role="status">
      <p>{MESSAGES[status.kind]}</p>
      <button type="button" onClick={() => setDismissed(status.kind)}>
        Dismiss
      </button>
    </div>
  );
}
