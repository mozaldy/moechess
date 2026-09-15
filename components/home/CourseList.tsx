"use client";

import Link from "next/link";
import { useState } from "react";
import { useWorkspace } from "@/components/workspace/Providers";
import type { CourseTree } from "@/lib/course/types";
import { learnedLineKey } from "@/lib/progress/types";
import { cardsForLine } from "@/lib/training/cards";
import { reconcileProgressCards } from "@/lib/training/reconcile-cards";
import { isDue } from "@/lib/training/scheduler";

export function CourseList({ courses }: { courses: CourseTree[] }) {
  const { snapshot, settings, now } = useWorkspace();
  const [openedAt] = useState(now);
  const side = settings.side;
  // Reconciled over every course (read-only here) so the counts match what /review picks.
  const cards = snapshot ? reconcileProgressCards(courses, side, snapshot.cards, openedAt).cards : {};

  return (
    <ul className="mc-course-list">
      {courses.map((course) => {
        const learnedLines = course.lines.filter((line) => snapshot?.learnedLines[learnedLineKey(course.meta.slug, side, line.id)]);
        const learned = learnedLines.length;
        const learnedIds = new Set(learnedLines.flatMap((line) => cardsForLine(course, line, side)));
        const due = [...learnedIds].filter((id) => cards[id] && isDue(cards[id], openedAt)).length;
        return (
          <li key={course.meta.slug} className="mc-panel mc-course">
            <div>
              <h2 className="mc-course-name">{course.meta.name}</h2>
              <p className="mc-course-stats">
                {snapshot
                  ? `${learned} of ${course.lines.length} lines learned as ${side}${due > 0 ? `, ${due} due for review` : ""}`
                  : `${course.lines.length} lines`}
              </p>
            </div>
            <div className="mc-button-row">
              <Link href={`/course/${course.meta.slug}`}>Explore lines</Link>
              {due > 0 && <Link href="/review">Review {due} due</Link>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
