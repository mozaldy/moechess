# Chess.com Assessment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give beginner chess players an account-free assessment of recent Chess.com rapid games, with verified tactical examples and concrete study priorities.

**Architecture:** A browser importer selects games; a worker-backed engine and conservative detectors produce evidence; IndexedDB checkpoints support resumption. A plain TypeScript controller derives recommendations and feeds a new Assessment route. Existing opening progress is independent, and the engine interface permits a later server implementation.

**Tech Stack:** Existing Next.js 16.3.5, React 19.2.8, TypeScript, chess.js 1.4.0, PGN parser, Vitest, and Playwright; a pinned Stockfish.js lite single-threaded WASM engine; native IndexedDB and Web Locks.

**Spec:** [Approved design](../specs/2026-09-20-chesscom-assessment-design.md). Read both documents before execution.

**Status:** Written plan awaiting user review and execution-method selection. No implementation tasks have been executed.

## Global Constraints

- "No Moechess account or cross-device synchronization. Store results in this browser."
- "Completed, rated, standard rapid games, including wins, losses, and draws, with the entered player on either side."
- "Limit scanning to the previous 12 months including the current UTC month."
- "Stop when 50 valid eligible games have been collected or that window is exhausted."
- "Use a 30-second request timeout." Retry network/server errors twice, after 2 and 5 seconds; stop automatic requests on 429. Manual refresh cooldown: 60 seconds.
- "Use fixed node budgets rather than device-dependent time alone for comparable analysis." Verification: 200,000 then 400,000 nodes; watchdog: 15 seconds per search; cancellation: at most one second.
- "Material evidence must resolve within six plies of the tactical move"; material threshold: 100 centipawns and one net material point; piece values: pawn 1, knight/bishop 3, rook 5, queen 9.
- "At least three distinct affected games: eligible recurring study priority." "Display at most three priorities."
- "Never mutate opening-training progress during assessment."
- "Position-only course keys are insufficient for engine caching."
- "The browser importer calls the fixed Chess.com public API origin directly." No proxy, scraping, server analysis, or account system in this plan.
- "Use a pinned lite, single-threaded Stockfish.js WebAssembly build in a dedicated worker."
- "A browser-wide Web Lock for assessment processing prevents two tabs from committing competing jobs."
- "Public records are not proof of ownership of a username."
- Preserve themes, styling hooks, accessibility, existing routes, and the distinction between a course deviation and an actual mistake.
- Before Next.js edits, read relevant installed documentation under `node_modules/next/dist/docs/`, as required by `AGENTS.md`.
- Keep worker initialization out of render/module evaluation and stop it on navigation/unmount. Do not install or scaffold product code until this plan is approved.
- Use the using-git-worktrees skill at execution time before implementation; do not discard unrelated local changes. Commit each task after its relevant checks pass.

## Review Focus

1. Switching username or deleting a player while an old worker finishes must never resurrect or misattribute results. Pin in Task 8's generation and transaction tests.
2. An API archive URL, game link, or PGN comment containing hostile text must not turn into an arbitrary request, executable link, or rendered HTML. Pin in Tasks 2, 3, and 10.
3. Corrected game metadata/PGNs and a refreshed 50-game selection must invalidate only incompatible evidence and must not inflate counts. Pin in Tasks 2, 4, and 8.
4. Browser suspension, Strict Mode remount, and competing tabs must release or respect the lock and offer safe resumption. Pin in Tasks 8, 9, and 11.
5. A legal engine line is not necessarily valid teaching evidence: bound scores, omitted recaptures, alternative mates, and losing sacrifices must be rejected or excluded. Pin in Tasks 1, 5, and 6.

## File map and sequencing

The eleven tasks are sequential because each consumes the preceding contracts. Tasks 3
and 4 could technically be implemented independently after Task 2, but this plan does
not request concurrent implementation. Keep each file focused; no unrelated refactoring.

| Task | Files owned | Deliverable |
| --- | --- | --- |
| 1 | `lib/analysis/engine/{types,uci,browser-engine}.ts`, engine asset script/manifest, integration probes | Real cancellable engine adapter and verified browser prerequisites |
| 2 | `lib/assessment/{types,policy}.ts`, `lib/import/chesscom/{normalize,history}.ts`, fixtures | Validated games and shared assessment contracts |
| 3 | `lib/import/chesscom/{client,import-games}.ts` | Bounded, sequential, resumable newest-game import |
| 4 | `lib/assessment/storage/{types,memory,indexeddb,validate}.ts` | Atomic checkpoints and player isolation |
| 5 | `lib/analysis/tactics/{types,candidates,geometry}.ts` | Legal tactical candidates and checked fixtures |
| 6 | `lib/analysis/tactics/{verify,material,analyze-game}.ts` | Conservative verified findings |
| 7 | `lib/assessment/{recommendations,explanations}.ts`, `lib/analysis/openings/match.ts` | Evidence-backed priorities and course matches |
| 8 | `lib/assessment/{controller,locks}.ts` | Import/analyze/refresh/resume lifecycle |
| 9 | `app/assessment/page.tsx`, `components/assessment/{AssessmentClient,ImportForm,AssessmentStatus,PriorityList,OpeningSummary}.tsx`, hook/nav/styles | Accessible assessment UI |
| 10 | `components/assessment/EvidenceViewer.tsx`, `lib/assessment/replay.ts`, board/Explore integration | Evidence replay and usable deep links |
| 11 | Browser tests, validation record, documentation | End-to-end evidence and release checks |

Test files below are additional files owned by their respective task. `tests/unit/`
already runs in jsdom; real IndexedDB/Worker/Web Locks tests belong in Playwright.
No fake browser-database dependency is necessary.

### Task 1: Establish real browser engine and import prerequisites

**Files**
- Create: `lib/analysis/engine/types.ts`, `lib/analysis/engine/uci.ts`, `lib/analysis/engine/browser-engine.ts`.
- Create: `scripts/vendor-stockfish.mjs`, `public/engines/stockfish/manifest.json`, versioned JS/WASM/license/source assets in `public/engines/stockfish/`.
- Modify: `package.json`, `pnpm-lock.yaml`, `app/credits/page.tsx`.
- Create: `tests/unit/lib/analysis/engine.test.ts`, `tests/e2e/assessment-prerequisites.spec.ts`, `docs/stockfish-distribution.md`.

**Interfaces — define in `engine/types.ts`**

```ts
export type Side = "white" | "black";
export type UciMove = string;
export interface GameHistory { initialFen: string; moves: UciMove[] }
export type Score = { kind: "cp" | "mate"; value: number; perspective: Side };
export interface SearchRequest {
  history: GameHistory;
  perspective: Side;
  nodes: number;
  rootMoves?: UciMove[];
}
export interface SearchResult {
  score: Score;
  bound: "exact" | "lower" | "upper";
  pv: UciMove[];
  nodes: number;
  depth: number;
}
export interface AnalysisEngine {
  readonly buildId: string;
  init(signal: AbortSignal): Promise<void>;
  analyze(request: SearchRequest, signal: AbortSignal): Promise<SearchResult>;
  cancel(): Promise<void>;
  dispose(): void;
}
```

Produces `parseInfo(line: string, rootSide: Side, perspective: Side): SearchResult | null`,
`positionCommand(history: GameHistory): string`, `engineCacheKey(buildId: string, request: SearchRequest): string`,
and `createBrowserEngine(workerFactory?: () => Worker): AnalysisEngine`.

- [ ] **Step 1: Add parser and history-identity tests before implementing the adapter.**

```ts
test("normalizes black-root scores and retains bounds", () => {
  const line = "info depth 12 nodes 200000 score cp 220 lowerbound pv a8a1 g1h2";
  expect(parseInfo(line, "black", "white")).toMatchObject({
    score: { kind: "cp", value: -220, perspective: "white" }, bound: "upper",
  });
  expect(parseInfo("info string downloading", "white", "white")).toBeNull();
});
test("does not share evaluations across repetition histories", () => {
  const base = { initialFen: START_FEN, moves: [] };
  const repeated = { ...base, moves: ["g1f3", "g8f6", "f3g1", "f6g8"] };
  const request = { history: base, perspective: "white" as const, nodes: 200000 };
  expect(engineCacheKey("fixture", request)).not.toBe(
    engineCacheKey("fixture", { ...request, history: repeated }),
  );
});
```

Import `START_FEN` from the existing chess wrapper. Add mate-score, malformed-token,
multi-line output, missing PV, bestmove-without-info, and terminal-position cases.

- [ ] **Step 2: Run `pnpm test tests/unit/lib/analysis/engine.test.ts`.** Expect failure
  because the new adapter/parser modules do not exist, not a broken test configuration.

- [ ] **Step 3: Pin and stage the browser engine with its provenance.**

The upstream package inspected during planning reports `stockfish` version `19.0.0`.
Verify the published package before installing; do not silently substitute a new major.

```bash
pnpm view stockfish@19.0.0 version dist.integrity dist.tarball gitHead --json
pnpm add -D -E stockfish@19.0.0
```

`vendor-stockfish.mjs` must copy only the lite single-threaded JS/WASM pair, preserve
the companion filename relationship, and write SHA-256 hashes, release, source revision,
and asset URLs into the manifest. It must fail on missing/ambiguous files or absent
source provenance. Use Node's built-in APIs rather than shell interpolation:

```js
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const pkg = JSON.parse(await readFile("node_modules/stockfish/package.json", "utf8"));
if (pkg.version !== "19.0.0") throw new Error("Unexpected Stockfish package version");
```

The script's interface is `node scripts/vendor-stockfish.mjs --source <archive>` for
initial vendoring and `node scripts/vendor-stockfish.mjs --check` to verify existing
manifest hashes without writes. Obtain the source archive at the package's verified
revision, including the exact network/build inputs needed by that release. Include
the source archive, license, notices, and reproducible build instructions in the
distribution path documented by `docs/stockfish-distribution.md`; no mutable `master`
link is an acceptable substitute for corresponding source. If the chosen package's
provenance cannot be established, stop this task with a concrete blocker. Add the
engine and source-download links to Credits. Do not make app-wide licensing claims.

