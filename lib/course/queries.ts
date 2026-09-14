import type { CourseNode, CourseTree, Line } from "./types";

export function pathTo(tree: CourseTree, nodeId: string): CourseNode[] {
  const path: CourseNode[] = [];
  let node: CourseNode | undefined = tree.nodes[nodeId];
  while (node && node.parentId !== null) {
    path.unshift(node);
    node = tree.nodes[node.parentId];
  }
  return path;
}

export function findLine(tree: CourseTree, lineId: string): Line | undefined {
  return tree.lines.find((line) => line.id === lineId);
}

export function linesThrough(tree: CourseTree, nodeId: string): Line[] {
  return tree.lines.filter((line) => line.nodeIds.includes(nodeId));
}
