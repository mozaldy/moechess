"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createBrowserEngine } from "@/lib/analysis/engine/browser-engine";
import { createAssessmentController, type AssessmentController, type ControllerView } from "@/lib/assessment/controller";
import { withAssessmentLock } from "@/lib/assessment/locks";
import { openAssessmentStore } from "@/lib/assessment/storage/indexeddb";
import type { CourseTree } from "@/lib/course/types";
import { createChessComClient } from "@/lib/import/chesscom/client";

async function defaultFactory(courses: CourseTree[]): Promise<AssessmentController> {
  const store = await openAssessmentStore();
  return createAssessmentController({
    store, courses, client: createChessComClient(), engineFactory: createBrowserEngine,
    now: () => new Date(), withLock: withAssessmentLock,
  });
}

const serverSnapshot = (): null => null;
const noopSubscribe = (): (() => void) => () => {};

export function useAssessmentController(
  courses: CourseTree[],
  factory: (courses: CourseTree[]) => Promise<AssessmentController> = defaultFactory,
): { controller: AssessmentController | null; view: ControllerView | null; initError: string | null } {
  const [controller, setController] = useState<AssessmentController | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let resource: AssessmentController | null = null;
    void factory(courses).then((created) => {
      resource = created;
      if (!active) { created.dispose(); return; }
      setController(created);
      setInitError(null);
    }, () => {
      if (active) setInitError("Could not open local assessment data. Reload this page to try again.");
    });
    return () => { active = false; resource?.dispose(); };
  }, [courses, factory]);

  const { subscribe, getSnapshot } = useMemo(() => ({
    subscribe: controller ? (listener: () => void) => controller.subscribe(listener) : noopSubscribe,
    getSnapshot: controller ? () => controller.getSnapshot() : serverSnapshot,
  }), [controller]);
  const view = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  return { controller, view, initError };
}
