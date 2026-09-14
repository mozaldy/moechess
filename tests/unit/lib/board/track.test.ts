import { describe, expect, test } from "vitest";
import { START_FEN, applySan, piecesOf } from "@/lib/chess/position";
import { squareAt, squareColor, squareXY, trackPieces } from "@/lib/board/track";

const play = (...sans: string[]) => sans.reduce((fen, san) => applySan(fen, san)!.fenAfter, START_FEN);

describe("coordinates", () => {
  test("squareXY and squareAt are inverses for both orientations", () => {
    expect(squareXY("a1", "white")).toEqual({ x: 0, y: 7 });
    expect(squareXY("a1", "black")).toEqual({ x: 7, y: 0 });
    for (const orientation of ["white", "black"] as const) {
      expect(squareAt(squareXY("e4", orientation).x, squareXY("e4", orientation).y, orientation)).toBe("e4");
    }
  });

  test("square colours", () => {
    expect(squareColor("a1")).toBe("dark");
    expect(squareColor("h1")).toBe("light");
    expect(squareColor("e4")).toBe("light");
  });
});

describe("trackPieces", () => {
  test("gives every piece a unique id", () => {
    const pieces = trackPieces([], piecesOf(START_FEN));
    expect(new Set(pieces.map((p) => p.id)).size).toBe(32);
  });

  test("a moved piece keeps its id", () => {
    const start = trackPieces([], piecesOf(START_FEN));
    const after = trackPieces(start, piecesOf(play("e4")));
    const pawn = start.find((p) => p.square === "e2")!;
    expect(after.find((p) => p.square === "e4")!.id).toBe(pawn.id);
    expect(after.find((p) => p.square === "g1")).toBe(start.find((p) => p.square === "g1"));
  });

  test("captured pieces disappear and castling moves both king and rook", () => {
    let tracked = trackPieces([], piecesOf(START_FEN));
    const rook = tracked.find((p) => p.square === "h1")!;
    const king = tracked.find((p) => p.square === "e1")!;
    for (const fen of [play("e4", "d5"), play("e4", "d5", "exd5")]) tracked = trackPieces(tracked, piecesOf(fen));
    expect(tracked).toHaveLength(31);

    let castled = trackPieces([], piecesOf(START_FEN));
    for (const fen of [play("e4", "e5"), play("e4", "e5", "Nf3", "Nc6"), play("e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"), play("e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O")]) {
      castled = trackPieces(castled, piecesOf(fen));
    }
    expect(castled.find((p) => p.square === "g1")!.id).toBe(king.id);
    expect(castled.find((p) => p.square === "f1")!.id).toBe(rook.id);
  });

  test("a promoted piece gets a new id", () => {
    const before = trackPieces([], piecesOf("4k3/1P6/8/8/8/8/8/4K3 w - - 0 1"));
    const after = trackPieces(before, piecesOf(applySan("4k3/1P6/8/8/8/8/8/4K3 w - - 0 1", "b8=Q")!.fenAfter));
    const queen = after.find((p) => p.code === "wQ")!;
    expect(before.some((p) => p.id === queen.id)).toBe(false);
  });
});