- [ ] **Step 4: Implement the serial UCI adapter with an explicit lifecycle.**

Use the upstream worker directly (`new Worker(manifest.workerUrl)`, a classic worker).
Handshake `uci` → `uciok`, set `Hash` to 16 MB and `MultiPV` to 1, then `isready` →
`readyok`. Use a 30-second initialization timeout distinct from the 15-second search
watchdog. Permit one active search. Separate every aborted/restarted worker by a
generation token; raw UCI messages have no request ID, so never attach a late response
to a new search on an un-drained worker.

```ts
export function positionCommand(history: GameHistory): string {
  return `position fen ${history.initialFen}` +
    (history.moves.length ? ` moves ${history.moves.join(" ")}` : "");
}
export function engineCacheKey(buildId: string, request: SearchRequest): string {
  return JSON.stringify([buildId, request.history.initialFen, request.history.moves,
    request.perspective, request.nodes, [...(request.rootMoves ?? [])].sort()]);
}
```

Validate history/FEN/UCI tokens before constructing commands. Send `ucinewgame`, clear
hash, and await ready before independent searches so accidental cache warming does not
change the effective budget. Then send position and `go nodes N`, adding `searchmoves`
only for constrained roots. Resolve only on bestmove with a valid corresponding score
and PV. Reject bound-only/missing results as inconclusive at the verifier boundary.
On abort, send stop, reject the search, and dispose the worker after acknowledgement
or one second; `init()` creates a fresh worker for a later run. Watchdog throws a typed
`EngineError` with code `timeout`; also define `init`, `protocol`, `aborted`, `crashed`.

- [ ] **Step 5: Add deterministic lifecycle tests using an injected worker factory.**

```ts
test("terminates an engine that never acknowledges stop", async () => {
  vi.useFakeTimers();
  const terminate = vi.fn();
  const listeners: Array<(event: MessageEvent) => void> = [];
  const worker = {
    terminate, postMessage: vi.fn(),
    addEventListener: (type: string, fn: (e: MessageEvent) => void) => {
      if (type === "message") listeners.push(fn);
    },
    removeEventListener: vi.fn(),
  } as unknown as Worker;
  const engine = createBrowserEngine(() => worker);
  const init = engine.init(new AbortController().signal);
  for (const line of ["uciok", "readyok"]) {
    listeners.forEach(fn => fn(new MessageEvent("message", { data: line })));
    await Promise.resolve();
  }
  await init;
  const canceled = engine.cancel();
  await vi.advanceTimersByTimeAsync(1000);
  await canceled;
  expect(terminate).toHaveBeenCalled();
  vi.useRealTimers();
});
```

Also test worker error, abort during initialization, serialized searches, and stale
generation output. Attach rejection expectations before triggering aborts.

- [ ] **Step 6: Add a real-browser prerequisite test.** Run the engine handshake and a
  fixed mate from the existing home route with Playwright `page.evaluate`; no test-only
  public page is needed. The test creates `new Worker(workerUrl)` and waits for UCI
  messages using the manifest URL and a bounded timeout. Assert it reports mate 1 for
  `7k/8/5KQ1/8/8/8/8/8 w - - 0 1` and that the PV is legal.

The opt-in public API check is independent of normal CI:

```ts
test("public game import is readable from this origin @live", async ({ page }) => {
  test.skip(process.env.MOECHESS_LIVE_API !== "1", "Opt-in network integration check");
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const r = await fetch("https://api.chess.com/pub/player/hikaru/games/archives", {
      credentials: "omit", signal: AbortSignal.timeout(30000),
    });
    return { status: r.status, body: await r.json() };
  });
  expect(result.status).toBe(200);
  expect(Array.isArray(result.body.archives)).toBe(true);
});
```

Extend that check with one returned, validated monthly URL so both endpoint shapes
are verified. Do not infer CORS from a curl success. A blocked real-browser response
requires reporting the actual result and revisiting the direct-import design.

- [ ] **Step 7: Run targeted checks and commit the independent adapter.**

```bash
pnpm test tests/unit/lib/analysis/engine.test.ts
node scripts/vendor-stockfish.mjs --check
pnpm e2e tests/e2e/assessment-prerequisites.spec.ts --grep-invert @live
MOECHESS_LIVE_API=1 pnpm e2e tests/e2e/assessment-prerequisites.spec.ts --grep @live
git diff --check
```

Expected: parser/lifecycle and real engine checks pass; record live API result separately.
Commit only task-owned files with `feat: add browser analysis engine and integration checks`.

### Task 2: Normalize eligible games and define assessment records

**Files**
- Create: `lib/assessment/types.ts`, `lib/assessment/policy.ts`, `lib/import/chesscom/normalize.ts`, `lib/import/chesscom/history.ts`.
- Create: `tests/fixtures/assessment.ts`, `tests/unit/lib/import/normalize.test.ts`.

**Interfaces**
- Consumes: `GameHistory`, `Score`, `SearchResult`, `Side` from Task 1 and the existing chess/PGN libraries.
- Produces: `normalizeGame(raw: unknown, playerKey: string): Promise<NormalizedGameResult>`, `normalizeUsername(input: string): string`, `historyBefore(game: ImportedGame, ply: number): GameHistory`, and the following shared types.

```ts
export type Theme = "hanging" | "mate-one" | "fork";
export type Direction = "missed" | "allowed";
export interface ImportedGame {
  playerKey: string; id: string; url: string; fingerprint: string;
  pgn: string; history: GameHistory; sans: string[]; endTime: number;
  side: Side; white: string; black: string; whiteRating?: number; blackRating?: number;
  whiteResult: string; blackResult: string; timeControl: string;
  opening?: { label: string; url?: string }; clocks: Record<number, number>;
}
export type NormalizedGameResult =
  | { kind: "game"; game: ImportedGame }
  | { kind: "skip"; reason: "ineligible" | "invalid" | "custom-start" };
export interface Finding {
  id: string; gameId: string; playerKey: string; ply: number;
  theme: Theme; direction: Direction; side: Side; beforeFen: string; afterFen: string;
  played: string; recommended: string; playedLine: string[]; recommendedLine: string[];
  tacticalPly: number; targets: string[]; consequence: { kind: "mate" | "material"; gain: number };
  executed: boolean; lowTime: boolean;
  verification: { first: VerificationPass; second: VerificationPass };
}
export interface VerificationPass {
  best: SearchResult; played: SearchResult; tactic: SearchResult;
}
export interface OpeningMatch {
  gameId: string; label: string; source: "chesscom" | "course" | "unknown";
  courseSlug?: string; nodeId?: string; lineIds: string[]; side: Side;
}
export interface GameAnalysis {
  playerKey: string; gameId: string; fingerprint: string; signature: string;
  findings: Finding[]; exclusions: Record<string, number>; openings: OpeningMatch[];
  completedAt: string;
}
export interface ImportCursor {
  months: string[]; nextMonth: number; seenIds: string[];
  windowStart: string; windowEnd: string; invalid: number; ineligible: number;
}
export interface Assessment {
  id: string; playerKey: string; signature: string; selectedIds: string[];
  state: "importing" | "ready" | "analyzing" | "paused" | "complete" | "failed";
  coverage: "partial" | "complete"; cursor: ImportCursor;
  completedIds: string[]; reason?: string; retryAt?: string;
  createdAt: string; updatedAt: string;
}
export interface PlayerRecord {
  key: string; displayName: string; lastImportAt?: string; refreshAfter?: string;
}
export interface PlayerSnapshot {
  player: PlayerRecord;
  current: Assessment | null; draft: Assessment | null;
  games: ImportedGame[]; analyses: GameAnalysis[];
}
```

`policy.ts` exports `ASSESSMENT_POLICY` with the exact global numeric limits and
`analysisSignature(buildId: string): string`, incorporating budgets and detector/template
policy versions. Keep source records JSON-serializable; store dates as ISO strings and
source endTime as epoch seconds. UCI lines are stored as UCI, converted to SAN for display.

- [ ] **Step 1: Add normalization tests and a complete raw-record fixture factory.**

```ts
// tests/fixtures/assessment.ts
export function rawGame(overrides: Record<string, unknown> = {}) {
  return {
    uuid: "game-1", url: "https://www.chess.com/game/live/1001",
    pgn: '[White "learner"]\n[Black "opponent"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1',
    rated: true, rules: "chess", time_class: "rapid", time_control: "600",
    end_time: 1789862400,
    white: { username: "learner", rating: 900, result: "checkmated" },
    black: { username: "opponent", rating: 950, result: "win" },
    ...overrides,
  };
}
test("accepts a completed loss and normalizes identity", async () => {
  const r = await normalizeGame(rawGame(), normalizeUsername("  Learner  "));
  expect(r.kind).toBe("game");
  if (r.kind !== "game") throw new Error("Expected fixture game");
  expect(r.game.history.moves).toEqual(["f2f3", "e7e5", "g2g4", "d8h4"]);
  expect(r.game.side).toBe("white");
});
test("rejects untrusted game links", async () => {
  expect(await normalizeGame(rawGame({ url: "javascript:alert(1)" }), "learner"))
    .toMatchObject({ kind: "skip", reason: "invalid" });
});
```

Also assert unrated/bullet/ongoing/custom-start exclusion, black-player identity,
comments containing HTML remaining inert, missing optional opening/clock fields,
promotion and en-passant mainlines, source-ID fallback, corrected PGN fingerprint
changes, and ignored API accuracy values. Include invalid SAN after a legal prefix.

- [ ] **Step 2: Run `pnpm test tests/unit/lib/import/normalize.test.ts` and confirm the new behavior fails.**

