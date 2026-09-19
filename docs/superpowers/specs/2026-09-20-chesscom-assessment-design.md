# Chess.com game assessment and study priorities

Date: 2026-09-20
Status: Conversational design approved; written specification awaiting user review
Workflow: Superpowers brainstorming, architectural path

## 1. Intent and success criteria

Moechess is a gym for chess: a player's games should identify useful study priorities,
which can lead to practice and later reassessment. This release establishes the
assessment part of that loop for beginners and improving players, roughly below
1200 Chess.com. The rating range guides explanations and tactical scope; it is not
an eligibility restriction.

A player enters a Chess.com username, imports recent games, and receives an
assessment with concrete examples and useful study suggestions. Success means the
player can understand what to work on and why, even when Moechess has no course for
that topic. Findings describe observed play, not a definitive measure of knowledge.

### Decisions confirmed with the user

- Deliver assessment and study priorities first. Playable tactical exercises follow
  in a separate project.
- No Moechess account or cross-device synchronization. Store results in this browser.
- Analyze in the browser initially, behind an engine interface that can later support
  server processing. The analysis page must remain open; work can resume after return.
- Focus on beginner-relevant hanging pieces, missed mate in one, and clear forks,
  separating missed opportunities from allowed threats.
- Include relevant existing opening lessons, without equating course deviations with
  mistakes or changing review schedules automatically.
- GPL dependencies are not categorically excluded. Account for the selected engine's
  distribution requirements.
- Promote a tactical theme to a study priority only when it occurs in at least three
  distinct analyzed games. Present smaller evidence sets as examples worth reviewing.

The detailed defaults below make these decisions implementable. They are part of this
written specification's review, not additional features already shipped or validated.

## 2. Scope and relationship to existing work

### Included

- Username-based public game import; at most 50 recent eligible games per assessment.
- Completed, rated, standard rapid games, including wins, losses, and draws, with the
  entered player on either side.
- Browser engine, conservative motif detectors, local checkpoints, and resumption.
- Up to three tactical study priorities with replayable evidence and practical advice.
- Opening usage summary and links to relevant available Ruy Lopez lessons.
- Visible partial results, skipped-game counts, limited evidence, and recoverable errors.
- Existing themes, responsive layout, keyboard access, and screen-reader support.

### Deferred

- Puzzle solving, generated exercise grading, tactical FSRS cards, and puzzle imports.
- Accounts, server analysis, server assessment storage, and automatic background sync.
- Live or ongoing-game analysis, other speeds or variants, and full-history analytics.
- A general game-review engine exposing every positional error or an accuracy score.
- Advanced tactical themes, psychological diagnosis, and automated long-term progress claims.
- New opening courses, content generation, and an LLM coach.

The original workspace design anticipated Chess.com import after a larger content
pipeline. This assessment slice can use today's course data and does not require that
pipeline. It does not expand or rewrite the existing sample course. The existing
`markDeviation` hook remains unused by this release.

## 3. User journey and interface

Add an **Assessment** navigation item leading to `/assessment`. Keep the course home
page and training routes intact. An assessment client owns import, analysis, and local
state; browser-only resources are initialized after mounting.

1. Enter a username or select a previously assessed username saved in this browser.
2. Import games, with visible status and a Cancel control.
3. Display the selected game count, date range, eligibility rules, and local-storage
   status. A **Start assessment** action begins the engine download and processing.
4. Show completed games out of the selected total. Results accumulate as games finish.
   The user can cancel processing without deleting completed work.
5. Present up to three recurring tactical priorities, individual examples with limited
   evidence, and a separate opening summary.
6. Open an example on the existing board, oriented to the assessed player's color.
   Step through the played continuation or the recommended continuation, with move
   numbers, plain-language explanations, and a link to the original completed game.
7. On return, offer **Resume assessment** for unfinished work or **Refresh games** to
   build an updated assessment from the newest eligible games.

The global opening-training side selection does not filter this assessment. Each game
determines the assessed side. A course link identifies the recommended side without
silently changing an unrelated training session.

### Presentation rules

- Label results provisional while import coverage or analysis is incomplete.
- Report imported, fully analyzed, invalid/skipped, and unfinished game counts distinctly.
- Say "Found in 4 of 30 analyzed games," not "87% tactical understanding."
- With no findings, say no clear examples were found within the supported themes and
  analysis limits; do not claim the player has no weaknesses.
- Offer concrete study actions even without a matching course. Do not show a working
  tactics-practice button before that feature exists.
- Retain the app's tokens, stable styling hooks, skins, contrast, and reduced-motion behavior.
- Evidence navigation uses buttons and accessible move labels. The board is for replay,
  with move-entry controls hidden in this context rather than presented as a disabled drill.

