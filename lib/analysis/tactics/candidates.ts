import { Chess, type Move, type PieceSymbol, type Square } from "chess.js";
import type { GameHistory, Side } from "@/lib/analysis/engine/types";
import { playUci } from "./board-internals";
import { attackedTargets } from "./geometry";
import type { Candidate } from "./types";

const HANGING_TARGETS = new Set<PieceSymbol>(["n", "b", "r", "q"]);

function colorFor(side: Side): "w" | "b" {
  return side === "white" ? "w" : "b";
}

function moveDescriptor(uci: string): { from: Square; to: Square; promotion?: PieceSymbol } {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) {
    throw new Error(`Invalid UCI move: ${uci}`);
  }
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    ...(uci[4] ? { promotion: uci[4] as PieceSymbol } : {}),
  };
}

export function toUci(move: Move): string {
  return move.from + move.to + (move.promotion ?? "");
}

export function replayHistory(history: GameHistory): Chess {
  const board = new Chess(history.initialFen);
  for (const move of history.moves) {
    moveDescriptor(move); // rejects malformed UCI with the same error as before
    playUci(board, move);
  }
  return board;
}

export function mateMoves(history: GameHistory): string[] {
  const board = replayHistory(history);
  if (board.isGameOver()) return [];

  const mates: string[] = [];
  for (const move of board.moves({ verbose: true })) {
    board.move(move);
    if (board.isCheckmate()) mates.push(toUci(move));
    board.undo();
  }
  return mates.sort();
}

function candidate(
  history: GameHistory,
  played: string,
  side: Side,
  direction: Candidate["direction"],
  theme: Candidate["theme"],
  tactic: string,
  targets: string[],
): Candidate {
  return {
    theme,
    direction,
    history,
    side,
    played,
    tactic,
    targets,
    tacticalPly: direction === "missed" ? 0 : 1,
  };
}

function enumerateAt(
  board: Chess,
  history: GameHistory,
  played: string,
  side: Side,
  direction: Candidate["direction"],
): Candidate[] {
  if (board.isGameOver()) return [];

  const results: Candidate[] = [];
  for (const move of board.moves({ verbose: true })) {
    const tactic = toUci(move);
    if (direction === "missed" && tactic === played) continue;

    if (move.captured && HANGING_TARGETS.has(move.captured)) {
      results.push(candidate(history, played, side, direction, "hanging", tactic, [move.to]));
    }

    board.move(move);
    const targets = attackedTargets(board, move.to).filter((targetSquare) => {
      const target = board.get(targetSquare as Square);
      return target?.type !== "k" || board.isCheck();
    });
    board.undo();

    if (targets.length >= 2) {
      results.push(candidate(history, played, side, direction, "fork", tactic, targets));
    }
  }
  return results;
}

export function findCandidates(history: GameHistory, played: string, side: Side): Candidate[] {
  const board = replayHistory(history);
  if (board.turn() !== colorFor(side)) {
    throw new Error(`Candidate side ${side} does not match the position's side to move`);
  }
  if (board.isGameOver()) return [];

  const candidates = enumerateAt(board, history, played, side, "missed");
  for (const mate of mateMoves(history)) {
    if (mate !== played) {
      candidates.push(candidate(history, played, side, "missed", "mate-one", mate, []));
    }
  }

  board.move(moveDescriptor(played));
  if (!board.isGameOver()) {
    candidates.push(...enumerateAt(board, history, played, side, "allowed"));
    const afterHistory = { initialFen: history.initialFen, moves: [...history.moves, played] };
    for (const mate of mateMoves(afterHistory)) {
      candidates.push(candidate(history, played, side, "allowed", "mate-one", mate, []));
    }
  }

  const unique = new Map<string, Candidate>();
  for (const item of candidates) {
    const key = [
      item.theme,
      item.direction,
      item.tactic,
      [...item.targets].sort().join(","),
    ].join(":");
    unique.set(key, item);
  }
  return [...unique.values()];
}