- [ ] **Step 3: Implement field validation, mainline replay, and deterministic hashing.**

Normalize usernames by trimming and lowercase; reject empty strings, controls, slash,
backslash, and URL-shaped inputs. Accept only HTTPS game/opening links on Chess.com's
expected host and path patterns. Do not copy arbitrary HTML or metadata into explanations.
Require result not `*`, completion metadata, matching PGN/API player identity, rated
standard rapid, and normal initial FEN. Reject contradictory completion/result fields.
Use chess.js `loadPgn` and verbose mainline history for legal moves; use the existing
PGN parser for clock annotations without importing the filesystem course loader.

```ts
export function historyBefore(game: ImportedGame, ply: number): GameHistory {
  if (!Number.isInteger(ply) || ply < 0 || ply > game.history.moves.length) {
    throw new RangeError("Invalid game ply");
  }
  return { initialFen: game.history.initialFen, moves: game.history.moves.slice(0, ply) };
}
```

Build the content fingerprint from canonical JSON of mainline, initial position,
player identities, completion/results, time control, source opening and parsed clocks.
Hash with browser `crypto.subtle.digest("SHA-256", encoded)`; do not include import time
or engine version. Validate finite positive times/ratings and discard invalid clocks.

- [ ] **Step 4: Export `fixtureGame(overrides?: Partial<ImportedGame>): ImportedGame` in the same fixture file.**
  Give it the literal legal Fool's Mate mainline above, `START_FEN`, normalized metadata,
  `fingerprint: "fixture-v1"`, and empty clocks. Fixtures must not call the normalizer
  whose correctness their tests are measuring. This factory is used by later tasks.

- [ ] **Step 5: Run targeted tests and `pnpm typecheck`; commit task-owned files with `feat: normalize public games for assessment`.**

### Task 3: Import the newest eligible games with bounded retries

**Files**
- Create: `lib/import/chesscom/client.ts`, `lib/import/chesscom/import-games.ts`.
- Create: `tests/unit/lib/import/client.test.ts`, `tests/unit/lib/import/import-games.test.ts`.

**Interfaces**
- Consumes: Task 2 normalization, cursor, games, and policy.
- Produces: `ChessComClient` with `archives(username: string, signal: AbortSignal): Promise<string[]>` and `month(username: string, month: string, signal: AbortSignal): Promise<unknown[]>`.
- `createChessComClient(fetcher?: typeof fetch): ChessComClient`.
- `importGames(client: ChessComClient, input: { playerKey: string; now: Date; signal: AbortSignal; cursor?: ImportCursor; selected?: ImportedGame[] }, checkpoint: (result: ImportBatch) => Promise<void>): Promise<ImportBatch>`.
- `ImportBatch` is `{ games: ImportedGame[]; cursor: ImportCursor; coverage: "partial" | "complete" }`.
- `ImportError` carries code `not-found | network | timeout | rate-limit | invalid-response | aborted`, plus optional `retryAt` ISO string.

- [ ] **Step 1: Write import ordering and failure-recovery tests.**

```ts
test("retries the failed newest month before looking further back", async () => {
  const seen: string[] = [];
  const client: ChessComClient = {
    archives: async () => ["2026/08", "2026/09"],
    month: async (_u, month) => { seen.push(month); throw new ImportError("network"); },
  };
  const checkpoints: ImportBatch[] = [];
  await expect(importGames(client, {
    playerKey: "learner", now: new Date("2026-09-20T00:00:00Z"),
    signal: new AbortController().signal,
  }, async batch => { checkpoints.push(batch); })).rejects.toMatchObject({ code: "network" });
  expect(seen).toEqual(["2026/09"]);
  expect(checkpoints.at(-1)?.cursor.nextMonth).toBe(0);
});
```

Also test exactly 50 valid games among invalid/newer records, same-time ordering, UTC
January/year rollover, duplicate UUID/URL, cancellation during delay, 429 with/without
readable Retry-After, and an archive URL redirected to a different host. Check no two
month requests overlap using a deferred fetch mock.

- [ ] **Step 2: Run `pnpm test tests/unit/lib/import/client.test.ts tests/unit/lib/import/import-games.test.ts`; confirm new tests fail.**

- [ ] **Step 3: Implement fixed-origin fetch and bounded retry logic.**

```ts
const ORIGIN = "https://api.chess.com";
export function monthUrl(username: string, month: string): string {
  if (!/^\d{4}\/(0[1-9]|1[0-2])$/.test(month)) throw new ImportError("invalid-response");
  return `${ORIGIN}/pub/player/${encodeURIComponent(username)}/games/${month}`;
}
```

Validate archive URLs into `YYYY/MM` tokens and rebuild destinations using `monthUrl`;
never follow an arbitrary archive URL. Fetch with credentials omitted, redirect error,
normal browser cache, and linked timeout/caller abort signals. Distinguish cancellation
from retryable network failure. Parse JSON shape explicitly. Treat nonretryable 4xx as
terminal; 404 becomes not-found, 429 rate-limit. Clamp retry dates to at least now, retain
the actual later date, and do not loop automatically on 429. Abortable delays must clear
timers/listeners when they settle.

- [ ] **Step 4: Implement newest-month selection and checkpoints.**

```ts
const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
const windowEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
```

Use those boundaries for both archive selection and end_time validation; exclude future
end times relative to the captured `now`. Emit an initial cursor checkpoint before the
first month, then after each completed month. Only advance nextMonth after that month's
records have been processed successfully. Normalize in batches of ten records, yielding
with `await new Promise(resolve => setTimeout(resolve, 0))` between batches and checking
abort. Preserve valid selected records on cancellation/error; do not mark coverage
complete until the selection reaches 50 or the in-window months are exhausted.

- [ ] **Step 5: Run the focused tests and typecheck; commit `feat: import recent Chess.com rapid games with resume support`.**

### Task 4: Store player-scoped drafts and atomic game checkpoints

**Files**
- Create: `lib/assessment/storage/types.ts`, `memory.ts`, `indexeddb.ts`, `validate.ts`.
- Create: `tests/unit/lib/assessment/storage.test.ts`, `tests/e2e/assessment-storage.spec.ts`, `tests/e2e/helpers/assessment-bundle.ts`.

**Interfaces**

```ts
export type AssessmentStoreStatus =
  | { kind: "ok" }
  | { kind: "unavailable" | "quota" | "corrupt" | "newer-schema"; message: string };
export interface AssessmentStore {
  status(): AssessmentStoreStatus;
  listPlayers(): Promise<PlayerRecord[]>;
  load(playerKey: string): Promise<PlayerSnapshot | null>;
  saveDraft(snapshot: PlayerSnapshot): Promise<void>;
  commitGame(assessmentId: string, analysis: GameAnalysis): Promise<void>;
  saveState(assessment: Assessment): Promise<void>;
  promoteDraft(playerKey: string, assessmentId: string): Promise<void>;
  deletePlayer(playerKey: string): Promise<void>;
  close(): void;
}
```

Produces `MemoryAssessmentStore` and `openAssessmentStore(factory?: IDBFactory, databaseName?: string): Promise<AssessmentStore>`.
New-schema/unavailable stores expose status and reject writes; the controller explicitly
chooses a new MemoryAssessmentStore for session-only work. Do not silently drop writes.

- [ ] **Step 1: Add contract tests for the memory store and literal snapshot fixtures.**

Add `fixtureSnapshot(game = fixtureGame()): PlayerSnapshot` to `tests/fixtures/assessment.ts`
with a current ready assessment selecting that game, an empty completedIds list, full
source coverage, signature `analysisSignature("fixture-engine")`, and no draft. Add
`fixtureAnalysis(game = fixtureGame()): GameAnalysis` with matching identity/signature,
no findings, empty exclusions/openings, and a fixed ISO completion timestamp.

```ts
test("commits findings and completion together, once", async () => {
  const store = new MemoryAssessmentStore();
  const snapshot = fixtureSnapshot();
  snapshot.draft = snapshot.current;
  snapshot.current = null;
  await store.saveDraft(snapshot);
  await store.commitGame(snapshot.draft!.id, fixtureAnalysis());
  await store.commitGame(snapshot.draft!.id, fixtureAnalysis());
  const loaded = await store.load("learner");
  expect(loaded?.draft?.completedIds).toEqual(["game-1"]);
  expect(loaded?.analyses).toHaveLength(1);
});
```

Test signature/fingerprint mismatch rejection, player isolation, stale checkpoint after
deletion, canceled refresh preserving current, and successful promotion pruning only
unreferenced records belonging to that player. No call can recreate a missing assessment
implicitly through `commitGame`.

- [ ] **Step 2: Run `pnpm test tests/unit/lib/assessment/storage.test.ts` and observe the expected missing implementation failure.**

- [ ] **Step 3: Implement the store contract in memory, then IndexedDB.**

Use database `moechess-assessment`, version 1. Object stores: `players` keyed by key;
`assessments` keyed by id with playerKey index and current/draft references on a private
player envelope; `games` keyed by `[playerKey,id]`; `analyses` keyed by
`[playerKey,gameId,fingerprint,signature]`. Use normal IDB transactions; do not await
network/engine work inside a transaction.

```ts
const tx = db.transaction(["assessments", "games", "analyses"], "readwrite");
const assessments = tx.objectStore("assessments");
const request = assessments.get(assessmentId);
request.onsuccess = () => {
  const assessment = request.result as Assessment | undefined;
  if (!assessment || assessment.playerKey !== analysis.playerKey ||
      assessment.signature !== analysis.signature ||
      !assessment.selectedIds.includes(analysis.gameId)) { tx.abort(); return; }
  const gameRequest = tx.objectStore("games").get([analysis.playerKey, analysis.gameId]);
  gameRequest.onsuccess = () => {
    const game = gameRequest.result as ImportedGame | undefined;
    if (!game || game.fingerprint !== analysis.fingerprint) { tx.abort(); return; }
    tx.objectStore("analyses").put(analysis);
    assessments.put({ ...assessment,
      completedIds: [...new Set([...assessment.completedIds, analysis.gameId])],
      updatedAt: analysis.completedAt });
  };
};
```

