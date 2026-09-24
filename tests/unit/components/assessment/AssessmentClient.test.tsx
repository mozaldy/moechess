import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { AssessmentClient } from "@/components/assessment/AssessmentClient";
import { useAssessmentController } from "@/components/assessment/useAssessmentController";
import type { AssessmentController, ControllerView } from "@/lib/assessment/controller";

vi.mock("@/components/assessment/useAssessmentController", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/assessment/useAssessmentController")>();
  return { ...original, useAssessmentController: vi.fn(original.useAssessmentController) };
});

const emptyView: ControllerView = {
  playerKey: null, players: [], snapshot: null, report: null, phase: "idle", message: null,
  storage: { kind: "ok" }, sessionOnly: false,
};

test("offers import and displays an empty state", () => {
  vi.mocked(useAssessmentController).mockReturnValue({ controller: {} as AssessmentController, view: emptyView, initError: null });
  render(<AssessmentClient courses={[]} />);
  expect(screen.getByRole("heading", { name: "Find your next study focus" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Chess.com username" })).toBeInTheDocument();
  expect(screen.getByText("Choose a player to begin.")).toBeInTheDocument();
});

test("confirms before deleting local player data", async () => {
  const deletePlayer = vi.fn().mockResolvedValue(undefined);
  vi.mocked(useAssessmentController).mockReturnValue({ controller: { deletePlayer } as unknown as AssessmentController,
    view: { ...emptyView, playerKey: "learner" }, initError: null });
  render(<AssessmentClient courses={[]} />);
  await userEvent.click(screen.getByRole("button", { name: "Delete local data for learner" }));
  expect(deletePlayer).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Delete local data" }));
  expect(deletePlayer).toHaveBeenCalledTimes(1);
});

test("refreshes the selected player without selecting again", async () => {
  const importGames = vi.fn().mockResolvedValue(undefined);
  const selectPlayer = vi.fn();
  vi.mocked(useAssessmentController).mockReturnValue({ controller: { import: importGames, selectPlayer } as unknown as AssessmentController,
    view: { ...emptyView, playerKey: "learner" }, initError: null });
  render(<AssessmentClient courses={[]} />);
  await userEvent.click(screen.getByRole("button", { name: "Refresh games" }));
  expect(importGames).toHaveBeenCalledTimes(1);
  expect(selectPlayer).not.toHaveBeenCalled();
});

test("pauses a pending import while the long action is busy", async () => {
  let finishImport!: () => void;
  const importing = new Promise<void>((resolve) => { finishImport = resolve; });
  const importGames = vi.fn(() => importing);
  const cancel = vi.fn().mockResolvedValue(undefined);
  const controller = { selectPlayer: vi.fn().mockResolvedValue(undefined), import: importGames, cancel } as unknown as AssessmentController;
  let currentView: ControllerView = emptyView;
  vi.mocked(useAssessmentController).mockImplementation(() => ({ controller, view: currentView, initError: null }));
  const { rerender } = render(<AssessmentClient courses={[]} />);
  await userEvent.type(screen.getByRole("textbox", { name: "Chess.com username" }), "Learner");
  await userEvent.click(screen.getByRole("button", { name: "Import games" }));
  expect(importGames).toHaveBeenCalledTimes(1);
  currentView = { ...emptyView, playerKey: "learner", phase: "importing" };
  rerender(<AssessmentClient courses={[]} />);
  expect(screen.getByRole("textbox", { name: "Chess.com username" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Pause assessment" }));
  expect(cancel).toHaveBeenCalledTimes(1);
  await act(async () => { finishImport(); await importing; });
  currentView = { ...currentView, phase: "paused" };
  rerender(<AssessmentClient courses={[]} />);
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Chess.com username" })).toBeEnabled());
});
