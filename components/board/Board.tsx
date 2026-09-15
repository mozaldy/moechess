"use client";

import {
  useEffect, useId, useRef, useState,
  type FormEvent, type KeyboardEvent, type PointerEvent,
} from "react";
import {
  applySan, legalTargets, moveFromSquares, needsPromotion, piecesOf, positionKey, turnOf,
  type AppliedMove, type PieceCode, type Side, type Square,
} from "@/lib/chess/position";
import { squareAt, squareColor, squareXY, trackPieces } from "@/lib/board/track";
import type { Arrow, Brush, Highlight } from "@/lib/course/types";
import { defaultPieceUrl, getPieceSet, pieceUrl, type PieceSet } from "@/lib/theme/skins";

export interface BoardFeedback {
  square: Square;
  state: "correct" | "mistake" | "hint";
}

export interface BoardProps {
  fen: string;
  orientation: Side;
  interactive: boolean;
  label: string;
  // Return false to reject the move: the piece shows on the new square briefly, then slides back.
  onMove?: (move: AppliedMove) => boolean;
  lastMove?: { from: Square; to: Square } | null;
  arrows?: Arrow[];
  highlights?: Highlight[];
  feedback?: BoardFeedback | null;
  pieceSet?: PieceSet;
}

const PIECE_NAMES: Record<string, string> = {
  K: "king", Q: "queen", R: "rook", B: "bishop", N: "knight", P: "pawn",
};
const BRUSHES: Brush[] = ["G", "R", "Y", "B"];
const FEEDBACK_FILL = { correct: "var(--mc-correct)", mistake: "var(--mc-mistake)", hint: "var(--mc-accent-course)" };
const ARROW_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
};

// Mirrors --mc-duration-feedback so a rejected move slides back when the flash ends.
function feedbackDuration(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--mc-duration-feedback").trim();
  const ms = raw.endsWith("ms") ? parseFloat(raw) : raw.endsWith("s") ? parseFloat(raw) * 1000 : NaN;
  return Number.isFinite(ms) ? ms : 420;
}

function describePiece(code: PieceCode | undefined): string {
  return code ? `${code[0] === "w" ? "white" : "black"} ${PIECE_NAMES[code[1]]}` : "empty";
}