Resolve promises on transaction complete, reject on error/abort, and never update in-memory status to saved
before commit. Validate loaded records and isolate corrupt analyses so their games become
unfinished. Newer database versions are opened for safe read access without schema writes;
if records cannot be interpreted, preserve them and offer session-only use. Handle
`blocked`/`versionchange` by closing old handles and reporting a recoverable storage state.

- [ ] **Step 4: Exercise real IndexedDB in Playwright using a temporary bundled test entry.**

Implement `bundleBrowserEntry(source: string): Promise<string>` in the listed helper
using the existing Vite dependency:

```ts
import { build } from "vite";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
export async function bundleBrowserEntry(source: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "moechess-assessment-test-"));
  try {
    const entry = path.join(directory, "entry.ts");
    await writeFile(entry, source);
    const result = await build({ configFile: false,
      resolve: { alias: { "@": process.cwd() } },
      build: { write: false, minify: false,
        lib: { entry, formats: ["iife"], name: "AssessmentTest" } } });
    const outputs = Array.isArray(result) ? result : [result];
    const chunk = outputs.flatMap(output => "output" in output ? output.output : [])
      .find(output => output.type === "chunk");
    if (!chunk || chunk.type !== "chunk") throw new Error("Missing browser test bundle");
    return chunk.code;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
```

Use `page.addScriptTag({ content })`; injected tests may publish one test-owned Promise
on window for Playwright to await and remove it afterwards. Do not add a production
route or production global. Its entry imports `openAssessmentStore` and runs the same
contract against a random database name (default remains `moechess-assessment`).
Assert transaction abort leaves both old
analyses and completedIds unchanged, then reload and check persistence. Inject quota
errors at the store boundary for controller tests; do not attempt to fill the real disk.

- [ ] **Step 5: Run unit contracts and `pnpm e2e tests/e2e/assessment-storage.spec.ts`; commit `feat: persist assessment drafts and atomic checkpoints`.**

### Task 5: Detect legal candidates and establish a tactical fixture corpus

**Files**
- Create: `lib/analysis/tactics/types.ts`, `candidates.ts`, `geometry.ts`.
- Create: `tests/fixtures/tactics.ts`, `tests/unit/lib/analysis/candidates.test.ts`.
- Create: `docs/assessment-fixtures.md` documenting the chess reasoning behind each fixture.

**Interfaces**
- Consumes: `GameHistory`, `Theme`, `Direction`, `Side`, chess.js legal move generation.
- Produces: `mateMoves(history: GameHistory): string[]`, `findCandidates(history: GameHistory, played: string, side: Side): Candidate[]`, `replayHistory(history: GameHistory): Chess`, `toUci(move: Move): string`.
- `Candidate` is defined below. Candidates are internal hypotheses, never UI findings.

```ts
export interface Candidate {
  theme: Theme; direction: Direction; history: GameHistory;
  side: Side; played: string; tactic: string; targets: string[];
  tacticalPly: 0 | 1;
}
export interface TacticalFixture {
  name: string; initialFen: string; moves: string[]; played: string;
  theme: Theme; direction: Direction; expected: "verified" | "rejected";
  explanation: string;
}
```

- [ ] **Step 1: Add fixed-position tests for mate, hanging pieces, and forks.**

```ts
test("finds a legal immediate mate", () => {
  expect(mateMoves({ initialFen: "7k/8/5KQ1/8/8/8/8/8 w - - 0 1", moves: [] }))
    .toContain("g6g7");
});
test("identifies a knight fork without declaring it a finding", () => {
  const history = { initialFen: "8/4k3/1q6/8/8/2N5/8/4K3 w - - 0 1", moves: [] };
  const candidates = findCandidates(history, "c3b1", "white");
  expect(candidates).toEqual(expect.arrayContaining([
    expect.objectContaining({ theme: "fork", direction: "missed", tactic: "c3d5",
      targets: expect.arrayContaining(["e7", "b6"]) }),
  ]));
});
test("playing mate is not a missed-mate candidate", () => {
  const history = { initialFen: "7k/8/5KQ1/8/8/8/8/8 w - - 0 1", moves: [] };
  expect(findCandidates(history, "g6g7", "white").some(c => c.theme === "mate-one")).toBe(false);
});
```

Add literal fixture entries for:

| Case | Position/history | Played move | Expected evidence |
| --- | --- | --- | --- |
| Missed mate | `7k/8/5KQ1/8/8/8/8/8 w - - 0 1` | `g6h7` | `g6g7` mates; played queen can be captured |
| Allowed mate | Standard start, `f2f3 e7e5` | `g2g4` | `d8h4` mates |
| Missed hanging queen | `q5k1/8/8/8/8/8/8/R5K1 w - - 0 1` | `g1h2` | `a1a8` wins queen |
| Allowed hanging queen | `r5k1/8/8/8/8/8/8/1Q4K1 w - - 0 1` | `b1a1` | `a8a1` wins queen |
| Missed knight fork | `8/4k3/1q6/8/8/2N5/8/4K3 w - - 0 1` | `c3b1` | `c3d5` checks and attacks b6 |
| Allowed knight fork | `4k3/8/2n5/8/8/8/4K3/1Q6 w - - 0 1` | `b1b3` | `c6d4` checks e2 and attacks b3 |

The allowed-fork knight on d4 checks e2 and attacks b3; the queen cannot capture it.
Verify all table moves with chess.js, and hand-check each claimed line in the board.

Negative fixtures include an already played winning tactic, a recaptured attacker,
a pinned apparent attacker, a hanging-piece capture that permits immediate mate,
an unavoidable pre-existing loss, and a move retaining another forced mate. Include
black-to-move equivalents, promotions, and en passant. Expected labels must come from
the recorded chess explanation, not from the detector's current output.

- [ ] **Step 2: Run `pnpm test tests/unit/lib/analysis/candidates.test.ts` and confirm the expected failures.**

- [ ] **Step 3: Implement replay and exact mate enumeration.**

```ts
export function toUci(move: Move): string {
  return move.from + move.to + (move.promotion ?? "");
}
export function replayHistory(history: GameHistory): Chess {
  const board = new Chess(history.initialFen);
  for (const move of history.moves) {
    board.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
  }
  return board;
}
export function mateMoves(history: GameHistory): string[] {
  const board = replayHistory(history);
  if (board.isGameOver()) return [];
  const mates: string[] = [];
  for (const move of board.moves({ verbose: true })) {
    board.move(move);
    if (board.isCheckmate()) mates.push(toUci(move));
    board.undo();
  }
  return mates.sort();
}
```

Do not shortcut through FEN reconstruction when repetition determines terminal state.

- [ ] **Step 4: Implement candidate enumeration separately from verification.**

For missed hanging-piece opportunities enumerate legal captures of N/B/R/Q; for forks
enumerate legal moves whose resulting attacking piece geometrically attacks at least
two enemy pieces, including the king. Exclude the played move from missed candidates.
Run the same enumeration after the played move for allowed candidates. Check legal
king attack with actual check state. A helper `attackedTargets(board: Chess, square: string): string[]`
in geometry.ts computes pawn/knight/king offsets and sliding rays stopping at the first
piece; this is a geometric filter only. Pinned/ineffective attacks are rejected during
verification rather than by changing the side-to-move on a board arbitrarily.

```ts
const unique = new Map<string, Candidate>();
for (const candidate of candidates) {
  const key = [candidate.theme, candidate.direction, candidate.tactic,
    [...candidate.targets].sort().join(",")].join(":");
  unique.set(key, candidate);
}
return [...unique.values()];
```

Put the loop into `findCandidates` after collecting candidates. Verify the passed side
matches the decision's side-to-move. Skip terminal positions. The allowed-threat baseline
and whether a fork actually wins are deferred to Task 6's explicit verifier, not assumed.

- [ ] **Step 5: Run candidate tests and typecheck; commit `feat: enumerate beginner tactical candidates with chess fixtures`.**

### Task 6: Verify tactical consequences and produce complete game analyses

**Files**
- Create: `lib/analysis/tactics/verify.ts`, `material.ts`, `analyze-game.ts`.
- Create: `tests/unit/lib/analysis/verify.test.ts`, `material.test.ts`, `analyze-game.test.ts`.
- Extend: `tests/fixtures/tactics.ts`, `tests/e2e/assessment-prerequisites.spec.ts` with real-engine tactical cases.

**Interfaces**
- Consumes: Tasks 1, 2, and 5 contracts.
- Produces `verifyCandidate(candidate: Candidate, engine: AnalysisEngine, signal: AbortSignal): Promise<VerificationResult>`.
- `VerificationResult = { kind: "verified"; finding: Omit<Finding, "id" | "gameId" | "playerKey" | "ply" | "executed" | "lowTime"> } | { kind: "rejected" | "inconclusive"; reason: string }`.
- Produces `materialBalance(board: Chess, side: Side): number`, `certifyGain(history: GameHistory, move: string, beneficiary: Side, signal: AbortSignal): Promise<MaterialCertificate>`.
- `MaterialCertificate = { kind: "gain"; gain: number; line: string[] } | { kind: "mate"; line: string[] } | { kind: "inconclusive" | "rejected"; reason: string }`.
- Produces `analyzeGame(game: ImportedGame, engine: AnalysisEngine, signature: string, signal: AbortSignal): Promise<GameAnalysis>`; openings starts empty and is populated by Task 8 using Task 7.

- [ ] **Step 1: Write false-positive tests with fixed score inputs.**

Define and export `passesMaterialGate(pass: VerificationPass): boolean` from verify.ts.
Its contract compares exact player-perspective centipawn results for best versus played;
it is only one condition of full verification.

