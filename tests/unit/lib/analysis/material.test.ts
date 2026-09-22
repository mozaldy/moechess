import { Chess } from "chess.js";
import { describe, expect, test, vi } from "vitest";
import { certifyGain, materialBalance } from "@/lib/analysis/tactics/material";

const liveSignal = () => new AbortController().signal;

describe("materialBalance", () => {
  test("includes the sacrificed attacker in material accounting", () => {
    const before = new Chess("r5k1/8/8/8/8/8/8/Q5K1 w - - 0 1");
    const original = materialBalance(before, "white");
    before.move("Qxa8+");
    expect(materialBalance(before, "white") - original).toBe(5);

    const defended = new Chess("r5k1/1b6/8/8/8/8/8/Q5K1 w - - 0 1");
    const defendedOriginal = materialBalance(defended, "white");
    defended.move("Qxa8+");
    defended.move("Bxa8");
    expect(materialBalance(defended, "white") - defendedOriginal).toBe(-4);
  });

  test("counts promotion material in the resulting balance", () => {
    const board = new Chess("1q5k/P7/8/8/8/8/8/7K w - - 0 1");
    const original = materialBalance(board, "white");
    board.move("a7b8q");
    expect(materialBalance(board, "white") - original).toBe(17);
  });
});

describe("certifyGain", () => {
  test("certifies an undefended capture with a legal witness", async () => {
    const result = await certifyGain(
      { initialFen: "q5k1/8/8/8/8/8/8/R5K1 w - - 0 1", moves: [] },
      "a1a8",
      "white",
      liveSignal(),
    );
    expect(result).toMatchObject({ kind: "gain", gain: 9 });
    expect(result.kind === "gain" && result.line[0]).toBe("a1a8");
  });

  test("rejects an apparent gain when every line includes a recapture", async () => {
    const result = await certifyGain(
      { initialFen: "r5k1/1b6/8/8/8/8/8/Q5K1 w - - 0 1", moves: [] },
      "a1a8",
      "white",
      liveSignal(),
    );
    expect(result.kind).toBe("rejected");
  });

  test("lets the defender erase the gain with a capture elsewhere", async () => {
    const result = await certifyGain(
      { initialFen: "q7/6b1/6k1/8/8/8/1Q6/R5K1 w - - 0 1", moves: [] },
      "a1a8",
      "white",
      liveSignal(),
    );
    expect(result.kind).not.toBe("gain");
  });

  test("does not certify material when the capture permits immediate mate", async () => {
    const result = await certifyGain(
      { initialFen: "1r6/8/8/8/8/5kq1/1R6/7K w - - 0 1", moves: [] },
      "b2b8",
      "white",
      liveSignal(),
    );
    expect(result.kind).toBe("rejected");
  });

  test("certifies a fork only after every king defense still loses material", async () => {
    const result = await certifyGain(
      { initialFen: "8/4k3/1q6/8/8/2N5/8/4K3 w - - 0 1", moves: [] },
      "c3d5",
      "white",
      liveSignal(),
    );
    expect(result).toMatchObject({ kind: "gain", gain: 9 });
    expect(result.kind === "gain" && result.line[0] === "c3d5" && result.line.some((move) => move.endsWith("b6"))).toBe(true);
  });

  test("rethrows cancellation rather than returning an exclusion", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(certifyGain(
      { initialFen: "q5k1/8/8/8/8/8/8/R5K1 w - - 0 1", moves: [] },
      "a1a8",
      "white",
      controller.signal,
    )).rejects.toMatchObject({ name: "AbortError" });
  });

  test("stops before evaluating a position beyond the configured ceiling", async () => {
    const boardCalls = vi.spyOn(Chess.prototype, "board");
    try {
      const result = await certifyGain(
        { initialFen: "8/4k3/1q6/8/8/2N5/8/4K3 w - - 0 1", moves: [] },
        "c3d5",
        "white",
        liveSignal(),
        { maxVisited: 2 },
      );
      expect(result).toMatchObject({ kind: "inconclusive" });
      expect(boardCalls.mock.calls.length).toBeLessThanOrEqual(3);
    } finally {
      boardCalls.mockRestore();
    }
  });
});
