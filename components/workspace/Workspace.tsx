"use client";

import { useState, type ReactNode } from "react";

export interface WorkspaceProps {
  board: ReactNode;
  dialogue?: ReactNode;
  map?: ReactNode;
  panel?: ReactNode;
  // Reserved for the 3D companion (sub-project 4). Collapsed to zero width when empty.
  dock?: ReactNode;
}

export function Workspace({ board, dialogue, map, panel, dock }: WorkspaceProps) {
  const [mapOpen, setMapOpen] = useState(false);

  return (
    <div className="mc-workspace" data-dock={dock ? "open" : "closed"} data-has-map={Boolean(map)}>
      {map && (
        <aside className="mc-workspace-map" data-open={mapOpen}>
          <button
            type="button"
            className="mc-workspace-map-toggle"
            aria-expanded={mapOpen}
            onClick={() => setMapOpen((open) => !open)}
          >
            {mapOpen ? "Hide lines" : "Show lines"}
          </button>
          <div className="mc-workspace-map-body">{map}</div>
        </aside>
      )}
      <div className="mc-workspace-stage">
        <div className="mc-workspace-board">{board}</div>
        {dialogue && <div className="mc-workspace-dialogue">{dialogue}</div>}
      </div>
      <div className="mc-workspace-dock" data-state={dock ? "open" : "closed"} hidden={!dock}>
        {dock}
      </div>
      {panel && <aside className="mc-workspace-panel">{panel}</aside>}
    </div>
  );
}