```ts
const result = (value: number, bound: SearchResult["bound"] = "exact"): SearchResult => ({
  score: { kind: "cp", value, perspective: "white" }, bound,
  pv: ["a1a8"], nodes: 200000, depth: 12,
});
test("does not turn a bound or a small score difference into material evidence", () => {
  expect(passesMaterialGate({ best: result(200), played: result(120), tactic: result(200) })).toBe(false);
  expect(passesMaterialGate({ best: result(300, "lower"), played: result(0), tactic: result(300) })).toBe(false);
  expect(passesMaterialGate({ best: result(300), played: result(0), tactic: result(300) })).toBe(true);
});
test("includes the sacrificed attacker in material accounting", () => {
  const before = new Chess("r5k1/8/8/8/8/8/8/Q5K1 w - - 0 1");
  const original = materialBalance(before, "white");
  before.move("Qxa8+");
  expect(materialBalance(before, "white") - original).toBe(5);
  const defended = new Chess("r5k1/1b6/8/8/8/8/8/Q5K1 w - - 0 1");
  const defendedOriginal = materialBalance(defended, "white");
  defended.move("Qxa8+"); defended.move("Bxa8");
  expect(materialBalance(defended, "white") - defendedOriginal).toBe(-4);
});
```

Add full-verifier tests rejecting the apparent gain in the defended-rook fixture and
the other hand-labeled negative fixtures.

- [ ] **Step 2: Run the three new unit files and confirm failure before implementation.**

- [ ] **Step 3: Implement material accounting and bounded defensive verification.**

```ts
const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export function materialBalance(board: Chess, side: Side): number {
  const color = side === "white" ? "w" : "b";
  return board.board().flat().reduce((sum, piece) => piece
    ? sum + VALUES[piece.type] * (piece.color === color ? 1 : -1) : sum, 0);
}
export function passesMaterialGate(pass: VerificationPass): boolean {
  const { best, played, tactic } = pass;
  return [best, played, tactic].every(r => r.bound === "exact" && r.score.kind === "cp") &&
    best.score.perspective === played.score.perspective &&
    best.score.value - played.score.value >= 100;
}
```

Material difference in the signed balance changes by captured-piece value, not twice
that value. Keep promotions in the before/after accounting. `certifyGain` applies the
candidate tactical move then searches legal defenses and continuations up to six plies
including that move. Opponent nodes minimize the beneficiary's result; beneficiary
nodes choose a justified continuation. A certified gain needs a worst-case gain of at
least 1, no mate against the beneficiary, and no omitted legal recapture of the last
winning capture. A terminal draw can still be a material-saving improvement from a
losing root (for example, winning the queen to reach knight versus king); require the
root evaluation improvement and explain the saved material without claiming a won game.

End a branch when its concrete capture gain is stable: there is no legal immediate
recapture of the gaining piece, no immediate mating reply, and the engine's corresponding
line supports that consequence. This endpoint establishes the short tactical gain, not
that the side will win the game. Continue unresolved checks/recaptures to the six-ply limit.
Bound the rules search at 20,000 visited nodes, yield every 250, and return inconclusive
on exhaustion or unresolved recaptures at the horizon. This is an implementation resource
ceiling, not permission to call a truncated search proven. Order moves using the engine
PV, checks, and captures, but never omit a defensive move when certifying a forced gain.
Store the worst-case witness line. A claim too complex for this certificate is excluded.

- [ ] **Step 4: Implement both verification passes with explicit root semantics.**

For each budget, search the original history without root restriction for `best` and
with `rootMoves: [candidate.played]` for `played`. For missed tactics, `tactic` constrains
the original root to the candidate move. For allowed tactics, `tactic` starts after
the played move and constrains the opponent's move. All scores use candidate.side as
perspective, even when the opponent is to move. Validate every returned line by legal
replay and verify constrained roots actually begin with the requested move.

```ts
for (const nodes of [200000, 400000]) {
  const root = { history: candidate.history, perspective: candidate.side, nodes };
  const best = await engine.analyze(root, signal);
  const played = await engine.analyze({ ...root, rootMoves: [candidate.played] }, signal);
  const tacticalHistory = candidate.direction === "missed" ? candidate.history : {
    initialFen: candidate.history.initialFen,
    moves: [...candidate.history.moves, candidate.played],
  };
  const tactic = await engine.analyze({ ...root, history: tacticalHistory,
    rootMoves: [candidate.tactic] }, signal);
  passes.push({ best, played, tactic });
}
```

In `verifyCandidate`, initialize `const passes: VerificationPass[] = []` before this loop.
Require the claimed motif/consequence at both budgets. For missed material, the selected
tactic itself must outperform the played move by at least 100 cp, not just an unrelated
engine-best move. For allowed material, verify the opponent's concrete gain and a better
player root that avoids an equal-or-worse forced consequence. A fork's material witness
must actually win a named target through the fork; unrelated later captures do not qualify.

Mate in one uses exact `mateMoves` before/after, plus the two searches to rule out a
played alternative retaining a forced mate or an already unavoidable loss. A finite
engine search cannot prove absence of every longer mate: reject any unstable/mate-bound
case, describe accepted findings as missed immediate mating opportunities, and preserve
the spec's conservative exclusions. A beyond-one mating fork requires a legal complete
mate witness within six plies at both budgets. Never compare mate values as centipawns.

Treat engine protocol/bound ambiguity as inconclusive; rethrow abort, watchdog, crash,
and initialization errors so the controller pauses rather than completing a false-clean
game. Use the played game suffix only to label whether the opponent executed the threat.

- [ ] **Step 5: Deduplicate and checkpoint-ready game analysis.**

```ts
const precedence: Record<Theme, number> = { "mate-one": 0, fork: 1, hanging: 2 };
const byPly = new Map<number, Finding>();
for (const finding of verified) {
  const previous = byPly.get(finding.ply);
  if (!previous || precedence[finding.theme] < precedence[previous.theme]) {
    byPly.set(finding.ply, finding);
  }
}
```

Inside analyzeGame, iterate only the assessed player's decisions; create finding IDs
from game ID, fingerprint, and zero-based decision ply. Fill before/after FEN from
history, lowTime only from valid clock annotations below 30 seconds, and executed by
matching the recorded opponent move to the verified tactic. Count exclusions by reason.
Yield between decisions. Return one completed record only after the entire game finishes.
Tests must show a cancel in the final decision still produces no completed GameAnalysis.

- [ ] **Step 6: Run the real-engine corpus as well as unit tests.**

```bash
pnpm test tests/unit/lib/analysis
pnpm e2e tests/e2e/assessment-prerequisites.spec.ts --grep-invert @live
```

Use the bundled test-entry method from Task 4 to call the real adapter and verifier in
the browser. Require positive coverage of all six theme/direction cases, legal evidence
for every output, and zero emitted findings for the negative corpus. Inconclusive positive
fixtures are a detector-quality failure to investigate, not a passing fake-engine test.
Commit `feat: verify tactical incidents before recommending study` when these checks pass.

### Task 7: Derive study priorities and relevant opening lessons

**Files**
- Create: `lib/assessment/recommendations.ts`, `lib/assessment/explanations.ts`, `lib/analysis/openings/match.ts`.
- Create: `tests/unit/lib/assessment/recommendations.test.ts`, `tests/unit/lib/analysis/openings.test.ts`.
- Extend: `tests/fixtures/assessment.ts` with `fixtureFinding(overrides?: Partial<Finding>): Finding`.

**Interfaces**
- Produces `buildRecommendations(assessment: Assessment, analyses: GameAnalysis[], games: ImportedGame[]): RecommendationSet`.
- `StudyPriority = { key: string; theme: Theme; direction: Direction; affectedGames: number; analyzedGames: number; findings: Finding[]; title: string; advice: string }`.
- `RecommendationSet = { priorities: StudyPriority[]; examples: StudyPriority[]; analyzedGames: number; provisional: boolean }`.
- Produces `explainFinding(finding: Finding): { title: string; explanation: string; advice: string }`.
- Produces `matchOpenings(game: ImportedGame, courses: CourseTree[]): OpeningMatch[]` and `resolveCourseLinks(match: OpeningMatch, courses: CourseTree[]): { explore?: string; lessons: { label: string; href: string; side: Side }[] }`.

- [ ] **Step 1: Write independent-game and signature-filter tests.**

The fixtureFinding factory is a literal verified allowed-mate example from Fool's Mate:
ply 2, played `g2g4`, recommended `g2g3`, playedLine `g2g4 d8h4`, legal before/after
FENs from that fixed fixture, mate consequence, empty targets, executed true, lowTime
false, and exact fixture VerificationPass records. Store literal expected data; do not
call the implementation to decide the fixture's labels.

```ts
test("three mistakes in one game do not create a recurring priority", () => {
  const assessment = fixtureSnapshot().current!;
  assessment.completedIds = ["game-1"];
  const analysis = fixtureAnalysis();
  analysis.findings = [2, 4, 6].map(ply => fixtureFinding({ id: `incident-${ply}`, ply }));
  const report = buildRecommendations(assessment, [analysis], [fixtureGame()]);
  expect(report.priorities).toHaveLength(0);
  expect(report.examples[0].affectedGames).toBe(1);
});
test("discards analysis from another signature", () => {
  const assessment = fixtureSnapshot().current!;
  const old = { ...fixtureAnalysis(), signature: "old-engine" };
  expect(buildRecommendations(assessment, [old], [fixtureGame()]).analyzedGames).toBe(0);
});
```

Add three distinct-game promotion, separate allowed/missed groups, duplicate analysis
records, stable severity ties, at-most-three limit, partial denominators, and empty
report copy. The repeated-ply fixture above tests aggregation only, not chess legality.

- [ ] **Step 2: Add opening tests showing that initial shared positions are insufficient.**