## 4. Architecture and module boundaries

Business logic remains plain TypeScript, following the existing repository structure.

| Module | Responsibility | Inputs and outputs |
| --- | --- | --- |
| `lib/import/chesscom/` | Request public archives, validate records, select and deduplicate games | Username and cancellation signal to normalized games plus coverage/errors |
| `lib/analysis/engine/` | Worker lifecycle and engine protocol adapter | Game history, candidate moves, search budget to normalized evaluations and legal lines |
| `lib/analysis/tactics/` | Candidate detection and evidence validation | Reconstructed positions and engine adapter to verified incidents or exclusions |
| `lib/analysis/openings/` | Summarize source opening labels and match available courses | Games and course trees to usage counts and lesson links |
| `lib/assessment/` | Coordinate jobs and build recommendations | Game selection, findings, and policy version to assessment state |
| `lib/assessment/storage/` | IndexedDB persistence with schema/version handling | Player-scoped records and atomic game checkpoints |
| `components/assessment/` | Import form, status, priorities, and evidence replay | Assessment state and user actions |
| `app/assessment/` | Route and server-loaded course data | Existing course loader to the client assessment interface |

The browser importer calls the fixed Chess.com public API origin directly. This release
does not add an application server proxy. Cross-origin access must pass the real-browser
integration check before release; a failure is an integration blocker requiring an
explicit design amendment, not permission to add a hidden server dependency.

Reuse `lib/chess/position.ts`, the PGN tooling, existing course trees, and the board.
Do not use opening-card IDs as assessment finding IDs. A position in an opening course
and a game incident have different lifecycles and identity requirements.

The engine interface exposes initialization, analysis, cancellation, and disposal.
Results include score perspective, score kind (centipawns or mate), search information,
and principal variation. Callers do not consume raw engine protocol messages. A future
server provider would implement that contract; no server stub or fallback is built now.

## 5. Import contract

Use the public archive-list endpoint and monthly archives. The API supplies game moves
and metadata; this feature does not depend on Chess.com's accuracy values or puzzle
history. Public records are not proof of ownership of a username.

Implementation rules:

- Trim input, normalize lookup keys to lowercase, and encode the username as one URL
  path segment. Never accept a user-provided URL as an API destination.
- Read archive months newest first, one request at a time, and sort games within a month
  by completion time descending, with source game ID as a stable tie breaker.
- Limit scanning to the previous 12 months including the current UTC month. Stop when
  50 valid eligible games have been collected or that window is exhausted. Display the
  window explicitly when fewer games are available.
- Check rated status, standard rules, rapid time class, completion, and player identity.
  Parse the mainline and validate every move before accepting the game. Require the
  normal initial position; exclude custom starts from this first release.
- Deduplicate by source game UUID, falling back to canonical source game URL. Store a
  content fingerprint so a corrected source record invalidates its old analysis.
- Filter and parse away from the UI thread or in yielding batches. Persist only selected
  normalized games, not entire unfiltered monthly archives.
- Honor normal browser HTTP caching. Do not introduce cross-origin conditional headers
  that require unsupported preflight behavior. Refresh is manual, with a 60-second
  client cooldown; source caching means recently finished games may be absent.
- Use a 30-second request timeout. For network failures and server errors, retry at most
  twice, with 2- and 5-second delays. On rate limiting, stop automatic requests and offer
  retry after the provided retry interval when readable, otherwise after 60 seconds.
- Retain selected games if import stops early. Mark source coverage partial until the
  scan completes; retry the failed month before scanning older months so the final
  selection remains the newest eligible games in the window.
- Reimporting unchanged data reuses compatible analysis. A refreshed selection contains
  at most 50 games; older cached records never inflate its recommendation counts.

The 12-month window, retry defaults, and cooldown are bounded product choices rather
than claims about Chess.com's service guarantees.

## 6. Browser engine and processing

Use a pinned lite, single-threaded Stockfish.js WebAssembly build in a dedicated worker.
Load it only when analysis starts. Host the selected assets with the application and
retain build/source provenance. Single-threaded operation avoids making cross-origin
isolation a new requirement across the existing app.

Only one analysis job runs at a time in a tab. A browser-wide Web Lock for assessment
processing prevents two tabs from committing competing jobs; browsers without that
capability may view stored reports but must show an unsupported-analysis message.
Release the lock on cancellation, navigation away, or worker failure. After reload,
unfinished persisted jobs are resumable rather than presumed to still be running.

### Analysis sequence