export function Board({
  fen, orientation, interactive, label, onMove,
  lastMove = null, arrows = [], highlights = [], feedback = null, pieceSet,
}: BoardProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const set = pieceSet ?? getPieceSet(null);

  const [selection, setSelection] = useState<{ fen: string; square: Square } | null>(null);
  const [cursor, setCursor] = useState<Square>(orientation === "white" ? "e2" : "e7");
  const [rejectedFen, setRejectedFen] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [typed, setTyped] = useState("");
  const [typedError, setTypedError] = useState<string | null>(null);

  const dragFrom = useRef<Square | null>(null);
  const rejectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttons = useRef(new Map<Square, HTMLButtonElement>());

  const displayFen = rejectedFen ?? fen;
  const [tracked, setTracked] = useState(() => ({ fen: displayFen, pieces: trackPieces([], piecesOf(displayFen)) }));
  if (tracked.fen !== displayFen) {
    setTracked({ fen: displayFen, pieces: trackPieces(tracked.pieces, piecesOf(displayFen)) });
  }

  useEffect(() => () => {
    if (rejectTimer.current) clearTimeout(rejectTimer.current);
  }, []);

  const selected = selection && selection.fen === fen ? selection.square : null;
  const targets = selected ? legalTargets(fen, selected) : [];
  const pieceAt = new Map(piecesOf(displayFen).map((p) => [p.square, p.code]));
  const moverColor = turnOf(positionKey(fen)) === "white" ? "w" : "b";
  const isOwnPiece = (square: Square) => pieceAt.get(square)?.[0] === moverColor;
  const squares = Array.from({ length: 64 }, (_, i) => squareAt(i % 8, Math.floor(i / 8), orientation));

  function submit(move: AppliedMove) {
    setSelection(null);
    const accepted = onMove ? onMove(move) : true;
    if (accepted === false) {
      if (rejectTimer.current) clearTimeout(rejectTimer.current);
      setRejectedFen(move.fenAfter);
      rejectTimer.current = setTimeout(() => setRejectedFen(null), feedbackDuration());
      setAnnouncement(`${move.san} was not accepted`);
    } else {
      setAnnouncement(`You played ${move.san}`);
    }
  }

  function tryMove(from: Square, to: Square) {
    const move = moveFromSquares(fen, from, to, needsPromotion(fen, from, to) ? "q" : undefined);
    if (move) submit(move);
  }

  function handleClick(square: Square) {
    if (!interactive) return;
    setCursor(square);
    if (selected && targets.includes(square)) {
      tryMove(selected, square);
    } else if (isOwnPiece(square) && selected !== square) {
      setSelection({ fen, square });
    } else {
      setSelection(null);
    }
  }

  function handlePointerDown(square: Square) {
    dragFrom.current = interactive && isOwnPiece(square) ? square : null;
  }

  function handlePointerUp(event: PointerEvent<HTMLButtonElement>) {
    const from = dragFrom.current;
    dragFrom.current = null;
    if (!from) return;
    // Touch pointers stay captured by the starting square, so find what is under the finger.
    const hit = typeof document.elementFromPoint === "function"
      ? document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-square]")
      : null;
    const to = (hit ?? event.currentTarget).dataset.square;
    if (to && to !== from && legalTargets(fen, from).includes(to)) tryMove(from, to);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const delta = ARROW_KEYS[event.key];
    if (!delta) return;
    event.preventDefault();
    const { x, y } = squareXY(cursor, orientation);
    const next = squareAt(Math.min(7, Math.max(0, x + delta[0])), Math.min(7, Math.max(0, y + delta[1])), orientation);
    setCursor(next);
    buttons.current.get(next)?.focus();
  }

  function handleTypedMove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = typed.trim();
    if (!interactive || value === "") return;
    const move = applySan(fen, value);
    if (!move) {
      setTypedError(`${value} isn't a legal move here. Check the piece letter and the square.`);
      return;
    }
    setTypedError(null);
    setTyped("");
    submit(move);
  }

  const marks = [
    ...(lastMove ? [lastMove.from, lastMove.to].map((square) => ({ square, kind: "last-move" })) : []),
    ...(selected ? [{ square: selected, kind: "selected" }] : []),
  ];

  return (
    <div className="mc-board-wrap">
      <div
        className="mc-board"
        data-orientation={orientation}
        data-interactive={interactive}
        data-state={feedback?.state}
      >
        <svg className="mc-board-svg" viewBox="0 0 8 8" aria-hidden="true">
          <defs>
            {BRUSHES.map((brush) => (
              <marker
                key={brush}
                id={`${uid}-head-${brush}`}
                viewBox="0 0 10 10"
                refX="5"
                refY="5"
                markerWidth="3"
                markerHeight="3"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L10 5 L0 10 z" fill={`var(--mc-brush-${brush.toLowerCase()})`} />
              </marker>
            ))}
          </defs>

          {squares.map((square) => {
            const { x, y } = squareXY(square, orientation);
            const color = squareColor(square);
            return (
              <rect
                key={square}
                className="mc-square"
                data-square={square}
                data-color={color}
                x={x}
                y={y}
                width={1}
                height={1}
                fill={`var(--mc-board-${color})`}
              />
            );
          })}

          {marks.map(({ square, kind }) => {
            const { x, y } = squareXY(square, orientation);
            return <rect key={`${kind}-${square}`} className="mc-square-mark" data-mark={kind} x={x} y={y} width={1} height={1} />;
          })}

          {highlights.map(({ square, brush }) => {
            const { x, y } = squareXY(square, orientation);
            return (
              <rect
                key={`hl-${square}-${brush}`}
                className="mc-highlight"
                data-brush={brush}
                x={x}
                y={y}
                width={1}
                height={1}
                fill={`var(--mc-brush-${brush.toLowerCase()})`}
              />
            );
          })}

          {feedback && (() => {
            const { x, y } = squareXY(feedback.square, orientation);
            return (
              <rect
                key={`${feedback.state}-${feedback.square}-${fen}`}
                className="mc-feedback"
                data-state={feedback.state}
                x={x}
                y={y}
                width={1}
                height={1}
                fill={FEEDBACK_FILL[feedback.state]}
              />
            );
          })()}

          {targets.map((square) => {
            const { x, y } = squareXY(square, orientation);
            return <circle key={`t-${square}`} className="mc-target" cx={x + 0.5} cy={y + 0.5} r={0.14} />;
          })}

          {tracked.pieces.map((piece) => {
            const { x, y } = squareXY(piece.square, orientation);
            return (
              <image
                key={piece.id}
                className="mc-piece"
                data-piece={piece.code}
                data-square={piece.square}
                href={pieceUrl(set, piece.code)}
                width={1}
                height={1}
                style={{ transform: `translate(${x}px, ${y}px)` }}
                onError={(event) => {
                  const fallback = defaultPieceUrl(piece.code);
                  if (event.currentTarget.getAttribute("href") !== fallback) {
                    event.currentTarget.setAttribute("href", fallback);
                  }
                }}
              />
            );
          })}

          {arrows.map((arrow, i) => {
            const from = squareXY(arrow.from, orientation);
            const to = squareXY(arrow.to, orientation);
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const length = Math.hypot(dx, dy) || 1;
            return (
              <line
                key={`${arrow.from}-${arrow.to}-${i}`}
                className="mc-arrow"
                data-brush={arrow.brush}
                x1={from.x + 0.5}
                y1={from.y + 0.5}
                x2={to.x + 0.5 - (dx / length) * 0.3}
                y2={to.y + 0.5 - (dy / length) * 0.3}
                stroke={`var(--mc-brush-${arrow.brush.toLowerCase()})`}
                markerEnd={`url(#${uid}-head-${arrow.brush})`}
              />
            );
          })}
        </svg>

        <div className="mc-board-grid" role="group" aria-label={label} onKeyDown={handleKeyDown}>
          {squares.map((square) => (
            <button
              key={square}
              ref={(element) => {
                if (element) buttons.current.set(square, element);
                else buttons.current.delete(square);
              }}
              type="button"
              data-square={square}
              tabIndex={square === cursor ? 0 : -1}
              aria-label={`${square}, ${describePiece(pieceAt.get(square))}`}
              aria-pressed={selected === square}
              aria-disabled={!interactive}
              onClick={() => handleClick(square)}
              onPointerDown={() => handlePointerDown(square)}
              onPointerUp={handlePointerUp}
            />
          ))}
        </div>
      </div>

      <form className="mc-move-input" onSubmit={handleTypedMove}>
        <label htmlFor={`${uid}-move`}>Type a move</label>
        <input
          id={`${uid}-move`}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Nf3"
          autoComplete="off"
          spellCheck={false}
          disabled={!interactive}
          aria-invalid={typedError !== null}
          aria-describedby={typedError ? `${uid}-move-error` : undefined}
        />
        <button type="submit" disabled={!interactive}>Play</button>
        {typedError && <p id={`${uid}-move-error`} className="mc-move-error" role="alert">{typedError}</p>}
      </form>

      <p className="mc-sr-only" aria-live="polite">{announcement}</p>
    </div>
  );
}
