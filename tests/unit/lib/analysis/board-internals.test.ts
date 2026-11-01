import { Chess } from "chess.js";
import { expect, test } from "vitest";
import { checkSuffix, legalMoves, play, playUci, undo } from "@/lib/analysis/tactics/board-internals";
import { toUci } from "@/lib/analysis/tactics/candidates";

const POSITIONS = [
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
  "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
  "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
  "rnbqkb1r/pppp1ppp/5n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
  "rnb1kbnr/pppp1ppp/8/4p3/5PPq/8/PPPPP2P/RNBQKBNR w KQkq - 1 3",
  "1q5k/P7/8/8/8/8/8/7K w - - 0 1",
  "rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3",
];

function publicView(board: Chess) {
  return board.moves({ verbose: true }).map((move) => ({
    uci: toUci(move),
    to: move.to,
    captured: move.captured,
    suffix: move.san.endsWith("#") ? "#" : move.san.endsWith("+") ? "+" : "",
  }));
}

function internalView(board: Chess) {
  return legalMoves(board).map((move) => ({
    uci: move.uci,
    to: move.to,
    captured: move.captured,
    suffix: checkSuffix(board, move),
  }));
}

test("matches public chess.js moves, order and check suffixes", () => {
  for (const fen of POSITIONS) {
    const board = new Chess(fen);
    expect(internalView(board)).toEqual(publicView(board));
    for (const move of legalMoves(board)) {
      play(board, move);
      expect(internalView(board)).toEqual(publicView(board));
      undo(board);
    }
    expect(board.fen()).toBe(fen);
  }
});

test("keeps the repetition bookkeeping of move() and undo()", () => {
  const shuffle = ["g1f3", "g8f6", "f3g1", "f6g8"];
  const fast = new Chess();
  const reference = new Chess();
  for (const uci of [...shuffle, ...shuffle]) {
    const move = legalMoves(fast).find((candidate) => candidate.uci === uci)!;
    play(fast, move);
    reference.move({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
    expect(fast.fen()).toBe(reference.fen());
    expect(fast.isThreefoldRepetition()).toBe(reference.isThreefoldRepetition());
  }
  expect(fast.isThreefoldRepetition()).toBe(true);
  for (let index = 0; index < shuffle.length; index += 1) {
    undo(fast);
    reference.undo();
    expect(fast.fen()).toBe(reference.fen());
    expect(fast.isThreefoldRepetition()).toBe(reference.isThreefoldRepetition());
  }
});

test("plays UCI moves like board.move with a move object", () => {
  for (const fen of POSITIONS) {
    for (const uci of legalMoves(new Chess(fen)).map((move) => move.uci)) {
      const fast = new Chess(fen);
      const reference = new Chess(fen);
      playUci(fast, uci);
      reference.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      expect(fast.fen()).toBe(reference.fen());
      expect(fast.history()).toEqual(reference.history());
    }
  }
  expect(() => playUci(new Chess(), "e2e5")).toThrow("Invalid move");
  const promotion = new Chess("1q5k/P7/8/8/8/8/8/7K w - - 0 1");
  expect(() => playUci(promotion, "a7a8")).toThrow("Invalid move");
  playUci(promotion, "a7b8n");
  expect(promotion.fen()).toBe("1N5k/8/8/8/8/8/8/7K b - - 0 1");
});
