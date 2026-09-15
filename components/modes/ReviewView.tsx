"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Board, type BoardFeedback } from "@/components/board/Board";
import { Dialogue } from "@/components/dialogue/Dialogue";
import { useWorkspace } from "@/components/workspace/Providers";
import { Workspace } from "@/components/workspace/Workspace";
import { applySan, turnOf, type AppliedMove, type Side } from "@/lib/chess/position";
import type { Arrow, CourseTree } from "@/lib/course/types";
import type { SessionStats } from "@/lib/events/bus";
import type { ProgressSnapshot } from "@/lib/progress/types";
import type { CardId } from "@/lib/training/cards";
import { reconcileProgressCards } from "@/lib/training/reconcile-cards";
import {
  nextReview, reviewExpectedMove, reviewNode, reviewReducer, reviewTurn, type ReviewState,
} from "@/lib/training/review";
import { gradeCard } from "@/lib/training/scheduler";

const SIDE_NAMES: Record<Side, string> = { white: "White", black: "Black" };

export interface ReviewViewProps {
  trees: CourseTree[];
  opponentDelayMs?: number;
  autoDelayMs?: number;
  // How long a revealed answer stays on screen before it is played.
  revealDelayMs?: number;
}

export function ReviewView({ trees, opponentDelayMs = 500, autoDelayMs = 250, revealDelayMs = 1500 }: ReviewViewProps) {
  const { settings, snapshot } = useWorkspace();
  if (!snapshot) return <p className="mc-muted">Loading your progress…</p>;
  return (
    <ReviewSession
      key={settings.side}
      trees={trees}
      side={settings.side}
      sessionSize={settings.sessionSize}
      opponentDelayMs={opponentDelayMs}
      autoDelayMs={autoDelayMs}
      revealDelayMs={revealDelayMs}
    />
  );
}

interface ReviewSessionProps {
  trees: CourseTree[];
  side: Side;
  sessionSize: number;
  opponentDelayMs: number;
  autoDelayMs: number;
  revealDelayMs: number;
}

interface Session {
  review: ReviewState | null;
  gradedIds: CardId[];
  stats: SessionStats;
}

function pickNext(trees: CourseTree[], side: Side, snapshot: ProgressSnapshot, now: Date, session: Session, size: number) {
  const { cards } = reconcileProgressCards(trees, side, snapshot.cards, now);
  for (const id of session.gradedIds) delete cards[id];
  return nextReview(trees, { ...snapshot, cards }, side, now, session.stats.graded, size);
}

function coachText(tree: CourseTree, review: ReviewState): string {
  const feedback = review.feedback;
  if (feedback?.kind === "mistake") return `${feedback.played} isn't the course move. Try again.`;
  if (feedback?.kind === "revealed") return `The course plays ${feedback.expected} here. This position comes back soon.`;
  if (feedback?.kind === "alternative") return `${feedback.played} is also good, but this line plays ${feedback.expected}.`;
  if (feedback?.kind === "correct") return reviewNode(tree, review).comment?.text ?? "Correct.";
  return "Find the course move.";
}

