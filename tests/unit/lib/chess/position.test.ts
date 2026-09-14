import { describe, expect, test } from "vitest";
import {
  START_FEN, START_KEY, applySan, legalTargets, moveFromSquares, needsPromotion,
  piecesOf, positionKey, sanEquals, turnOf,
} from "@/lib/chess/position";

describe("positionKey", () => {
  test("drops halfmove and fullmove counters", () => {
    expect(positionKey("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"))
      .toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -");
    expect(START_KEY).toBe(positionKey(START_FEN));
  });

  test("transposed move orders give the same key", () => {
    const a = ["e4", "e5", "Nf3", "Nc6", "Bc4"].reduce((f, m) => applySan(f, m)!.fenAfter, START_FEN);
    const b = ["e4", "e5", "Bc4", "Nc6", "Nf3"].reduce((f, m) => applySan(f, m)!.fenAfter, START_FEN);
    expect(positionKey(a)).toBe(positionKey(b));
  });
});

describe("applySan", () => {
  test("returns canonical SAN and squares", () => {
    const m = applySan(START_FEN, "e4")!;
    expect(m).toMatchObject({ san: "e4", from: "e2", to: "e4", captured: false });
    expect(turnOf(m.keyAfter)).toBe("black");
  });

  test("returns null for an illegal move instead of throwing", () => {
    expect(applySan(START_FEN, "e5")).toBeNull();
    expect(applySan(START_FEN, "nonsense")).toBeNull();
  });

  test("accepts SAN without a check suffix and zero-castling", () => {
    const fen = "rnb1kbnr/pppp1ppp/8/4p3/4P3/5Q2/PPPP1PPP/RNB1KBNR w KQkq - 0 1";
    expect(applySan(fen, "Qxf7")!.san).toBe("Qxf7+");
    expect(sanEquals(fen, "Qxf7", "Qxf7+")).toBe(true);
    expect(applySan("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "0-0")!.san).toBe("O-O");
  });
});

describe("board helpers", () => {
  test("moveFromSquares and legalTargets", () => {
    expect(moveFromSquares(START_FEN, "g1", "f3")!.san).toBe("Nf3");
    expect(moveFromSquares(START_FEN, "g1", "g3")).toBeNull();
    expect(legalTargets(START_FEN, "b1").sort()).toEqual(["a3", "c3"]);
    expect(legalTargets(START_FEN, "e4")).toEqual([]);
  });

  test("promotion detection and application", () => {
    const fen = "4k3/1P6/8/8/8/8/8/4K3 w - - 0 1";
    expect(needsPromotion(fen, "b7", "b8")).toBe(true);
    expect(needsPromotion(START_FEN, "e2", "e4")).toBe(false);
    expect(moveFromSquares(fen, "b7", "b8", "q")!.san).toBe("b8=Q+");
  });

  test("piecesOf lists 32 pieces at the start", () => {
    const pieces = piecesOf(START_FEN);
    expect(pieces).toHaveLength(32);
    expect(pieces).toContainEqual({ square: "g1", code: "wN" });
    expect(pieces).toContainEqual({ square: "e8", code: "bK" });
  });
});