1. Reconstruct the complete game history and identify each move made by the assessed player.
2. Enumerate supported tactical candidates before and after that move using legal-move
   information. A move may create an opportunity, decline one, or allow a threat.
3. Check candidate continuations and reasonable alternatives with the engine. There is
   no need to score unrelated quiet positions solely to produce a game accuracy number.
4. Validate both the motif and the concrete consequence. Exclude inconclusive candidates.
5. Deduplicate incidents and atomically store the completed game's findings, exclusions,
   opening matches, and analysis signature. Only then increment the completed count.

Use fixed node budgets rather than device-dependent time alone for comparable analysis.
Initial verification searches use 200,000 nodes, followed by 400,000 nodes for a candidate
that would otherwise produce a finding. At both budgets, the motif and its consequence
must remain supported. Compare the best alternative and the played move with
separate root searches at matching budgets, using normalized player-perspective scores.
Do not require an identical best move where equivalent valid alternatives exist.

A 15-second per-search watchdog is a responsiveness limit, not evidence of correctness.
If reached, stop the search, pause the job, preserve completed games, and offer retry.
Do not count an unfinished game as clean or silently reduce verification quality. The
initial budgets are calibration settings: changing them requires a new analysis signature
and rerunning the evidence checks. No completion-time promise is made before measurement.

On Cancel, attempt engine stop and terminate the worker if it does not acknowledge
within one second. Ignore late messages using request/job IDs. Resume reruns the
unfinished game; checkpoints are at game boundaries, not individual engine searches.

Position-only course keys are insufficient for engine caching. Pass initial position
plus move history to preserve repetition and move-counter context. Cache keys include
history fingerprint, requested root moves, search settings, and engine build identity.

## 7. Supported tactical evidence

Detectors are intentionally conservative. An engine score drop without a supported
motif never becomes a tactical claim. A geometric pattern alone is also insufficient.

| Theme | Missed opportunity | Allowed threat |
| --- | --- | --- |
| Hanging pieces | Declining a legal capture of an opponent's knight, bishop, rook, or queen with a verified short material gain | A move newly permits such a gain against the player's piece when a satisfactory alternative exists |
| Mate in one | A legal immediate mate was available, but the played move neither mates nor preserves a verified forced mate | The played move gives the opponent a legal immediate mate that the player could have prevented |
| Forks | Declining a move that creates effective attacks on at least two enemy targets and yields a verified gain or mate | A move newly permits such a fork that a satisfactory alternative would avoid |

### Verification requirements

- Validate all evidence moves with chess rules, including checks, pins, promotions,
  castling rights, and en passant. An apparent attack by a pinned piece is not sufficient.
- For material findings, require at least a 100-centipawn evaluation
  improvement over the played move at both verification budgets, plus a concrete net
  material benefit of at least one pawn in a short continuation. Piece accounting uses
  pawn 1, knight/bishop 3, rook 5, queen 9; evaluation alone does not prove material gain.
- Material evidence must resolve within six plies of the tactical move, with no immediate
  legal recapture of the claimed won material omitted from the explanation. Reject
  longer, unresolved exchanges rather than explaining an unstable advantage.
- Fork evidence identifies the attacking piece, the targets, and the eventual gain.
  Include the cost of a sacrificed forking piece. Merely attacking two pieces does not
  establish that either can be won; defensive captures and escape resources must be checked.
- Mate in one is established by exhaustive legal move enumeration and checkmate checks.
  Do not classify a move as missed mate when it already wins by mate or retains a verified
  forced mate. Uncertain alternative mating lines are excluded from the finding.
- Engine-reported mating consequences beyond an immediate mate must be supported at both
  verification budgets, with a legal continuation ending in checkmate. If that continuation
  does not fit the six-ply evidence limit, exclude it from fork evidence. Preserve mate
  scores as their own type; do not convert them to arbitrary centipawn values.
- Do not flag a threat as newly allowed when it was already unavoidable before the move.
  A satisfactory alternative must prevent the consequence without an equal or worse
  forced material/mating consequence under the same verification limits.
- Do not claim an allowed tactic was executed unless the opponent actually played it.
  It remains a valid allowed-opportunity example if the opponent missed it.
- Clock annotations, when parseable, are context only. Note low time below 30 seconds,
  but do not infer that time pressure caused the mistake or invent missing clock data.

Each candidate ends as verified, rejected, or inconclusive with an internal reason.
Inconclusive positions do not contribute to priorities. Exclusion counts accompany the
assessment's coverage information. This is conservative engine-backed evidence, not
a proof that all tactical opportunities have been discovered.

### Incident deduplication

