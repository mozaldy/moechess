"use client";

import type { Finding } from "@/lib/assessment/types";
import type { RecommendationSet, StudyPriority } from "@/lib/assessment/recommendations";

export function PriorityList({ report, onInspect }: { report: RecommendationSet; onInspect: (finding: Finding) => void }): React.JSX.Element {
  const renderPriority = (priority: StudyPriority) => <li key={priority.key} className="mc-study-priority">
    <div><h3>{priority.title}</h3>
      <p>{priority.affectedGames} of {priority.analyzedGames} analyzed games</p></div>
    <p>{priority.advice}</p>
    {priority.findings.length > 0 && <details>
      <summary>{priority.findings.length} {priority.findings.length === 1 ? "example" : "examples"}</summary>
      <ol className="mc-study-examples">{priority.findings.map((finding, index) => <li key={finding.id}>
        <button type="button" onClick={() => onInspect(finding)}
          aria-label={`Inspect example ${index + 1}, move ${Math.ceil(finding.ply / 2)}`}>
          Example {index + 1}, move {Math.ceil(finding.ply / 2)}
        </button>
      </li>)}</ol>
    </details>}
  </li>;
  return <section className="mc-panel" aria-labelledby="assessment-priorities-title">
    <h2 id="assessment-priorities-title" className="mc-panel-title">What to study next</h2>
    {report.priorities.length > 0 ? <ol className="mc-assessment-priorities">{report.priorities.map(renderPriority)}</ol>
      : <p>{report.analyzedGames === 0 ? "Analyze games to see study priorities." : "No recurring supported tactics found in these games."}</p>}
    {report.examples.length > 0 && <><h3 className="mc-panel-heading">Individual examples</h3>
      <ul className="mc-assessment-priorities">{report.examples.map(renderPriority)}</ul></>}
  </section>;
}
