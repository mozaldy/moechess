"use client";

import Link from "next/link";
import { useState } from "react";
import { Board } from "@/components/board/Board";
import { BranchMap } from "@/components/branch-map/BranchMap";
import { Dialogue } from "@/components/dialogue/Dialogue";
import { useWorkspace } from "@/components/workspace/Providers";
import { Workspace } from "@/components/workspace/Workspace";
import { applySan, type AppliedMove } from "@/lib/chess/position";
import { commentarySourceLabel, moveNumberLabel } from "@/lib/course/labels";
import { linesThrough, pathTo } from "@/lib/course/queries";
import type { CourseTree } from "@/lib/course/types";
import { learnedLineKey } from "@/lib/progress/types";
import { cardForNode } from "@/lib/training/cards";
import { isDue } from "@/lib/training/scheduler";

export function ExploreView({ tree }: { tree: CourseTree }) {
  const { snapshot, settings, events, now, commitProgress } = useWorkspace();
  const [openedAt] = useState(now);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const slug = tree.meta.slug;
  const side = settings.side;
  const savedId = snapshot?.explore[slug]?.lastNodeId;
  const nodeId = chosenId ?? (savedId && tree.nodes[savedId] ? savedId : tree.rootId);
  const node = tree.nodes[nodeId];
  const parent = node.parentId ? tree.nodes[node.parentId] : null;
  const lastMove = parent && node.san ? applySan(parent.fen, node.san) : null;

  const learnedLineIds = new Set(
    tree.lines.filter((line) => snapshot?.learnedLines[learnedLineKey(slug, side, line.id)]).map((line) => line.id),
  );
  const dueNodeIds = new Set(
    Object.keys(tree.nodes).filter((id) => {
      const card = cardForNode(tree, id, side);
      const state = card ? snapshot?.cards[card] : undefined;
      return Boolean(state && isDue(state, openedAt));
    }),
  );

  function select(id: string) {
    setChosenId(id);
    setNotice(null);
    const target = tree.nodes[id];
    if (target.comment) events.emit({ type: "commentaryShown", nodeId: id, commentary: target.comment });
    void commitProgress((store) => store.setExplorePosition(slug, id));
  }

  function handleMove(move: AppliedMove): boolean {
    const childId = node.children.find((id) => tree.nodes[id].san === move.san);
    if (childId) {
      events.emit({ type: "moveMade", san: move.san, by: "learner", nodeId: childId });
      select(childId);
      return true;
    }
    const options = node.children.map((id) => tree.nodes[id].san).join(", ");
    setNotice(options
      ? `${move.san} isn't in this course. From here the course plays ${options}.`
      : `${move.san} isn't in this course, and this line ends here. Go back to try another line.`);
    return false;
  }

  const path = pathTo(tree, nodeId);
  const lines = linesThrough(tree, nodeId);

  const panel = (
    <div className="mc-panel mc-explore-panel">
      <h1 className="mc-panel-title">{tree.meta.name}</h1>
      <div className="mc-button-row">
        <button type="button" onClick={() => select(tree.rootId)} disabled={!parent}>Start</button>
        <button type="button" onClick={() => parent && select(parent.id)} disabled={!parent}>Back</button>
        <button type="button" onClick={() => select(node.children[0])} disabled={node.children.length === 0}>Forward</button>
      </div>

      {path.length > 0 ? (
        <ol className="mc-move-list" aria-label="Moves played">
          {path.map((step) => (
            <li key={step.id}>
              <button type="button" aria-current={step.id === nodeId ? "step" : undefined} onClick={() => select(step.id)}>
                {moveNumberLabel(step.fen, step.san as string)}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mc-muted">Play a move on the board, or pick one of the course moves below.</p>
      )}

      <h2 className="mc-panel-heading">Next in the course</h2>
      {node.children.length > 0 ? (
        <ul className="mc-next-moves">
          {node.children.map((id) => (
            <li key={id}>
              <button type="button" onClick={() => select(id)}>
                {moveNumberLabel(tree.nodes[id].fen, tree.nodes[id].san as string)}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mc-muted">This line ends here.</p>
      )}
      {notice && <p className="mc-notice" role="alert">{notice}</p>}

      {lines.length > 0 && (
        <>
          <h2 className="mc-panel-heading">Lines through this position</h2>
          <ul className="mc-line-links">
            {lines.map((line) => (
              <li key={line.id}>
                <Link href={`/course/${slug}/learn/${line.id}`}>
                  {learnedLineIds.has(line.id) ? `Practise ${line.name} again` : `Learn ${line.name}`}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );

  return (
    <Workspace
      map={(
        <BranchMap
          tree={tree}
          currentNodeId={nodeId}
          learnedLineIds={learnedLineIds}
          dueNodeIds={dueNodeIds}
          onSelect={select}
        />
      )}
      board={(
        <Board
          fen={node.fen}
          orientation={side}
          interactive
          label={`${tree.meta.name} board`}
          onMove={handleMove}
          lastMove={lastMove ? { from: lastMove.from, to: lastMove.to } : null}
          arrows={node.arrows}
          highlights={node.highlights}
        />
      )}
      dialogue={(
        <Dialogue
          speaker="Course"
          text={node.comment?.text ?? null}
          source={node.comment ? commentarySourceLabel(node.comment.source) : undefined}
        />
      )}
      panel={panel}
    />
  );
}
