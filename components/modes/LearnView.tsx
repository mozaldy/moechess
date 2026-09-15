"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Board, type BoardFeedback } from "@/components/board/Board";
import { BranchMap } from "@/components/branch-map/BranchMap";
import { Dialogue } from "@/components/dialogue/Dialogue";
import { useWorkspace } from "@/components/workspace/Providers";
import { Workspace } from "@/components/workspace/Workspace";
import { applySan, turnOf, type AppliedMove, type Side } from "@/lib/chess/position";
import { commentarySourceLabel } from "@/lib/course/labels";
import { findLine } from "@/lib/course/queries";
import type { Arrow, CourseTree, Line } from "@/lib/course/types";
import { learnedLineKey } from "@/lib/progress/types";
import { cardsForLine, generateCards } from "@/lib/training/cards";
import {
  currentNode, expectedMove, initLearn, learnReducer, learnTurn, type LearnAction, type LearnState,
} from "@/lib/training/learn";
import { learnCards, newCardState } from "@/lib/training/scheduler";

const SIDE_NAMES: Record<Side, string> = { white: "White", black: "Black" };

export interface LearnViewProps {
  tree: CourseTree;
  lineId: string;
  opponentDelayMs?: number;
}

export function LearnView({ tree, lineId, opponentDelayMs = 500 }: LearnViewProps) {
  const { settings } = useWorkspace();
  const line = findLine(tree, lineId);
  if (!line) return <p className="mc-notice" role="alert">This line isn&apos;t in {tree.meta.name}. Pick a line from the course page.</p>;
  // Switching sides starts a fresh session for that side.
  return <LearnSession key={settings.side} tree={tree} line={line} side={settings.side} opponentDelayMs={opponentDelayMs} />;
}

interface LearnSessionProps {
  tree: CourseTree;
  line: Line;
  side: Side;
  opponentDelayMs: number;
}

function coachText(tree: CourseTree, state: LearnState): string | null {
  const feedback = state.feedback;
  if (state.phase === "completed") return "Line learned. It comes back for review tomorrow.";
  if (feedback?.kind === "mistake") {
    const reason = tree.nodes[`${feedback.nodeId === "root" ? "" : `${feedback.nodeId} `}${feedback.expected}`]?.comment?.text;
    return `Not quite. The course plays ${feedback.expected} here.${reason ? ` ${reason}` : ""} Play ${feedback.expected} to continue.`;
  }
  if (feedback?.kind === "alternative") {
    return `${feedback.played} is also a good move, but this line plays ${feedback.expected}.`;
  }
  if (feedback?.kind === "restarted") return "Good. Now play the whole line again from the start.";
  if (state.phase === "recall" && state.index === 0) return "Now play the whole line from memory.";
  return currentNode(tree, state).comment?.text ?? null;
}

