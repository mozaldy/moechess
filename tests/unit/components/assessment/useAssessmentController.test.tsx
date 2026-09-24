import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { expect, test, vi } from "vitest";
import { useAssessmentController } from "@/components/assessment/useAssessmentController";
import type { AssessmentController, ControllerView } from "@/lib/assessment/controller";
import type { CourseTree } from "@/lib/course/types";

const emptyView: ControllerView = {
  playerKey: null, players: [], snapshot: null, report: null, phase: "idle", message: null,
  storage: { kind: "ok" }, sessionOnly: false,
};

test("disposes a late Strict Mode initialization and keeps the second controller", async () => {
  const resolvers: Array<(value: AssessmentController) => void> = [];
  const factory = vi.fn(() => new Promise<AssessmentController>((resolve) => resolvers.push(resolve)));
  const courses: CourseTree[] = [];
  const { result, unmount } = renderHook(() => useAssessmentController(courses, factory), { wrapper: StrictMode });
  expect(resolvers).toHaveLength(2);
  const first = { dispose: vi.fn(), getSnapshot: () => emptyView, subscribe: vi.fn(() => () => {}) } as unknown as AssessmentController;
  const second = { dispose: vi.fn(), getSnapshot: () => emptyView, subscribe: vi.fn(() => () => {}) } as unknown as AssessmentController;
  await act(async () => { resolvers[0](first); await Promise.resolve(); });
  expect(first.dispose).toHaveBeenCalledTimes(1);
  await act(async () => { resolvers[1](second); await Promise.resolve(); });
  await waitFor(() => expect(result.current.controller).toBe(second));
  expect(second.dispose).not.toHaveBeenCalled();
  unmount();
  expect(second.dispose).toHaveBeenCalledTimes(1);
});