```ts
test("does not call every e4 game a Ruy Lopez", () => {
  const game = fixtureGame({ history: { initialFen: START_FEN,
    moves: ["e2e4", "c7c5"] }, sans: ["e4", "c5"] });
  const matches = matchOpenings(game, [loadCourse("ruy-lopez")!]);
  expect(matches.some(m => m.courseSlug === "ruy-lopez")).toBe(false);
});
```

Test genuine Ruy Lopez reachability, transpositions after its defining position,
multiple lesson candidates, removed nodes/lessons, malformed source opening URLs,
and source opening labels with no matching course. Use actual course data in these tests.

- [ ] **Step 3: Run both test files to confirm failure; implement pure grouping and templates.**

```ts
const fingerprints = new Map(games.filter(g => g.playerKey === assessment.playerKey)
  .map(g => [g.id, g.fingerprint]));
const compatible = analyses.filter(a => a.playerKey === assessment.playerKey &&
  a.signature === assessment.signature && assessment.selectedIds.includes(a.gameId) &&
  assessment.completedIds.includes(a.gameId) && fingerprints.get(a.gameId) === a.fingerprint);
const byGame = new Map(compatible.map(a => [a.gameId, a]));
const groups = new Map<string, Finding[]>();
for (const a of byGame.values()) for (const finding of a.findings) {
  const key = `${finding.theme}:${finding.direction}`;
  groups.set(key, [...(groups.get(key) ?? []), finding]);
}
```

Use distinct game IDs to count each group. Filter eligible >=3, sort by affected games,
then maximum verified consequence severity, then lexical key; take three. Examples
contain only groups with one/two games. Preserve full supported findings for evidence
navigation. Use actual completed compatible games as denominator, including those with
no findings; no success rate. Template copy must separate "could have played" from
"played" and mention low time as context only. Keep SAN/notation conversion in replay
helpers rather than teaching prose assembled from raw PGN comments.

- [ ] **Step 4: Implement source summaries and current-course resolution.**

Create a normalized position index for courses. For Ruy Lopez, gate matching on its
defining five-ply position before searching the deepest shared node. Follow actual
game continuations to select compatible existing lines; when ambiguous show multiple
named suggestions. Only return links for nodes/lines still present in the provided
current course trees.

```ts
const explore = `/course/${encodeURIComponent(match.courseSlug)}?` + new URLSearchParams({
  node: match.nodeId, side: match.side,
}).toString();
```

Construct this only after validating courseSlug/nodeId. Named lesson links use existing
`/course/[slug]/learn/[line]` routes and clearly label recommended side; they do not
change saved settings. No call to markDeviation, gradeCard, or saveCards is allowed.

- [ ] **Step 5: Run focused tests and typecheck; commit `feat: derive evidence-backed study priorities and opening advice`.**

### Task 8: Coordinate import, analysis, refresh, and resumption

**Files**
- Create: `lib/assessment/controller.ts`, `lib/assessment/locks.ts`.
- Create: `tests/unit/lib/assessment/controller.test.ts`, `locks.test.ts`.

**Interfaces**
- Consumes all earlier module contracts, injected client/store/engine factory/courses/clock.
- Produces `createAssessmentController(deps: ControllerDeps): AssessmentController`.
- `ControllerDeps = { store: AssessmentStore; client: ChessComClient; engineFactory: () => AnalysisEngine; courses: CourseTree[]; now: () => Date; withLock: <T>(work: () => Promise<T>) => Promise<T>; analyze?: typeof analyzeGame }`.
- `ControllerView = { playerKey: string | null; players: PlayerRecord[]; snapshot: PlayerSnapshot | null; report: RecommendationSet | null; phase: "idle" | "importing" | "ready" | "analyzing" | "paused" | "complete" | "failed"; message: string | null; storage: AssessmentStoreStatus; sessionOnly: boolean }`.
- `AssessmentController` exposes `getSnapshot(): ControllerView`, `subscribe(listener: () => void): () => void`, `selectPlayer(input: string): Promise<void>`, `import(): Promise<void>`, `start(): Promise<void>`, `resume(): Promise<void>`, `cancel(): Promise<void>`, `continueInMemory(): Promise<void>`, `deletePlayer(): Promise<void>`, `dispose(): void`.
- `withAssessmentLock<T>(work: () => Promise<T>, locks?: LockManager): Promise<T>` rejects `busy` or `unsupported` before invoking work if no lock can be obtained.

- [ ] **Step 1: Write races and checkpoint tests with injected deferred analysis.**

```ts
test("switching users discards a late result", async () => {
  const store = new MemoryAssessmentStore();
  const base = fixtureSnapshot(); base.draft = base.current; base.current = null;
  await store.saveDraft(base);
  let finish!: (a: GameAnalysis) => void;
  const pending = new Promise<GameAnalysis>(resolve => { finish = resolve; });
  const analyze = vi.fn(async () => pending);
  const controller = createAssessmentController({
    store, client: { archives: async () => [], month: async () => [] },
    engineFactory: () => ({ buildId: "fixture-engine", init: async () => {},
      analyze: async () => { throw new Error("Not used by injected analyzer"); },
      cancel: async () => {}, dispose: () => {} }),
    courses: [], now: () => new Date("2026-09-20T00:00:00Z"),
    withLock: async work => work(), analyze,
  });
  await controller.selectPlayer("learner");
  const run = controller.start();
  await vi.waitFor(() => expect(analyze).toHaveBeenCalled());
  const switching = controller.selectPlayer("someone-else");
  finish(fixtureAnalysis());
  await Promise.all([run, switching]);
  expect(controller.getSnapshot().playerKey).toBe("someone-else");
  expect((await store.load("learner"))?.draft?.completedIds).toEqual([]);
});
```

Use the actual policy signature from `analysisSignature("fixture-engine")` consistently
in lifecycle fixtures rather than an unrelated string. Add deletion during analysis,
refresh with corrected fingerprint, reordered newest-50 selection, incomplete source
scan, no eligible games, cancel during retry, storage write failure after analysis,
and a resumed run with a new engine signature. Test with stored opening progress in
localStorage and assert its serialized value remains byte-for-byte unchanged.

- [ ] **Step 2: Run controller/lock tests and confirm they fail before implementation.**

- [ ] **Step 3: Implement the lock and generation guard.**

```ts
export async function withAssessmentLock<T>(
  work: () => Promise<T>, locks: LockManager | undefined = navigator.locks,
): Promise<T> {
  if (!locks) throw new Error("unsupported");
  return locks.request("moechess:assessment", { mode: "exclusive", ifAvailable: true },
    async lock => { if (!lock) throw new Error("busy"); return work(); });
}
```

Call this inside client-side actions only. Use the same lock for import/refresh/delete
mutations as well as analysis so a second tab cannot overwrite the active snapshot.
Select/view needs no write lock. Any read recovery of stale persisted state changes
the view first; save the corrected paused state only under a lock.

Each action captures a monotonically increasing generation and player/assessment ID.
Cancel/switch/delete/dispose increments generation and aborts the current job. Both
before and after every awaited operation, check the signal and captured generation.

```ts
const isCurrent = () => generation === capturedGeneration && !abort.signal.aborted;
const analysis = await analyze(game, engine, signature, abort.signal);
if (!isCurrent()) return;
analysis.openings = matchOpenings(game, courses);
await store.commitGame(assessment.id, analysis);
if (!isCurrent()) return;
```

Persisted identity/fingerprint checks in Task 4 provide an additional guard at the
transaction boundary. Do not release an active lock until its promise settles; cancel
must cause blocked operations to settle through abort or worker termination.

- [ ] **Step 4: Implement stable snapshots and the explicit state transitions.**

Use immutable cached view snapshots for `useSyncExternalStore`. Import creates/reuses
a draft; checkpoint callbacks save its selected games and cursor. A completed import
promotes the draft atomically, preserving compatible analyses. A canceled refresh keeps
the previous current assessment and a resumable draft. The UI can choose the draft's
partial results without destroying current results. A final refresh replaces the active
selection and excludes old games from counts.

Start/resume initializes the engine, reuses only matching fingerprint/signature records,
processes games sequentially, commits each complete game, and derives the report from
reloaded compatible analyses. Empty selections never initialize the engine. Save completion
state only after the last checkpoint. Source coverage remains independent of analysis state.
If the source scan is partial, Resume resumes import first; Start assessment explicitly
permits analysis of the currently selected partial draft.

Worker/timeouts pause with retry copy. A storage error pauses before proceeding to the
next game. continueInMemory copies the current in-memory snapshot into a memory store,
marks sessionOnly true, and requires a separate Start/Resume action; it never purges the
failed persistent store. Selecting another player stops the old job and loads that
namespace. Unsupported browsers can read reports but cannot start engine work.

- [ ] **Step 5: Run controller, lock, and storage contracts; commit `feat: coordinate resumable player assessments`.**

### Task 9: Build the accessible Assessment page and controls

**Files**
- Create: `app/assessment/page.tsx`, `components/assessment/AssessmentClient.tsx`, `ImportForm.tsx`, `AssessmentStatus.tsx`, `PriorityList.tsx`, `OpeningSummary.tsx`.
- Create: `components/assessment/useAssessmentController.ts`.
- Modify: `components/nav/TopBar.tsx`, `app/globals.css`, `docs/theming-hooks.md`.
- Create: `tests/unit/components/assessment/ImportForm.test.tsx`, `AssessmentStatus.test.tsx`, `AssessmentClient.test.tsx`.

