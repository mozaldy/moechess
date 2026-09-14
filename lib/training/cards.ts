import { sideLetter, turnOf, type PositionKey, type Side } from "@/lib/chess/position";
import type { CourseTree, Line } from "@/lib/course/types";

export type CardId = `${"w" | "b"}:${PositionKey}`;

export interface CardSpec {
  id: CardId;
  side: Side;
  position: PositionKey;
  fen: string;
  expected: string[];
  nodeIds: string[];
  courseSlugs: string[];
}

export function cardId(side: Side, position: PositionKey): CardId {
  return `${sideLetter(side)}:${position}`;
}

export function generateCards(trees: CourseTree[], side: Side): Map<CardId, CardSpec> {
  const cards = new Map<CardId, CardSpec>();
  for (const tree of trees) {
    for (const node of Object.values(tree.nodes)) {
      if (node.children.length === 0 || turnOf(node.position) !== side) continue;
      const id = cardId(side, node.position);
      const sans = node.children.map((childId) => tree.nodes[childId].san as string);
      const existing = cards.get(id);
      if (!existing) {
        cards.set(id, {
          id, side, position: node.position, fen: node.fen,
          expected: [...sans], nodeIds: [node.id], courseSlugs: [tree.meta.slug],
        });
        continue;
      }
      for (const san of sans) if (!existing.expected.includes(san)) existing.expected.push(san);
      existing.nodeIds.push(node.id);
      if (!existing.courseSlugs.includes(tree.meta.slug)) existing.courseSlugs.push(tree.meta.slug);
    }
  }
  return cards;
}

export function cardForNode(tree: CourseTree, nodeId: string, side: Side): CardId | null {
  const node = tree.nodes[nodeId];
  if (!node || node.children.length === 0 || turnOf(node.position) !== side) return null;
  return cardId(side, node.position);
}

export function cardsForLine(tree: CourseTree, line: Line, side: Side): CardId[] {
  const path = [tree.rootId, ...line.nodeIds];
  const ids: CardId[] = [];
  for (let i = 0; i < path.length - 1; i += 1) {
    const node = tree.nodes[path[i]];
    if (turnOf(node.position) !== side) continue;
    const id = cardId(side, node.position);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
