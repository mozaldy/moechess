import Link from "next/link";
import { resolveCourseLinks } from "@/lib/analysis/openings/match";
import type { OpeningMatch } from "@/lib/assessment/types";
import type { CourseTree } from "@/lib/course/types";

export function OpeningSummary({ matches, courses }: { matches: OpeningMatch[]; courses: CourseTree[] }): React.JSX.Element {
  const grouped = new Map<string, { match: OpeningMatch; count: number }>();
  for (const match of matches) {
    const key = `${match.courseSlug ?? match.label}:${match.side}`;
    const entry = grouped.get(key);
    grouped.set(key, { match, count: (entry?.count ?? 0) + 1 });
  }
  return <section className="mc-panel" aria-labelledby="assessment-openings-title">
    <h2 id="assessment-openings-title" className="mc-panel-title">Openings in your games</h2>
    {grouped.size === 0 ? <p>Opening links will appear after games are analyzed.</p> :
      <ul className="mc-opening-summary">{[...grouped.values()].map(({ match, count }) => {
        const links = resolveCourseLinks(match, courses);
        return <li key={`${match.courseSlug ?? match.label}:${match.side}`}>
          <strong>{match.label}</strong> <span className="mc-muted">{count} {count === 1 ? "game" : "games"} as {match.side}</span>
          <div className="mc-button-row">{links.explore && <Link href={links.explore}>Explore course position</Link>}
            {links.lessons.map((lesson) => <Link key={lesson.href} href={lesson.href}>Learn {lesson.label}</Link>)}</div>
        </li>;
      })}</ul>}
  </section>;
}