**Interfaces**
- `AssessmentClient({ courses }: { courses: CourseTree[] }): React.JSX.Element`.
- `useAssessmentController(courses: CourseTree[], factory?: (courses: CourseTree[]) => Promise<AssessmentController>): { controller: AssessmentController | null; view: ControllerView | null; initError: string | null }`.
- `ImportForm({ busy, players, onImport, onSelect }: { busy: boolean; players: PlayerRecord[]; onImport: (username: string) => Promise<void>; onSelect: (username: string) => Promise<void> }): React.JSX.Element`.
- `AssessmentStatus({ view, onStart, onResume, onCancel, onContinueInMemory }: { view: ControllerView; onStart: () => void; onResume: () => void; onCancel: () => void; onContinueInMemory: () => void }): React.JSX.Element`.
- `PriorityList({ report, onInspect }: { report: RecommendationSet; onInspect: (finding: Finding) => void }): React.JSX.Element`.
- `OpeningSummary({ matches, courses }: { matches: OpeningMatch[]; courses: CourseTree[] }): React.JSX.Element`.

- [ ] **Step 1: Read the installed framework guides before route/client edits.**

```bash
cat node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
cat node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/public-folder.md
cat node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md
```

If a documented path moved, locate it with `rg --files node_modules/next/dist/docs`.
Do not substitute assumptions from another Next.js release.

- [ ] **Step 2: Write component tests for real user actions and counts.**

```tsx
test("imports the typed username through the labeled form", async () => {
  const onImport = vi.fn().mockResolvedValue(undefined);
  render(<ImportForm busy={false} players={[]} onImport={onImport}
    onSelect={vi.fn().mockResolvedValue(undefined)} />);
  await userEvent.type(screen.getByRole("textbox", { name: "Chess.com username" }), "Learner");
  await userEvent.click(screen.getByRole("button", { name: "Import games" }));
  expect(onImport).toHaveBeenCalledWith("Learner");
});
```

Add a complete literal ControllerView fixture in this test directory with current
assessment: 10 selected, 3 compatible complete, partial coverage, 2 invalid records.
Assert separate "3 of 10 games analyzed", skipped count, and provisional label.
Also test no eligible games, no supported findings, memory-only banner, retryAt countdown,
loading existing players, and a busy tab. No UI should display an engine code or raw error
stack. The phase-specific buttons must invoke the corresponding controller action once.

- [ ] **Step 3: Run `pnpm test tests/unit/components/assessment` and confirm expected failures.**

- [ ] **Step 4: Add the server route and lazily initialize the controller on the client.**

```tsx
// app/assessment/page.tsx
import { loadAllCourses } from "@/lib/course/load";
import { AssessmentClient } from "@/components/assessment/AssessmentClient";
export default function AssessmentPage() {
  return <AssessmentClient courses={loadAllCourses()} />;
}
```

Only serializable course data crosses the boundary. The hook opens IndexedDB inside
an effect, creates the client and engine factory without starting a worker, subscribes
to cached controller snapshots, and cleans up both subscriptions and controller. Use a
mounted generation guard so asynchronous storage initialization after cleanup disposes
the created controller instead of setting state on a discarded mount.

```tsx
useEffect(() => {
  let active = true;
  let resource: AssessmentController | null = null;
  void factory(courses).then(created => {
    resource = created;
    if (!active) { created.dispose(); return; }
    setController(created);
  });
  return () => { active = false; resource?.dispose(); };
}, [courses, factory]);
```

Handle a rejected factory by setting a visible initialization state; do not leave an
unhandled promise. Keep the default factory function at module scope for stable effect
identity. A Strict Mode test must resolve the first initialization after cleanup and
assert its controller is disposed while the second remains usable. `useSyncExternalStore`
must use a constant null server snapshot and stable subscribe/getSnapshot wrappers.

- [ ] **Step 5: Compose the page and token-based styling.**

```tsx
<section className="mc-assessment" data-state={view.phase} aria-labelledby="assessment-title">
  <h1 id="assessment-title" className="mc-page-title">Find your next study focus</h1>
  <p>Assess up to 50 rated rapid games from the last 12 months.</p>
  <p>Games and results are saved in this browser. Keep this page open during analysis.</p>
  <ImportForm busy={view.phase === "importing" || view.phase === "analyzing"}
    players={view.players} onSelect={selectPlayer} onImport={importPlayer} />
</section>
```

In AssessmentClient define `selectPlayer = username => controller.selectPlayer(username)`
and `importPlayer = async username => { await controller.selectPlayer(username); await controller.import(); }`.
Render the status, priorities, opening summary, and evidence selection beneath the form;
Task 10 provides the evidence viewer. Until that task lands, show the selected finding's
text explanation, not a dead inspect button. Add deletion for the selected player's local
data with an explicit in-page confirmation (ordinary product UI, unrelated to agent approval).

The existing root layout owns `<main id="main">`; the Assessment page uses a labeled
section within it. Reuse existing tokens. Document `.mc-assessment`, `.mc-assessment-status`, `.mc-study-priority`,
`.mc-opening-summary`, and `.mc-assessment-evidence` hooks. Progress updates use a polite
status region throttled to game completion; fatal initialization messages use alert.
Retain visible keyboard focus, 390px usability, and non-color status text.

- [ ] **Step 6: Add Assessment navigation, run component/theme checks, and commit.**

```bash
pnpm test tests/unit/components/assessment tests/unit/theme-contract.test.ts
pnpm typecheck
```

Commit task-owned files with `feat: add account-free assessment page and progress controls`.

### Task 10: Replay verified evidence and open the correct course position

**Files**
- Create: `lib/assessment/replay.ts`, `components/assessment/EvidenceViewer.tsx`.
- Modify: `components/board/Board.tsx`, `components/assessment/AssessmentClient.tsx`, `components/modes/ExploreView.tsx`, `app/course/[slug]/page.tsx`.
- Create: `tests/unit/lib/assessment/replay.test.ts`, `tests/unit/components/assessment/EvidenceViewer.test.tsx`.
- Modify: `tests/unit/components/board/Board.test.tsx`, `tests/unit/components/modes/ExploreView.test.tsx`.

**Interfaces**
- `buildReplay(initialFen: string, moves: string[]): ReplayFrame[]` and `findingReplay(finding: Finding, branch: "played" | "recommended"): ReplayFrame[]`.
- `ReplayFrame = { fen: string; san: string | null; moveLabel: string; lastMove: { from: string; to: string } | null }`.
- `EvidenceViewer({ finding, game }: { finding: Finding; game: ImportedGame }): React.JSX.Element`.
- Add optional `showMoveInput?: boolean` to BoardProps, default true.
- Add optional `initialNodeId?: string` and `orientation?: Side` to ExploreView props. Existing callers retain existing behavior.

- [ ] **Step 1: Write replay and noninteractive-board tests.**

```ts
test("replays a verified mate with a correct move label", () => {
  const frames = buildReplay("7k/8/5KQ1/8/8/8/8/8 w - - 0 1", ["g6g7"]);
  expect(frames).toHaveLength(2);
  expect(frames[1].san).toBe("Qg7#");
  expect(frames[1].moveLabel).toBe("1. Qg7#");
});
test("rejects a corrupt saved evidence line", () => {
  expect(() => buildReplay(START_FEN, ["e2e5"])).toThrow();
});
```

Component tests assert board orientation follows finding.side, Previous/Next controls
work by keyboard, switching branch resets to its initial frame, promotion moves replay,
and the move-entry input is absent only when showMoveInput is false. A stored game URL
is revalidated before rendering; `javascript:` and hostile HTML remain non-executable.
Test a malformed saved finding shows an unavailable-example notice without crashing the
rest of the report.

- [ ] **Step 2: Run new replay/viewer tests before implementation.**

- [ ] **Step 3: Implement replay via legal chess moves, preserving SAN and full FEN.**

```ts
export function buildReplay(initialFen: string, moves: string[]): ReplayFrame[] {
  const board = new Chess(initialFen);
  const frames: ReplayFrame[] = [{ fen: board.fen(), san: null, moveLabel: "Starting position", lastMove: null }];
  for (const uci of moves) {
    const move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    frames.push({ fen: board.fen(), san: move.san,
      moveLabel: moveNumberLabel(board.fen(), move.san),
      lastMove: { from: move.from, to: move.to } });
  }
  return frames;
}
```

Import moveNumberLabel from the existing course label module. Finding lines both start
at finding.beforeFen and must include the played or recommended root move respectively;
the allowed tactic appears at tacticalPly 1, not as an illegal player move at ply 0.
Show a short actual game continuation alongside the verified consequence, distinguishing
the opponent's actual play from a hypothetical punishment when executed is false.

```tsx
<Board fen={frame.fen} orientation={finding.side} interactive={false}
  showMoveInput={false} label="Position from your game" lastMove={frame.lastMove}
  announcement={frame.moveLabel} />
```

Wrap the existing Board move form in `showMoveInput && (...)`; do not change input
defaults or grading in existing trainer views. Render all explanations as React text.

- [ ] **Step 4: Add validated Explore deep links without changing saved training settings.**

Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`
before changing the async route props and searchParams handling.
The existing course page already awaits params. Await searchParams, accept one scalar
node and side, validate against the loaded tree and white/black literals, and pass
explicit initialNodeId/orientation to ExploreView. Invalid links fall back to the normal
saved/root position with no error. This makes that page request-dependent; remove no
existing generateStaticParams behavior without verifying the installed Next.js rules.

```ts
const query = await props.searchParams;
const initialNodeId = typeof query.node === "string" && course.nodes[query.node]
  ? query.node : undefined;