An incident belongs to a source game and the assessed player's decision ply. Collapse
overlapping findings from that decision into one primary incident, choosing mate before
fork before hanging piece. Secondary labels may explain the incident but do not add
recommendation counts. A later move in the same game may be a separate incident, but
the game contributes at most once to each theme/direction's affected-game count.

## 8. Recommendations and opening advice

Aggregate only fully analyzed games in the active selection with the same analysis
signature. The recommendation key is theme plus direction (missed or allowed).

- At least three distinct affected games: eligible recurring study priority.
- One or two affected games: examples worth reviewing, outside the top-three priorities.
- Zero verified incidents: no claim about mastery or lack of weakness.
- Sort eligible priorities by affected-game count descending, then by consequence:
  forced mate before material gain, larger verified material gain before smaller.
  Use the most severe verified incident in each group for that consequence comparison,
  then lexical theme/direction ordering for remaining ties.
- Display at most three priorities. Show example counts, the analyzed-game denominator,
  and sample dates. Provisional partial reports use their actual completed denominator.
- Template explanations use verified pieces, squares, moves, and consequences. They
  include a practical habit or study topic, not an invented claim about the player's thinking.

Example advice: checking defended pieces before moving; scanning checks, captures, and
threats; looking for knight forks; checking the opponent's mating threats. Templates are
handwritten and tested against the evidence records. No LLM is required.

Opening summaries use the game's opening metadata when available, labeled as source
classification. Otherwise use a matching available course or "Opening not identified."
Never infer opening skill from win rate or label an entire loss an opening failure.

Match course positions using normalized board keys to handle transpositions. For Ruy
Lopez, require reaching the defining course position after `e4 e5 Nf3 Nc6 Bb5` before
calling it a Ruy Lopez course match; the shared initial position is not sufficient.
Recommend an Explore link to the deepest matching position and an existing named lesson
when the matched continuation identifies one. Multiple candidate lessons are suggestions,
not an invented exact branch. A sound move outside the course is described as outside
the repertoire, not incorrect. Resolve links against current course content so stale
course IDs do not break older reports.

## 9. Records and persistence

Create an IndexedDB assessment database separate from `moechess:progress` and settings.
Keep a versioned schema behind an async store interface and a memory implementation for
tests and session-only use. Never mutate opening-training progress during assessment.

| Record | Required contents |
| --- | --- |
| Player | Normalized username key, display username, last import timestamp |
| Imported game | Player key, source ID/URL, content fingerprint, PGN mainline, initial FEN, completion time, colors/ratings/results, time control, optional opening/clock data |
| Assessment | ID, player key, selected game IDs, source window/coverage, state, analysis signature, counts, created/updated timestamps |
| Game analysis | Player/game/fingerprint/signature key, completed findings, exclusion counts, opening matches, completed timestamp |
| Finding | Stable incident ID, theme/direction, decision ply, player side, before/after FENs, played move, recommended/played evidence lines, targets, concrete consequence, verification metadata |

The analysis signature includes engine build, search budgets, detector policy, and
explanation policy. Schema version is separate. Recommendations are derived from
matching stored findings, so cached counts cannot drift from the evidence.

Persist assessment states as importing, ready, analyzing, paused, complete, or failed,
with a structured reason where relevant. Source coverage is a separate field: a fully
processed partial import can be complete for its selected games while still showing
that the newest-game scan is incomplete. On load, treat persisted importing/analyzing
states without a live job as paused. Engine internals and error codes stay out of the
normal product copy.

Save each completed game and its assessment checkpoint in one transaction. Never
overwrite complete results with partially computed findings. A different username gets
a separate namespace even if the same public game is present in both users' histories.
Automatic account-rename merging is not part of this version.

Keep the latest assessment per username. A refresh atomically replaces its selection
after import finishes, reusing compatible game analyses; canceled refreshes preserve the
previous saved assessment. While refresh import is partial, keep its candidate selection
as a draft that can be assessed provisionally. Completing import reconciles that draft
to the final newest-50 selection before recomputing priorities. Prune unreferenced game
records only after the replacement commits. Offer a clear action to delete one player's
saved assessment and associated game data.

If storage is unavailable initially, allow a clearly labeled session-only assessment
with no resume promise. If a write fails during processing, pause and let the user choose
whether to continue for this session; preserve any previously saved checkpoint. Never
clear other browser data to recover space. An unknown newer schema stays read-only;
do not overwrite it. Corrupt records are isolated and reported, not treated as clean games.

## 10. Error behavior