function LearnSession({ tree, line, side, opponentDelayMs }: LearnSessionProps) {
  const { snapshot, events, now, commitProgress } = useWorkspace();
  const [state, setState] = useState(() => initLearn(tree, line, side));
  const [announcement, setAnnouncement] = useState<string | undefined>(undefined);
  const mistakes = useRef(0);
  const saved = useRef(false);

  const node = currentNode(tree, state);
  const turn = learnTurn(tree, state);
  const expected = expectedMove(tree, state);
  const slug = tree.meta.slug;

  function dispatch(action: LearnAction): LearnState {
    const next = learnReducer(tree, state, action);
    setState(next);
    return next;
  }

  useEffect(() => {
    if (turn !== "opponent") return;
    const timer = setTimeout(() => {
      const nextId = state.path[state.index + 1];
      const san = tree.nodes[nextId].san as string;
      events.emit({ type: "moveMade", san, by: "opponent", nodeId: nextId });
      setAnnouncement(`${SIDE_NAMES[turnOf(currentNode(tree, state).position)]} played ${san}`);
      setState((current) => learnReducer(tree, current, { type: "opponentMoved" }));
    }, opponentDelayMs);
    return () => clearTimeout(timer);
  }, [turn, state, tree, events, opponentDelayMs]);

  useEffect(() => {
    if (state.phase !== "completed" || saved.current) return;
    saved.current = true;
    const learnedAt = now();
    const specs = generateCards([tree], side);
    void commitProgress(async (store) => {
      const current = await store.load();
      const cards = cardsForLine(tree, line, side).map((id) => current.cards[id] ?? newCardState(specs.get(id)!, learnedAt));
      await store.saveCards(learnCards(cards, learnedAt));
      await store.markLineLearned(learnedLineKey(slug, side, line.id), learnedAt.toISOString());
    }).then((ok) => {
      if (!ok) return;
      events.emit({ type: "lineLearned", courseSlug: slug, lineId: line.id, side });
      events.emit({
        type: "sessionEnded", mode: "learn",
        stats: { graded: 0, good: 0, again: 0, mistakes: mistakes.current },
      });
    });
  }, [state.phase, tree, line, side, slug, now, commitProgress, events]);

  function handleMove(move: AppliedMove): boolean {
    const before = state;
    const next = dispatch({ type: "play", san: move.san });
    if (next.feedback?.kind === "mistake" && next !== before) {
      mistakes.current += 1;
      events.emit({ type: "mistake", played: move.san, expected: next.feedback.expected });
      return false;
    }
    if (next.feedback?.kind === "alternative") return false;
    const nodeId = before.path[before.index + 1];
    events.emit({ type: "moveMade", san: move.san, by: "learner", nodeId });
    return true;
  }

  const parent = node.parentId ? tree.nodes[node.parentId] : null;
  const lastMove = parent && node.san ? applySan(parent.fen, node.san) : null;
  const expectedMoveSquares = expected && turn === "learner" ? applySan(node.fen, expected) : null;

  const arrows: Arrow[] = [...(node.arrows ?? [])];
  let feedback: BoardFeedback | null = null;
  if (expectedMoveSquares && (state.phase === "guided" || state.feedback?.kind === "mistake")) {
    arrows.push({ from: expectedMoveSquares.from, to: expectedMoveSquares.to, brush: "G" });
  }
  if (state.feedback?.kind === "mistake" || state.feedback?.kind === "alternative") {
    const played = applySan(node.fen, state.feedback.played);
    if (played) feedback = { square: played.to, state: state.feedback.kind === "mistake" ? "mistake" : "hint" };
  } else if (state.feedback?.kind === "correct" && lastMove) {
    feedback = { square: lastMove.to, state: "correct" };
  }

  const learnerMoves = cardsForLine(tree, line, side).length;
  const learnerMovesDone = state.path.slice(0, state.index).filter((id) => tree.nodes[id].position.split(" ")[1] === (side === "white" ? "w" : "b")).length;
  const learnedLineIds = new Set(
    tree.lines.filter((l) => snapshot?.learnedLines[learnedLineKey(slug, side, l.id)]).map((l) => l.id),
  );
  if (state.phase === "completed") learnedLineIds.add(line.id);

  const text = coachText(tree, state);
  const showsNodeComment = text !== null && text === node.comment?.text;

  const panel = (
    <div className="mc-panel mc-learn-panel">
      <p className="mc-muted">{tree.meta.name}</p>
      <h1 className="mc-panel-title">{line.name}</h1>
      <p className="mc-learn-phase" data-phase={state.phase}>
        {state.phase === "guided" && "Step 1 of 2: follow the highlighted moves"}
        {state.phase === "recall" && "Step 2 of 2: play the line from memory"}
        {state.phase === "completed" && "Learned"}
      </p>
      {state.phase !== "completed" && (
        <p className="mc-learn-progress">
          Your move {Math.min(learnerMovesDone + 1, learnerMoves)} of {learnerMoves}
        </p>
      )}
      <div className="mc-button-row">
        {state.phase === "completed" ? (
          <Link href={`/course/${slug}`}>Choose another line</Link>
        ) : (
          <button type="button" onClick={() => dispatch({ type: "restart" })}>Start over</button>
        )}
      </div>
    </div>
  );

  return (
    <Workspace
      map={(
        <BranchMap
          tree={tree}
          currentNodeId={node.id}
          learnedLineIds={learnedLineIds}
          dueNodeIds={new Set()}
          onSelect={() => {}}
          interactive={false}
          stampLineId={state.phase === "completed" ? line.id : null}
        />
      )}
      board={(
        <Board
          fen={node.fen}
          orientation={side}
          interactive={turn === "learner"}
          label={`${line.name} board`}
          onMove={handleMove}
          lastMove={lastMove ? { from: lastMove.from, to: lastMove.to } : null}
          arrows={arrows}
          highlights={node.highlights}
          feedback={feedback}
          announcement={announcement}
        />
      )}
      dialogue={(
        <Dialogue
          speaker="Course"
          text={text}
          source={showsNodeComment && node.comment ? commentarySourceLabel(node.comment.source) : undefined}
        />
      )}
      panel={panel}
    />
  );
}