function ReviewSession({ trees, side, sessionSize, opponentDelayMs, autoDelayMs, revealDelayMs }: ReviewSessionProps) {
  const { snapshot, events, now, commitProgress } = useWorkspace();
  const [openedAt] = useState(now);
  const [session, setSession] = useState<Session>(() => {
    const empty: Session = { review: null, gradedIds: [], stats: { graded: 0, good: 0, again: 0, mistakes: 0 } };
    return { ...empty, review: pickNext(trees, side, snapshot as ProgressSnapshot, openedAt, empty, sessionSize) };
  });
  const [nothingDueAtStart] = useState(session.review === null);
  const [finished, setFinished] = useState(nothingDueAtStart);
  const [announcement, setAnnouncement] = useState<string | undefined>(undefined);
  const resetSaved = useRef(false);

  const review = session.review;
  const tree = review ? trees.find((t) => t.meta.slug === review.courseSlug)! : null;
  const turn = tree && review ? reviewTurn(tree, review) : "done";

  useEffect(() => {
    if (resetSaved.current || !snapshot) return;
    resetSaved.current = true;
    // Positions that left every course are skipped; changed cards are saved once.
    const { reset, updated, cards } = reconcileProgressCards(trees, side, snapshot.cards, openedAt);
    const changed = [...reset, ...updated];
    if (changed.length > 0) void commitProgress((store) => store.saveCards(changed.map((id) => cards[id])));
  }, [snapshot, trees, side, openedAt, commitProgress]);

  useEffect(() => {
    if (finished) {
      events.emit({ type: "sessionEnded", mode: "review", stats: session.stats });
    }
    // Emit once when the session finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  useEffect(() => {
    if (!tree || !review || finished) return;
    if (turn === "opponent" || turn === "auto") {
      const delay = review.feedback?.kind === "revealed" ? revealDelayMs : turn === "opponent" ? opponentDelayMs : autoDelayMs;
      const timer = setTimeout(() => {
        const nextId = review.path[review.index + 1];
        const san = tree.nodes[nextId].san as string;
        events.emit({
          type: "moveMade", san,
          by: turn === "opponent" ? "opponent" : "learner", nodeId: nextId,
        });
        setAnnouncement(`${SIDE_NAMES[turnOf(reviewNode(tree, review).position)]} played ${san}`);
        setSession((current) => current.review
          ? { ...current, review: reviewReducer(tree, current.review, { type: "advance" }) }
          : current);
      }, delay);
      return () => clearTimeout(timer);
    }
    if (turn === "done") {
      const timer = setTimeout(() => {
        const next = snapshot ? pickNext(trees, side, snapshot, now(), session, sessionSize) : null;
        if (next) setSession((current) => ({ ...current, review: next }));
        else setFinished(true);
      }, opponentDelayMs);
      return () => clearTimeout(timer);
    }
  }, [tree, review, turn, finished, opponentDelayMs, autoDelayMs, revealDelayMs, events, snapshot, trees, side, now, session, sessionSize]);

  function handleMove(move: AppliedMove): boolean {
    if (!tree || !review || !snapshot) return false;
    const next = reviewReducer(tree, review, { type: "play", san: move.san });
    if (next === review) return false;

    const gradedNow = next.graded.length > review.graded.length ? next.graded[next.graded.length - 1] : null;
    const isMistake = next.feedback?.kind === "mistake" || next.feedback?.kind === "revealed";
    const stats: SessionStats = {
      graded: session.stats.graded + (gradedNow ? 1 : 0),
      good: session.stats.good + (gradedNow?.rating === "good" ? 1 : 0),
      again: session.stats.again + (gradedNow?.rating === "again" ? 1 : 0),
      mistakes: session.stats.mistakes + (isMistake ? 1 : 0),
    };
    setSession((current) => ({
      review: next,
      gradedIds: gradedNow ? [...current.gradedIds, gradedNow.cardId] : current.gradedIds,
      stats,
    }));

    if (isMistake && next.feedback && next.feedback.kind !== "correct" && next.feedback.kind !== "alternative") {
      events.emit({ type: "mistake", played: move.san, expected: next.feedback.expected, cardId: gradedNow?.cardId });
    }
    if (gradedNow) {
      const reviewedAt = now();
      const { cards } = reconcileProgressCards(trees, side, snapshot.cards, reviewedAt);
      const card = cards[gradedNow.cardId];
      if (card) void commitProgress((store) => store.saveCards([gradeCard(card, gradedNow.rating, reviewedAt)]));
      events.emit({ type: "cardReviewed", cardId: gradedNow.cardId, rating: gradedNow.rating });
    }
    if (next.feedback?.kind === "correct") {
      events.emit({ type: "moveMade", san: move.san, by: "learner", nodeId: next.path[next.index] });
      return true;
    }
    return false;
  }

  if (finished || !tree || !review) {
    return (
      <div className="mc-panel mc-review-summary">
        {nothingDueAtStart ? (
          <>
            <h1 className="mc-panel-title">Nothing is due right now</h1>
            <p>Learn a new line, or come back when your next review is due.</p>
          </>
        ) : session.stats.graded === 0 ? (
          <>
            <h1 className="mc-panel-title">Review ended</h1>
            <p>No positions were reviewed. Your due positions are still waiting.</p>
          </>
        ) : (
          <>
            <h1 className="mc-panel-title">Review done</h1>
            <p>
              {session.stats.good} remembered, {session.stats.again} to practise again.
            </p>
          </>
        )}
        <Link href="/">Back to courses</Link>
      </div>
    );
  }

  const node = reviewNode(tree, review);
  const parent = node.parentId ? tree.nodes[node.parentId] : null;
  const lastMove = parent && node.san ? applySan(parent.fen, node.san) : null;
  const line = tree.lines.find((l) => l.id === review.lineId)!;
  const expected = reviewExpectedMove(tree, review);

  const arrows: Arrow[] = [];
  let feedback: BoardFeedback | null = null;
  const fb = review.feedback;
  if (fb?.kind === "mistake" || fb?.kind === "revealed" || fb?.kind === "alternative") {
    const played = applySan(node.fen, fb.played);
    if (played) feedback = { square: played.to, state: fb.kind === "alternative" ? "hint" : "mistake" };
  }
  if (fb?.kind === "revealed" && expected) {
    const answer = applySan(node.fen, expected);
    if (answer) arrows.push({ from: answer.from, to: answer.to, brush: "G" });
  }
  if (fb?.kind === "correct" && lastMove) feedback = { square: lastMove.to, state: "correct" };

  const panel = (
    <div className="mc-panel mc-review-panel">
      <p className="mc-muted">{tree.meta.name}</p>
      <h1 className="mc-panel-title">{line.name}</h1>
      <p className="mc-review-progress">
        {session.stats.graded} of up to {sessionSize} positions reviewed
      </p>
      <div className="mc-button-row">
        <button type="button" onClick={() => setFinished(true)}>End review</button>
      </div>
    </div>
  );

  return (
    <Workspace
      board={(
        <Board
          fen={node.fen}
          orientation={side}
          interactive={turn === "learner"}
          label={`${line.name} review board`}
          onMove={handleMove}
          lastMove={lastMove ? { from: lastMove.from, to: lastMove.to } : null}
          arrows={arrows}
          feedback={feedback}
          announcement={announcement}
        />
      )}
      dialogue={<Dialogue speaker="Course" text={coachText(tree, review)} />}
      panel={panel}
    />
  );
}
