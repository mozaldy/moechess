"use client";

import { useState } from "react";
import { explainFinding } from "@/lib/assessment/explanations";
import type { Finding, OpeningMatch } from "@/lib/assessment/types";
import type { CourseTree } from "@/lib/course/types";
import { AssessmentStatus } from "./AssessmentStatus";
import { ImportForm } from "./ImportForm";
import { OpeningSummary } from "./OpeningSummary";
import { PriorityList } from "./PriorityList";
import { useAssessmentController } from "./useAssessmentController";
import { EvidenceViewer } from "./EvidenceViewer";

export function AssessmentClient({ courses }: { courses: CourseTree[] }): React.JSX.Element {
  const { controller, view, initError } = useAssessmentController(courses);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  async function run(work: () => Promise<void>) {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try { await work(); }
    catch { setActionError("That action could not finish. Check the status below and try again."); }
    finally { setActionBusy(false); }
  }
  function act(work: () => Promise<void>) { void run(work); }
  const assessment = view?.snapshot?.draft ?? view?.snapshot?.current;
  const completed = new Set(assessment?.completedIds ?? []);
  const openings: OpeningMatch[] = view?.snapshot?.analyses
    .filter((item) => completed.has(item.gameId) && item.signature === assessment?.signature)
    .flatMap((item) => item.openings) ?? [];
  const visibleFinding = selectedFinding && view?.report &&
    [...view.report.priorities, ...view.report.examples].some((item) => item.findings.some((finding) => finding.id === selectedFinding.id))
    ? selectedFinding : null;
  const visibleGame = visibleFinding && view?.snapshot?.games.find((game) => game.id === visibleFinding.gameId);

  return <section className="mc-assessment" data-state={view?.phase ?? "loading"} aria-labelledby="assessment-title">
    <header className="mc-assessment-hero">
      <h1 id="assessment-title" className="mc-page-title">Find your next study focus</h1>
      <p>Assess up to 50 rated rapid games from the last 12 months.</p>
      <p className="mc-muted">Games and results are saved in this browser. Keep this page open during analysis.</p>
    </header>
    {initError && <p role="alert" className="mc-notice">{initError}</p>}
    {actionError && <p role="alert" className="mc-notice">{actionError}</p>}
    {!controller || !view ? <p role="status">Loading saved players…</p> : <>
      <ImportForm busy={actionBusy || view.phase === "importing" || view.phase === "analyzing"}
        players={view.players}
        onSelect={async (username) => { setSelectedFinding(null); setConfirmDelete(false); await run(() => controller.selectPlayer(username)); }}
        onImport={async (username) => { setSelectedFinding(null); setConfirmDelete(false); await run(async () => { await controller.selectPlayer(username); await controller.import(); }); }} />
      {view.playerKey && <div className="mc-button-row">
        <button type="button" className="mc-button" disabled={actionBusy || view.phase === "importing" || view.phase === "analyzing"}
          onClick={() => act(() => controller.import())}>Refresh games</button>
      </div>}
      <AssessmentStatus view={view} onStart={() => act(() => controller.start())}
        onResume={() => act(() => controller.resume())}
        onCancel={() => { void controller.cancel().catch(() => setActionError("Could not pause the assessment. Try again.")); }}
        onContinueInMemory={() => act(() => controller.continueInMemory())} />
      {view.report && <div className="mc-assessment-results">
        <PriorityList report={view.report} onInspect={setSelectedFinding} />
        <OpeningSummary matches={openings} courses={courses} />
      </div>}
      {visibleFinding && <section className="mc-assessment-evidence mc-panel" aria-labelledby="assessment-evidence-title">
        <h2 id="assessment-evidence-title" className="mc-panel-title">Example from your game</h2>
        <h3>{explainFinding(visibleFinding).title}</h3>
        <p>{explainFinding(visibleFinding).explanation}</p>
        <p>{explainFinding(visibleFinding).advice}</p>
        {visibleGame
          ? <EvidenceViewer key={visibleFinding.id} finding={visibleFinding} game={visibleGame} />
          : <p role="alert" className="mc-notice">Example unavailable because its saved game is missing.</p>}
      </section>}
      {view.playerKey && <section className="mc-assessment-delete" aria-label="Local player data">
        {!confirmDelete ? <button type="button" className="mc-button" onClick={() => setConfirmDelete(true)}>Delete local data for {view.snapshot?.player.displayName ?? view.playerKey}</button>
          : <div className="mc-panel"><p>Delete this player’s games and assessment from this browser?</p>
            <div className="mc-button-row"><button type="button" onClick={() => act(async () => { await controller.deletePlayer(); setConfirmDelete(false); setSelectedFinding(null); })}>Delete local data</button>
              <button type="button" onClick={() => setConfirmDelete(false)}>Keep data</button></div></div>}
      </section>}
    </>}
  </section>;
}