| Condition | Behavior |
| --- | --- |
| Unknown username | Explain that the public username could not be found; preserve other saved players |
| No eligible games in window | Show eligibility/date window and no assessment claims |
| Malformed game or unsupported start | Skip, count, and continue scanning for eligible games |
| Network/server error or rate limit | Apply bounded import retry policy; retain draft and offer retry |
| Browser API request blocked | Report import unavailable; do not use scraping or an unreviewed proxy |
| Engine download/init failure | Keep imported games and offer retry; no fabricated findings |
| Unsupported worker/WASM/lock capability | Allow reading saved results; explain analysis is unavailable in this browser |
| Search watchdog or worker crash | Pause; retain completed games; retry the unfinished game |
| User cancels, navigates away, or closes tab | Stop work; keep completed checkpoints; offer resume on return |
| Another tab owns analysis lock | Offer to view saved results and explain analysis is active in another tab |
| IndexedDB unavailable/full/corrupt | Apply the explicit session-only/read-only behavior in section 9 |
| Engine or detector version changes | Keep old report viewable and labeled; require a new consistent run to update it |

## 11. Validation and release criteria

### Correctness

- Hand-check a versioned fixture corpus with positive cases for all six theme/direction
  combinations and negative cases for sound sacrifices, harmless forks, defended pieces,
  pinned attackers, intermediate checks, forced losses, and alternative winning mates.
- Test PGN handling for both player colors, promotions, en passant, repetitions, missing
  metadata, malformed records, duplicate IDs, and corrected source games.
- Verify candidate classification with fixture expectations rather than reproducing the
  detector implementation in test assertions. All hand-labeled negative fixtures must
  remain unflagged. Every emitted line must be legal and support its template claim.
- Verify source selection, three-distinct-game threshold, incident deduplication,
  deterministic ranking, partial denominators, and absence of tactical success percentages.
- Test opening transpositions, shared initial positions, sound repertoire deviations,
  unknown openings, and lessons removed after an assessment was saved.

### Integration and lifecycle

- Test worker protocol parsing, score perspective, mate scores, cancellation, timeout,
  late responses, and history-sensitive cache identity.
- Exercise real engine startup and known mate/material positions in a browser. A mocked
  adapter is suitable for deterministic UI tests but does not replace this check.
- Exercise IndexedDB transactions, reload/resume, repeated imports, refresh reconciliation,
  username isolation, schema changes, quota failure, and competing tabs.
- End-to-end: import fixture games, complete an assessment, inspect evidence, follow a
  valid lesson link, reload, and confirm opening progress was not altered.
- Make one real-browser public API import check to verify cross-origin access and current
  response compatibility. Keep routine automated tests independent of live API uptime.

### Usability and performance

- Check small and large layouts in both built-in themes, keyboard operation, accessible
  progress announcements, evidence navigation, and reduced motion.
- Measure engine asset load, peak memory, per-game time, cancellation responsiveness,
  and completion of a 50-game reference batch on desktop and a representative phone.
- The interface must remain usable during import and analysis; cancellation must stop
  worker activity within one second. Present completed-game progress rather than an
  unmeasured time estimate.
- Run the repository's unit, type, lint, build, and relevant end-to-end checks for the
  eventual implementation. Record evidence and limitations in the implementation review.

## 12. Engine distribution and project constraints

Stockfish.js is a GPLv3 browser port with a lite single-threaded build. The implementation
must pin the exact release and asset hashes, retain notices and license text, and provide
corresponding source and build material for the distributed engine through a documented
download path. Verify the chosen release's distribution requirements before shipping.
Include engine attribution in the existing credits page. This design does not assert
that worker separation alone determines the licensing of the rest of the application.

Before writing Next.js implementation code, read the relevant installed framework guides
as required by `AGENTS.md`. The route-handler guide was inspected while drafting this
spec; the selected design currently introduces no server API route. Implementation must
also consult the installed client/server boundary and asset-serving guidance.

## 13. References and workflow handoff

- [Chess.com Published-Data API](https://www.chess.com/news/view/published-data-api)
  supplies public archives and documents caching and rate limiting.
- [Stockfish.js repository](https://github.com/nmrugg/stockfish.js) documents browser engine
  variants; [license text](https://github.com/nmrugg/stockfish.js/blob/master/Copying.txt).
- Existing design: `docs/superpowers/specs/2026-09-14-workspace-trainer-design.md`.
- Existing integration points: `lib/chess/position.ts`, `lib/course/`,
  `lib/training/scheduler.ts`, `components/board/Board.tsx`, `components/nav/TopBar.tsx`.

This is one assessment feature with separable internal modules, not a commitment to
build the later tactical trainer, content pipeline, or server platform in the same plan.

The next stage is user review of this written specification. After approval, invoke
Superpowers writing-plans to produce a separate implementation plan. Implementation
starts only after that plan is reviewed and its execution method is selected.
