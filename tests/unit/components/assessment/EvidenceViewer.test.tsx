import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { EvidenceViewer } from "@/components/assessment/EvidenceViewer";
import { fixtureFinding, fixtureGame } from "@/tests/fixtures/assessment";

describe("EvidenceViewer", () => {
  test("orients a noninteractive board and navigates both branches by keyboard", async () => {
    const user = userEvent.setup();
    const finding = fixtureFinding({ side: "black" });
    const { container } = render(<EvidenceViewer finding={finding} game={fixtureGame()} />);
    expect(container.querySelector(".mc-board")).toHaveAttribute("data-orientation", "black");
    expect(screen.queryByRole("textbox", { name: "Type a move" })).toBeNull();
    const controls = within(screen.getByRole("group", { name: "Replay controls" }));
    expect(controls.getByText("Starting position")).toBeInTheDocument();
    const next = screen.getByRole("button", { name: "Next move" });
    next.focus();
    await user.keyboard("{Enter}");
    expect(controls.getByText("2. g4")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(controls.getByText("2... Qh4#")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous move" }));
    expect(controls.getByText("2. g4")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Recommended line" }));
    expect(controls.getByText("Starting position")).toBeInTheDocument();
    await user.click(next);
    expect(controls.getByText("2. g3")).toBeInTheDocument();
  });

  test("distinguishes actual continuation from an unplayed punishment", () => {
    const game = fixtureGame({ history: { initialFen: fixtureGame().history.initialFen,
      moves: ["f2f3", "e7e5", "g2g4", "b8c6"] } });
    render(<EvidenceViewer finding={fixtureFinding({ executed: false })} game={game} />);
    expect(screen.getByText(/would have punished/)).toBeInTheDocument();
    expect(screen.getByText(/Actual game continuation: 2\. g4 2\.\.\. Nc6/)).toBeInTheDocument();
  });

  test("a missed tactic still calls the played branch the actual decision", () => {
    render(<EvidenceViewer finding={fixtureFinding({ direction: "missed", tacticalPly: 0, executed: false })} game={fixtureGame()} />);
    expect(screen.getByText("This line shows the verified consequence of the played move.")).toBeInTheDocument();
    expect(screen.queryByText(/would have punished/)).toBeNull();
  });

  test("a corrupt later game move does not hide verified evidence", () => {
    const game = fixtureGame({ history: { initialFen: fixtureGame().history.initialFen,
      moves: ["f2f3", "e7e5", "g2g4", "e2e5"] } });
    render(<EvidenceViewer finding={fixtureFinding()} game={game} />);
    expect(screen.getByRole("group", { name: "Position from your game" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Chess.com/ })).toBeInTheDocument();
    expect(screen.queryByText(/Actual game continuation/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("revalidates a stored game URL before making a link", () => {
    const { rerender } = render(<EvidenceViewer finding={fixtureFinding()} game={fixtureGame({ url: "javascript:alert(1)" })} />);
    expect(screen.queryByRole("link", { name: /Chess.com/ })).toBeNull();
    rerender(<EvidenceViewer finding={fixtureFinding()} game={fixtureGame({ url: '<img src=x onerror="alert(1)">' })} />);
    expect(screen.queryByRole("link", { name: /Chess.com/ })).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    rerender(<EvidenceViewer finding={fixtureFinding()} game={fixtureGame()} />);
    expect(screen.getByRole("link", { name: /Chess.com/ })).toHaveAttribute("href", "https://www.chess.com/game/live/1001");
  });

  test("corrupt saved evidence renders a notice and leaves surrounding content usable", () => {
    render(<div><h2>Assessment results</h2><EvidenceViewer finding={fixtureFinding({ playedLine: ["e2e5"] })} game={fixtureGame()} /></div>);
    expect(within(screen.getByRole("alert")).getByText(/Example unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Assessment results" })).toBeInTheDocument();
  });
});
