import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Dialogue } from "@/components/dialogue/Dialogue";

const TEXT = "The Berlin Defence. Black counterattacks e4 instead of chasing the bishop.";

function mockReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
}

const typed = (container: HTMLElement) => container.querySelector(".mc-dialogue-text")!.textContent;

describe("Dialogue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockReducedMotion(false);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("shows the speaker name tag and source", () => {
    render(<Dialogue speaker="Course" text={TEXT} source="Wikibooks" />);
    expect(screen.getByText("Course")).toHaveClass("mc-dialogue-nametag");
    expect(screen.getByText("Source: Wikibooks")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Commentary" })).toHaveAttribute("data-state", "typing");
  });

  test("types the text in over time", () => {
    const { container } = render(<Dialogue speaker="Course" text={TEXT} />);
    expect(typed(container)).toBe("");
    act(() => {
      vi.advanceTimersByTime(24 * 5);
    });
    expect(typed(container)).toBe(TEXT.slice(0, 10));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(typed(container)).toBe(TEXT);
    expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
  });

  test("screen readers get the full text immediately", () => {
    render(<Dialogue speaker="Course" text={TEXT} />);
    expect(screen.getByText(TEXT)).toHaveAttribute("aria-live", "polite");
  });

  test("Show all completes the text", () => {
    const { container } = render(<Dialogue speaker="Course" text={TEXT} />);
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(typed(container)).toBe(TEXT);
    expect(screen.getByRole("region", { name: "Commentary" })).toHaveAttribute("data-state", "complete");
  });

  test("new text starts typing again", () => {
    const { container, rerender } = render(<Dialogue speaker="Course" text={TEXT} />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    rerender(<Dialogue speaker="Course" text="Main line." />);
    expect(typed(container)).toBe("");
  });

  test("reduced motion shows everything at once", () => {
    mockReducedMotion(true);
    const { container } = render(<Dialogue speaker="Course" text={TEXT} />);
    expect(typed(container)).toBe(TEXT);
  });

  test("an empty note says so", () => {
    render(<Dialogue speaker="Course" text={null} />);
    expect(screen.getByText("No notes for this move.")).toBeInTheDocument();
  });
});
