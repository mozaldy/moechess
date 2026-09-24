import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { Board } from "@/components/board/Board";
import { START_FEN, type AppliedMove } from "@/lib/chess/position";

const square = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name},`) });

function setup(props: Partial<Parameters<typeof Board>[0]> = {}) {
  const onMove = vi.fn<(move: AppliedMove) => boolean>(() => true);
  const utils = render(
    <Board fen={START_FEN} orientation="white" interactive label="Training board" onMove={onMove} {...props} />,
  );
  return { onMove, ...utils };
}

describe("Board rendering", () => {
  test("renders 64 labelled squares and 32 pieces with stable hooks", () => {
    const { container } = setup();
    expect(screen.getAllByRole("button", { name: /^[a-h][1-8], / })).toHaveLength(64);
    expect(square("e2")).toHaveAccessibleName("e2, white pawn");
    expect(square("e4")).toHaveAccessibleName("e4, empty");
    expect(container.querySelectorAll(".mc-piece")).toHaveLength(32);
    expect(container.querySelector('.mc-piece[data-piece="wN"][data-square="g1"]')).not.toBeNull();
    expect(container.querySelectorAll('.mc-square[data-color="dark"]')).toHaveLength(32);
    expect(container.querySelector(".mc-board")).toHaveAttribute("data-orientation", "white");
  });

  test("black orientation puts h1 first", () => {
    setup({ orientation: "black" });
    expect(screen.getAllByRole("button", { name: /^[a-h][1-8], / })[0]).toHaveAccessibleName("h1, white rook");
  });

  test("arrows, highlights and feedback render with data hooks", () => {
    const { container } = setup({
      arrows: [{ from: "f1", to: "b5", brush: "G" }],
      highlights: [{ square: "e5", brush: "R" }],
      feedback: { square: "e4", state: "mistake" },
    });
    expect(container.querySelector('.mc-arrow[data-brush="G"]')).not.toBeNull();
    expect(container.querySelector('.mc-highlight[data-brush="R"]')).not.toBeNull();
    expect(container.querySelector('.mc-feedback[data-state="mistake"]')).not.toBeNull();
  });

  test("two brushes on one square render without duplicate keys", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { container } = setup({ highlights: [{ square: "e5", brush: "R" }, { square: "e5", brush: "G" }] });
      expect(container.querySelectorAll('.mc-highlight')).toHaveLength(2);
      expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("Board input", () => {
  test("hides move entry for replay while retaining the normal default", () => {
    const { rerender } = setup({ interactive: false, showMoveInput: false });
    expect(screen.queryByRole("textbox", { name: "Type a move" })).toBeNull();
    rerender(<Board fen={START_FEN} orientation="white" interactive={false} label="Training board" />);
    expect(screen.getByRole("textbox", { name: "Type a move" })).toBeDisabled();
  });
  test("click a piece, then a target square, to move", () => {
    const { onMove, container } = setup();
    fireEvent.click(square("e2"));
    expect(square("e2")).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelectorAll(".mc-target")).toHaveLength(2);
    fireEvent.click(square("e4"));
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ san: "e4", from: "e2", to: "e4" }));
  });

  test("the opponent's pieces can't be selected", () => {
    const { onMove } = setup();
    fireEvent.click(square("e7"));
    expect(square("e7")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(square("e5"));
    expect(onMove).not.toHaveBeenCalled();
  });

  test("a non-interactive board ignores input", () => {
    const { onMove } = setup({ interactive: false });
    fireEvent.click(square("e2"));
    fireEvent.click(square("e4"));
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Type a move" })).toBeDisabled();
  });

  test("drag from one square to another", () => {
    const { onMove } = setup();
    fireEvent.pointerDown(square("g1"));
    fireEvent.pointerUp(square("f3"));
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ san: "Nf3" }));
  });

  test("type a move in SAN", async () => {
    const { onMove } = setup();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Type a move" }), "Nf3{Enter}");
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ san: "Nf3" }));
    expect(screen.getByRole("textbox", { name: "Type a move" })).toHaveValue("");
  });

  test("typing an illegal move explains what to fix", async () => {
    const { onMove } = setup();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Type a move" }), "Ke2{Enter}");
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Ke2 isn't a legal move here. Check the piece letter and the square.");
  });

  test("arrow keys move focus across squares in board orientation", async () => {
    setup();
    const user = userEvent.setup();
    square("e2").focus();
    await user.keyboard("{ArrowUp}");
    expect(square("e3")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(square("f3")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(square("f3")).toHaveAttribute("tabindex", "0");
  });

  test("promotion moves promote to a queen", () => {
    const { onMove } = setup({ fen: "4k3/1P6/8/8/8/8/8/4K3 w - - 0 1" });
    fireEvent.click(square("b7"));
    fireEvent.click(square("b8"));
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ san: "b8=Q+" }));
  });

  test("a rejected move shows briefly and then slides back", () => {
    vi.useFakeTimers();
    try {
      const onMove = vi.fn(() => false);
      const { container } = render(
        <Board fen={START_FEN} orientation="white" interactive label="Training board" onMove={onMove} />,
      );
      fireEvent.click(square("e2"));
      fireEvent.click(square("e4"));
      expect(container.querySelector('.mc-piece[data-piece="wP"][data-square="e4"]')).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(container.querySelector('.mc-piece[data-piece="wP"][data-square="e4"]')).toBeNull();
      expect(container.querySelector('.mc-piece[data-piece="wP"][data-square="e2"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("announces played moves to screen readers", () => {
    setup();
    fireEvent.click(square("e2"));
    fireEvent.click(square("e4"));
    expect(screen.getByText("You played e4")).toHaveAttribute("aria-live", "polite");
  });

  test("announces moves played for the learner through the announcement prop", () => {
    const { rerender } = setup();
    fireEvent.click(square("e2"));
    fireEvent.click(square("e4"));
    expect(screen.getByText("You played e4")).toHaveAttribute("aria-live", "polite");
    rerender(<Board fen={START_FEN} orientation="white" interactive label="Training board" announcement="Black played e5" />);
    expect(screen.getByText("Black played e5")).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByText("You played e4")).toBeNull();
  });

  test("announces rejected moves to screen readers", () => {
    setup({ onMove: vi.fn(() => false) });
    fireEvent.click(square("e2"));
    fireEvent.click(square("e4"));
    expect(screen.getByText("e4 was not accepted")).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByText("You played e4")).toBeNull();
  });
});
