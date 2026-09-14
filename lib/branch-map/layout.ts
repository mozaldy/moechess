import type { CourseTree } from "@/lib/course/types";

export interface MapNode {
  id: string; // course node id, or `${parentId}::more` for a collapsed stub
  nodeId: string; // the course node it stands for (the parent for stubs)
  kind: "move" | "collapsed";
  x: number; // lane
  y: number; // ply depth
  san: string | null;
  lineIds: string[];
  label?: string; // line names ending at this node
  hiddenCount?: number; // stubs only: lines hidden under this branch
}

export interface MapEdge {
  from: string;
  to: string;
  lineIds: string[];
}

export interface MapLayout {
  nodes: MapNode[];
  edges: MapEdge[];
  lanes: number;
  depth: number;
}

export interface LayoutOptions {
  currentNodeId?: string;
  expanded?: ReadonlySet<string>;
  collapseDepth?: number;
}

export const DEFAULT_COLLAPSE_DEPTH = 32;

// Pushes label positions down so no two are closer than `gap`, keeping input order.
export function stackLabels(positions: number[], gap: number): number[] {
  const order = positions.map((position, index) => ({ position, index })).sort((a, b) => a.position - b.position);
  const result = new Array<number>(positions.length);
  let previous = -Infinity;
  for (const { position, index } of order) {
    previous = Math.max(position, previous + gap);
    result[index] = previous;
  }
  return result;
}

// Vertical transit map: moves run top to bottom, each branch takes its own lane.
// Past `collapseDepth`, a branch folds into one stub unless it is on the current
// path or the learner opened it.
export function layoutBranchMap(tree: CourseTree, options: LayoutOptions = {}): MapLayout {
  const collapseDepth = options.collapseDepth ?? DEFAULT_COLLAPSE_DEPTH;
  const expanded = options.expanded ?? new Set<string>();

  const linesByNode = new Map<string, string[]>([[tree.rootId, tree.lines.map((l) => l.id)]]);
  const labels = new Map<string, string[]>();
  for (const line of tree.lines) {
    for (const id of line.nodeIds) linesByNode.set(id, [...(linesByNode.get(id) ?? []), line.id]);
    const last = line.nodeIds.at(-1);
    if (last) labels.set(last, [...(labels.get(last) ?? []), line.name]);
  }

  const onPath = new Set<string>();
  for (let id: string | null | undefined = options.currentNodeId; id; id = tree.nodes[id]?.parentId) onPath.add(id);

  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  let lanes = 0;
  let depth = 0;

  const place = (id: string, y: number): number => {
    const node = tree.nodes[id];
    const open = onPath.has(id) || expanded.has(id);
    const visibleChildren = node.children.filter(() => y + 1 <= collapseDepth || open);
    const hiddenChildren = node.children.filter((child) => !visibleChildren.includes(child));

    let lane = -1;
    for (const child of visibleChildren) {
      const childLane = place(child, y + 1);
      if (lane === -1) lane = childLane;
      edges.push({ from: id, to: child, lineIds: linesByNode.get(child) ?? [] });
    }

    if (hiddenChildren.length > 0) {
      const hiddenLines = [...new Set(hiddenChildren.flatMap((child) => linesByNode.get(child) ?? []))];
      const stubLane = lanes++;
      if (lane === -1) lane = stubLane;
      const stubId = `${id}::more`;
      nodes.push({
        id: stubId, nodeId: id, kind: "collapsed", x: stubLane, y: y + 1, san: null,
        lineIds: hiddenLines, hiddenCount: hiddenLines.length,
      });
      edges.push({ from: id, to: stubId, lineIds: hiddenLines });
      depth = Math.max(depth, y + 1);
    }

    if (lane === -1) lane = lanes++;
    const label = labels.get(id)?.join(" / ");
    nodes.push({
      id, nodeId: id, kind: "move", x: lane, y, san: node.san,
      lineIds: linesByNode.get(id) ?? [], ...(label ? { label } : {}),
    });
    depth = Math.max(depth, y);
    return lane;
  };

  place(tree.rootId, 0);
  nodes.sort((a, b) => a.y - b.y || a.x - b.x);
  return { nodes, edges, lanes, depth };
}
