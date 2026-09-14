"use client";

import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/components/hooks/usePrefersReducedMotion";

export interface DialogueProps {
  speaker: string;
  text: string | null;
  source?: string;
  emptyText?: string;
}

const CHARS_PER_TICK = 2;
const TICK_MS = 24;

// Visual-novel style commentary box. The companion (sub-project 4) will take
// over `speaker` and feed the same text.
export function Dialogue({ speaker, text, source, emptyText = "No notes for this move." }: DialogueProps) {
  const reducedMotion = usePrefersReducedMotion();
  const fullText = text ?? "";
  const [typing, setTyping] = useState({ text: fullText, shown: 0 });
  if (typing.text !== fullText) setTyping({ text: fullText, shown: 0 });

  const shown = reducedMotion ? fullText.length : Math.min(typing.shown, fullText.length);
  const done = shown >= fullText.length;

  useEffect(() => {
    if (reducedMotion || done) return;
    const timer = setInterval(() => {
      setTyping((current) => ({ ...current, shown: current.shown + CHARS_PER_TICK }));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [reducedMotion, done, fullText]);

  const showAll = () => setTyping({ text: fullText, shown: fullText.length });

  return (
    <section className="mc-dialogue" aria-label="Commentary" data-state={done ? "complete" : "typing"}>
      <p className="mc-dialogue-nametag">{speaker}</p>
      {text ? (
        <div className="mc-dialogue-body" onClick={done ? undefined : showAll}>
          <p className="mc-dialogue-text" aria-hidden="true">
            {fullText.slice(0, shown)}
          </p>
          <p className="mc-sr-only" aria-live="polite">{fullText}</p>
        </div>
      ) : (
        <p className="mc-dialogue-text mc-dialogue-empty">{emptyText}</p>
      )}
      <div className="mc-dialogue-footer">
        {source && <p className="mc-dialogue-source">Source: {source}</p>}
        {!done && (
          <button type="button" className="mc-dialogue-skip" onClick={showAll}>
            Show all
          </button>
        )}
      </div>
    </section>
  );
}
