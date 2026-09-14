"use client";

import { useState } from "react";
import { layoutBranchMap, stackLabels, type MapNode } from "@/lib/branch-map/layout";
import { moveNumberLabel } from "@/lib/course/labels";
import type { CourseTree } from "@/lib/course/types";

export interface BranchMapProps {
  tree: CourseTree;
  currentNodeId: string;
  learnedLineIds: ReadonlySet<string>;
  dueNodeIds: ReadonlySet<string>;
  onSelect: (nodeId: string) => void;
  stampLineId?: string | null;
  collapseDepth?: number;
}

const LANE = 18;
const ROW = 22;
const PAD = 14;
const LABEL_SPACE = 200;
const LABEL_GAP = 16;

function moveLabel(tree: CourseTree, node: MapNode): string {
  return node.san === null ? "Start" : moveNumberLabel(tree.nodes[node.nodeId].fen, node.san);
}

export function BranchMap({
  tree, currentNodeId, learnedLineIds, dueNodeIds, onSelect, stampLineId = null, collapseDepth,
}: BranchMapProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const layout = layoutBranchMap(tree, { currentNodeId, expanded, collapseDepth });

  const px = (lane: number) => PAD + lane * LANE;
  const py = (depth: number) => PAD + depth * ROW;
  const labelled = layout.nodes.filter((node) => node.label);
  const labelX = px(layout.lanes - 1) + LANE;
  const labelYs = stackLabels(labelled.map((node) => py(node.y)), LABEL_GAP);
  const width = labelX + LABEL_SPACE;
  const height = Math.max(py(layout.depth), ...labelYs) + PAD;
  const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));
  const isLearned = (lineIds: string[]) => lineIds.some((id) => learnedLineIds.has(id));
  const stamped = stampLineId ? tree.lines.find((line) => line.id === stampLineId) : undefined;
  const stampIndex = stamped ? labelled.findIndex((node) => node.id === stamped.nodeIds.at(-1)) : -1;

  function stationState(node: MapNode): string {
    if (node.nodeId === currentNodeId && node.kind === "move") return "current";
    if (dueNodeIds.has(node.nodeId) && node.kind === "move") return "due";
    return isLearned(node.lineIds) ? "learned" : "unlearned";
  }

  // Transit-map stops: the start, branch points, line ends, the current position and due
  // positions. Every other ply is drawn as a small pass-through dot.
  function stationRole(node: MapNode): "stop" | "pass" {
    if (node.kind === "collapsed" || node.san === null || node.label) return "stop";
    if (tree.nodes[node.nodeId].children.length !== 1) return "stop";
    return node.nodeId === currentNodeId || dueNodeIds.has(node.nodeId) ? "stop" : "pass";
  }

  function describe(node: MapNode): string {
    if (node.kind === "collapsed") {
      return `Show ${node.hiddenCount} more ${node.hiddenCount === 1 ? "line" : "lines"} after ${moveLabel(tree, { ...node, san: tree.nodes[node.nodeId].san })}`;
    }
    const parts = [moveLabel(tree, node)];
    if (node.label) parts.push(node.label);
    if (dueNodeIds.has(node.nodeId)) parts.push("due for review");
    return parts.join(", ");
  }

  return (
    <nav className="mc-branch-map" aria-label={`${tree.meta.name} lines`}>
      <div className="mc-branch-map-canvas" style={{ width, height }}>
        <svg className="mc-branch-map-svg" width={width} height={height} aria-hidden="true">
          {layout.edges.map((edge) => {
            const from = nodeById.get(edge.from)!;
            const to = nodeById.get(edge.to)!;
            const [x1, y1, x2, y2] = [px(from.x), py(from.y), px(to.x), py(to.y)];
            const mid = (y1 + y2) / 2;
            const d = x1 === x2 ? `M${x1} ${y1} L${x2} ${y2}` : `M${x1} ${y1} C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`;
            return (
              <path
                key={`${edge.from}->${edge.to}`}
                className="mc-branch"
                data-state={isLearned(edge.lineIds) ? "learned" : "unlearned"}
                d={d}
              />
            );
          })}
          {layout.nodes.map((node) => (
            <circle
              key={node.id}
              className="mc-station"
              data-kind={node.kind}
              data-role={stationRole(node)}
              data-state={stationState(node)}
              cx={px(node.x)}
              cy={py(node.y)}
              r={stationRole(node) === "pass" ? 2.5 : node.kind === "collapsed" ? 4 : 5}
            />
          ))}
          {labelled.map((node, i) => (
            <g key={`label-${node.id}`}>
              <path
                className="mc-branch-leader"
                d={`M${px(node.x)} ${py(node.y)} L${labelX - 6} ${labelYs[i]}`}
              />
              <text
                className="mc-branch-label"
                data-state={isLearned(node.lineIds) ? "learned" : "unlearned"}
                x={labelX}
                y={labelYs[i]}
                dominantBaseline="middle"
              >
                {node.label}
              </text>
            </g>
          ))}
        </svg>

        {layout.nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            className="mc-branch-station-button"
            data-kind={node.kind}
            style={{ left: px(node.x), top: py(node.y) }}
            aria-label={describe(node)}
            aria-current={node.nodeId === currentNodeId && node.kind === "move" ? "step" : undefined}
            onClick={() => {
              if (node.kind === "collapsed") setExpanded((current) => new Set([...current, node.nodeId]));
              else onSelect(node.nodeId);
            }}
          />
        ))}

        {stampIndex >= 0 && (
          <p
            key={stampLineId}
            className="mc-learned-stamp"
            style={{ left: labelX, top: labelYs[stampIndex] }}
            role="status"
          >
            Learned!
          </p>
        )}
      </div>
    </nav>
  );
}