const orientation = query.side === "white" || query.side === "black" ? query.side : undefined;
```

In ExploreView, explicit initialNodeId takes precedence over saved position on initial
load; later user navigation takes precedence. A changed explicit node prop resets that
local selection deliberately. orientation overrides display side only, leaving the
saved settings object untouched. Review buttons still follow existing training rules;
link copy identifies the recommended side before entering a named lesson.

- [ ] **Step 5: Run replay, board, Explore, and assessment component tests plus typecheck.**

```bash
pnpm test tests/unit/lib/assessment/replay.test.ts tests/unit/components
pnpm typecheck
```

Commit `feat: replay assessment evidence and link relevant course positions`.

### Task 11: Validate the complete flow, browser recovery, and performance

**Files**
- Create: `tests/e2e/assessment.spec.ts`, `tests/e2e/assessment-recovery.spec.ts`, `tests/e2e/helpers/assessment-api.ts`, `tests/fixtures/assessment-performance.pgn`.
- Reuse: `tests/e2e/helpers/assessment-bundle.ts` from Task 4.
- Create: `docs/assessment-validation.md`; update README with how to use the feature and run its opt-in checks.
- Modify: `package.json` only if a dedicated opt-in test/asset-check script improves repeatability; no new test runner.

**Interfaces**
- `mockAssessmentApi(page: Page, games: unknown[]): Promise<void>` intercepts only Chess.com archive/month requests and returns fixture responses with CORS headers.
- `bundleBrowserEntry(source: string): Promise<string>` bundles an inline test entry using Vite into a unique temporary directory, reads the generated JS, and cleans up only that created directory. No test endpoint ships with the app.
- Browser tests use the actual product route, real IndexedDB, Web Locks, and engine. Use injected deterministic dependencies only for focused unit/component cases.

- [ ] **Step 1: Write the end-to-end test before fixing integration mismatches.**

```ts
test("assesses games and preserves existing training progress", async ({ page }) => {
  const progress = JSON.stringify({ schemaVersion: 1, cards: {}, learnedLines: {}, explore: {} });
  await page.addInitScript(value => localStorage.setItem("moechess:progress", value), progress);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const games = [1, 2, 3].map(n => rawGame({ uuid: `game-${n}`,
    url: `https://www.chess.com/game/live/${1000 + n}`, end_time: nowSeconds - n }));
  await mockAssessmentApi(page, games);
  await page.goto("/assessment");
  await page.getByRole("textbox", { name: "Chess.com username" }).fill("learner");
  await page.getByRole("button", { name: "Import games" }).click();
  await page.getByRole("button", { name: "Start assessment" }).click();
  await expect(page.getByText("3 of 3 games analyzed", { exact: true })).toBeVisible({ timeout: 120000 });
  await expect(page.getByText("Found in 3 of 3 analyzed games", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("moechess:progress"))).toBe(progress);
  await page.reload();
  await expect(page.getByText("Found in 3 of 3 analyzed games", { exact: true })).toBeVisible();
});
```

Keep test clock/date aligned to fixture end times without faking engine watchdog timers.
The full-flow snippet uses a captured current time; pass a fixed date only to unit tests.
The API mock groups games by their UTC completion month, including a prior month when
the test straddles midnight at a month boundary. Set the
test timeout above its bounded real-engine wait. Add inspect-example and valid Ruy Lopez
link assertions with a second legal opening fixture; do not expect a Fool's Mate game to
recommend Ruy Lopez.

- [ ] **Step 2: Implement the narrow API mock and browser bundle helper.**

```ts
export async function mockAssessmentApi(page: Page, games: unknown[]): Promise<void> {
  const months = new Map<string, unknown[]>();
  for (const game of games) {
    const endTime = (game as { end_time: number }).end_time;
    const month = new Date(endTime * 1000).toISOString().slice(0, 7).replace("-", "/");
    months.set(month, [...(months.get(month) ?? []), game]);
  }
  await page.route("https://api.chess.com/pub/player/learner/games/**", async route => {
    const url = new URL(route.request().url());
    const month = url.pathname.split("/").slice(-2).join("/");
    const json = url.pathname.endsWith("/archives")
      ? { archives: [...months.keys()].sort().map(m => `https://api.chess.com/pub/player/learner/games/${m}`) }
      : { games: months.get(month) ?? [] };
    await route.fulfill({ status: 200, json, headers: { "access-control-allow-origin": "*" } });
  });
}
```

Reuse Task 4's bundle helper. Await every injected async test and return serializable
results to Playwright. Do not expose the helper or test globals through the production bundle.

- [ ] **Step 3: Add recovery tests using actual reloads and competing pages.**

```ts
test("another tab cannot acquire the assessment lock", async ({ context, page }) => {
  await page.goto("/assessment");
  await page.evaluate(() => {
    const scope = window as unknown as { releaseAssessment?: () => void };
    void navigator.locks.request("moechess:assessment", async () => {
      await new Promise<void>(resolve => { scope.releaseAssessment = resolve; });
    });
  });
  await expect.poll(() => page.evaluate(() => Boolean(
    (window as unknown as { releaseAssessment?: () => void }).releaseAssessment))).toBe(true);
  const second = await context.newPage();
  await second.goto("/assessment");
  await mockAssessmentApi(second, [rawGame({ end_time: Math.floor(Date.now() / 1000) - 1 })]);
  await second.getByRole("textbox", { name: "Chess.com username" }).fill("learner");
  await second.getByRole("button", { name: "Import games" }).click();
  await expect(second.getByText("An assessment is active in another tab.")).toBeVisible();
  await page.close();
  // Retry in second: closing the owning page releases the Web Lock automatically.
  await second.getByRole("button", { name: "Import games" }).click();
  await expect(second.getByRole("button", { name: "Start assessment" })).toBeVisible();
});
```

Additional tests: cancel after
one checkpoint, reload/resume without recomputing completed games, cancel before first
checkpoint, worker asset failure then retry, 429 then retry, corrupt saved evidence,
unsupported capability with saved-report access, explicit session-only continuation,
and refresh reducing/replacing the selected set. Assert deletion stays deleted after
a late result and selecting another username cannot leak prior results.

- [ ] **Step 4: Complete visual, accessibility, and measured performance checks.**

Use Playwright at widths 390, 820, and 1440 in both built-in themes. Save screenshots
under a task-specific ignored/temp directory and inspect them with the image tool.
Exercise import, progress, report, and evidence replay via keyboard; confirm live-region
announcements are useful, input remains responsive, and reduced motion is respected.

Add a 50-game reference batch of legal short/medium/long PGNs in
`tests/fixtures/assessment-performance.pgn`, generated from identified public games
only after retaining source references, or from deterministic legal self-play with
that provenance stated. Benchmark the actual target batch, not 50 copies of one cached
position. Record desktop device/browser, asset bytes/load time, peak memory when the
browser exposes it, per-game timing, total timing, exclusions, and observed cancellation
time. Run on a representative real phone if available. Browser emulation is layout
coverage, not evidence of phone CPU performance; if unavailable, explicitly mark that
release criterion unverified rather than claiming it passed.

`docs/assessment-validation.md` records actual commands/results, fixture coverage,
measured limits, engine asset/source provenance, and remaining release blockers. Do not
write anticipated results as observed data. If budgets need calibration, update the
policy version and rerun the tactical corpus and benchmark; keep the approved evidence
standards. A design-level change requires review rather than quietly broadening scope.

- [ ] **Step 5: Run final repository checks after integration fixes.**

```bash
node scripts/vendor-stockfish.mjs --check
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm e2e --grep-invert @live
MOECHESS_LIVE_API=1 pnpm e2e tests/e2e/assessment-prerequisites.spec.ts --grep @live
git diff --check
git status --short
```

Playwright's existing webServer command runs a production build; do not rebuild twice
unnecessarily if its completed production build already supplies the needed evidence.
After the complete required checks pass, rerun only checks affected by further changes.
Record failures/limitations honestly and fix regressions before completion. Commit task
files and integration fixes with `test: validate assessment flow and recovery`.

## Spec coverage and completion conditions

| Spec section | Owning tasks | Evidence |
| --- | --- | --- |
| 1–2 Intent/scope | 7, 9, 11 | Beginner templates, assessment-only UI, no training mutations |
| 3 User journey | 8–11 | Import through report, replay, refresh, resume, access checks |
| 4 Architecture | 1–10 | Explicit interfaces, direct API, separated storage and engine |
| 5 Import | 2–3, 8 | Eligibility, UTC window, newest-50, retries, dedupe, corrected games |
| 6 Engine/processing | 1, 5–6, 8 | Real worker, node budgets, history, watchdog, lock, cancellation |
| 7 Tactical evidence | 5–6, 11 | Positive/negative corpus, legal witness lines, resource exclusions |
| 8 Recommendations/openings | 7, 10 | Independent games, threshold, ranking, course match and links |
| 9 Persistence | 4, 8, 11 | Transactions, schema/quotas, drafts, isolation, deletion, signatures |
| 10 Errors | 1–4, 8–11 | Bounded failures, partial results, recovery, session-only behavior |
| 11 Validation | All, especially 11 | Unit/component/real-engine/browser checks and measured record |
| 12 Distribution/framework | 1, 9–10 | Pinned assets, corresponding source, credits, installed Next docs |
| 13 Handoff | This plan | Written plan review and execution-method selection precede code |

Completion requires passing relevant automated checks and a recorded validation result
for every release criterion. An unavailable real-phone measurement or blocked live API
check is reported as unverified/blocked, never counted as a passing test. The implementing
agent should separate "implementation complete" from "all release criteria verified"
when external validation remains outstanding.

## Planning references

- [Stockfish.js package metadata](https://github.com/nmrugg/stockfish.js/blob/master/package.json)
  and [worker-loading example](https://github.com/nmrugg/stockfish.js/blob/master/examples/loadEngine.js).
- [Chess.com Published-Data API](https://www.chess.com/news/view/published-data-api).
- [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API).
- Installed Next.js client/server and public-folder guides were read while planning;
  executors must reread the guides relevant to their actual edits.

## Execution handoff

The user has approved the specification but has not yet selected an implementation
execution method. After reviewing this plan, choose either:

- **Native:** one implementer follows these connected tasks in this session, then a
  fresh reviewer checks the whole branch. Recommended here because the shared engine,
  findings, persistence, and controller contracts benefit from continuous context.
- **Subagent-driven:** a fresh implementer and reviewers handle each task, followed by
  whole-branch review. More independent checkpoints, with more context and coordination cost.

No implementation begins until the user reviews this plan and selects the method.
