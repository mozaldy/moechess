import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { AssessmentStatus } from "@/components/assessment/AssessmentStatus";
import { PriorityList } from "@/components/assessment/PriorityList";
import type { ControllerView } from "@/lib/assessment/controller";
import type { Finding } from "@/lib/assessment/types";

const view: ControllerView = {
  playerKey: "learner", players: [{ key: "learner", displayName: "Learner" }],
  snapshot: { player: { key: "learner", displayName: "Learner" }, games: [], analyses: [], current: {
    id: "a", playerKey: "learner", signature: "s", selectedIds: Array.from({ length: 10 }, (_, n) => String(n)),
    state: "paused", coverage: "partial", cursor: { months: [], nextMonth: 0, seenIds: [], windowStart: "2025-09-01T00:00:00.000Z", windowEnd: "2026-09-01T00:00:00.000Z", invalid: 2, ineligible: 1 },
    completedIds: ["0", "1", "2"], createdAt: "", updatedAt: "",
  }, draft: null },
  report: { priorities: [], examples: [], analyzedGames: 3, provisional: true },
  phase: "paused", message: null, storage: { kind: "ok" }, sessionOnly: false,
};

test("shows honest progress, skipped games, and resume action", async () => {
  const onResume = vi.fn();
  render(<AssessmentStatus view={view} onStart={vi.fn()} onResume={onResume} onCancel={vi.fn()} onContinueInMemory={vi.fn()} />);
  expect(screen.getByText("3 of 10 games analyzed")).toBeInTheDocument();
  expect(screen.getByText("Imported: 10 games")).toBeInTheDocument();
  expect(screen.getByText("Analyzed: 3 games")).toBeInTheDocument();
  expect(screen.getByText("Skipped: 3 game records")).toBeInTheDocument();
  expect(screen.getByText("Unfinished: 7 games")).toBeInTheDocument();
  expect(screen.getByText("Sep 1, 2025 – Aug 31, 2026")).toBeInTheDocument();
  expect(screen.getByText(/Skipped: 3/)).toBeInTheDocument();
  expect(screen.getByText(/Provisional/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Resume analysis" }));
  expect(onResume).toHaveBeenCalledTimes(1);
});

test("distinguishes an unfinished empty scan from completed empty coverage", () => {
  const partial = { ...view, report: { ...view.report!, analyzedGames: 0 }, phase: "importing" as const,
    snapshot: { ...view.snapshot!, current: { ...view.snapshot!.current!, selectedIds: [], completedIds: [], state: "importing" as const } } };
  const { rerender } = render(<AssessmentStatus view={partial} onStart={vi.fn()} onResume={vi.fn()} onCancel={vi.fn()} onContinueInMemory={vi.fn()} />);
  expect(screen.getByText(/No eligible games imported yet/)).toBeInTheDocument();
  expect(screen.queryByText(/No eligible rated rapid games were found/)).not.toBeInTheDocument();
  rerender(<AssessmentStatus view={{ ...partial, snapshot: {
    ...partial.snapshot, current: { ...partial.snapshot.current, coverage: "complete" },
  } }} onStart={vi.fn()} onResume={vi.fn()} onCancel={vi.fn()} onContinueInMemory={vi.fn()} />);
  expect(screen.getByText(/No eligible games imported yet/)).toBeInTheDocument();
  rerender(<AssessmentStatus view={{ ...partial, phase: "complete", snapshot: {
    ...partial.snapshot, current: { ...partial.snapshot.current, coverage: "complete", state: "complete" },
  } }} onStart={vi.fn()} onResume={vi.fn()} onCancel={vi.fn()} onContinueInMemory={vi.fn()} />);
  expect(screen.getByText(/No eligible rated rapid games were found/)).toBeInTheDocument();
});

test("shows session-only recovery and a retry countdown", () => {
  const retryAt = new Date(Date.now() + 30_000).toISOString();
  render(<AssessmentStatus view={{ ...view, sessionOnly: true, snapshot: {
    ...view.snapshot!, current: { ...view.snapshot!.current!, retryAt },
  } }} onStart={vi.fn()} onResume={vi.fn()} onCancel={vi.fn()} onContinueInMemory={vi.fn()} />);
  expect(screen.getByText(/Session only/)).toBeInTheDocument();
  expect(screen.getByText(/Try again in about/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Resume analysis" })).toBeDisabled();
});

test("explains when there are no supported recurring findings", () => {
  render(<PriorityList report={{ priorities: [], examples: [], analyzedGames: 3, provisional: false }} onInspect={vi.fn()} />);
  expect(screen.getByText("No recurring supported tactics found in these games.")).toBeInTheDocument();
});

test("allows inspection of every finding in a priority", async () => {
  const first = { id: "f1", ply: 5 } as Finding;
  const second = { id: "f2", ply: 13 } as Finding;
  const onInspect = vi.fn();
  render(<PriorityList report={{ priorities: [{ key: "fork:missed", theme: "fork", direction: "missed",
    affectedGames: 2, analyzedGames: 3, findings: [first, second], title: "Missed fork", advice: "Scan checks." }],
    examples: [], analyzedGames: 3, provisional: false }} onInspect={onInspect} />);
  await userEvent.click(screen.getByText("2 examples"));
  await userEvent.click(screen.getByRole("button", { name: "Inspect example 2, move 7" }));
  expect(onInspect).toHaveBeenCalledWith(second);
});

test("explains a busy tab without exposing an internal code", () => {
  render(<AssessmentStatus view={{ ...view, message: "busy" }} onStart={vi.fn()} onResume={vi.fn()} onCancel={vi.fn()} onContinueInMemory={vi.fn()} />);
  expect(screen.getByText(/Another tab is analyzing games/)).toBeInTheDocument();
  expect(screen.queryByText("busy")).not.toBeInTheDocument();
});
