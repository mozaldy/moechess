# Assessment validation record

Recorded on 2026-09-24 in the `chesscom-assessment` worktree. The browser checks used the production `/assessment` route, Chromium, real IndexedDB, real Web Locks, and the pinned Stockfish.js worker. Only the Chess.com public archive/month HTTP responses were mocked in routine end-to-end tests. No test endpoint was added to the app.

## Fixture and engine provenance

`tests/fixtures/assessment-performance.pgn` contains 50 distinct legal synthetic self-play games, generated deterministically with `chess.js` 1.4.0. The generator used the six opening prefixes Ruy Lopez, Queen's Gambit, Sicilian, French, English, and Réti, then selected legal moves from a stable seeded sequence. There are 10 short games (12–18 plies), 20 medium games (26–34 plies), and 20 long games (46–54 plies). The terminal `1-0` records a synthetic resignation by Black after the last move; these are test games, not public Chess.com games or evidence about a human player. The benchmark supplies distinct IDs and completion times to the browser importer. The first Ruy game also checks a course-position link.

For reproducibility, game `n` (zero-based) starts the `chess.js` board with one of these SAN prefixes in cyclic order: `e4 e5 Nf3 Nc6 Bb5 a6`, `d4 d5 c4 e6`, `e4 c5 Nf3 d6`, `e4 e6 d4 d5`, `c4 e5 Nc3 Nf6`, `Nf3 d5 g3 Nf6`. Its unsigned 32-bit seed is `0x9e3779b9 ^ ((n + 1) * 2654435761)`. For each next move, apply xorshift32 (`x ^= x << 13; x ^= x >>> 17; x ^= x << 5`) and choose `chess.moves().sort()[(x >>> 0) % moveCount]` until the target ply count: `12 + (n % 4) * 2` for games 0–9, `26 + (n % 5) * 2` for games 10–29, and `46 + (n % 5) * 2` for games 30–49. All 50 PGNs loaded successfully with `chess.js`; they had unique contents and the intended 12–54-ply range.

The assessment engine is Stockfish.js 19.0.0 lite single-threaded, source revision `54fde71d90c7c403964f6cacef48f7bbec495df1`. `public/engines/stockfish/manifest.json` records SHA-256 hashes and byte sizes: worker 21,415 bytes, WASM 1,787,571 bytes, and NNUE network 1,166,381 bytes. The corresponding source archive, notice, GPL license, and reproduction instructions are included under `public/engines/stockfish/`.

## Browser coverage observed

The three-game real-engine flow completed in Chromium and kept existing training progress unchanged. Its report survived reload after reopening the saved player. A replayable tactical example offered the played and recommended lines and a safe completed-game link. A separate legal Ruy Lopez fixture followed its course-position link successfully. The recovery suite covered 429 retry, competing Web Lock tabs, durable deletion, unsupported Web Locks with saved-report access, corrupt saved evidence, pause before/after a checkpoint, reload/resume without recomputing a completed game, worker asset failure and retry, refresh replacement, username isolation, quota failure with explicit session-only continuation, and deletion during active engine work. A `rate-limit` message mismatch and an unresponsive delete action during active analysis were each reproduced by failing browser tests and fixed. A later whole-branch review found that Refresh could bypass the saved 429 retry deadline; the controller and UI now enforce it, and the targeted browser retry test passed after advancing the browser clock beyond the 60-second minimum. During the full non-live suite, pause-after-checkpoint took 21 ms from click to visible paused state (24 ms in the earlier focused run), below the one-second criterion; the saved checkpoint survived reload.

Full-page screenshots of the completed report and open evidence board were captured and visually inspected at 390, 820, and 1440 CSS pixels in both Summer Sky and Night Shift themes. All six had no horizontal overflow (`scrollWidth === clientWidth`), kept the replay controls visible, and were rendered with reduced motion enabled. Screenshots are under `/tmp/moechess-assessment-visual/` in this test environment and are not committed. The keyboard test also captures actual text changes inside the polite progress live region, exercises Enter on import/analysis/evidence controls, and checks reduced-motion preference.

The browser runner in this sandbox used `pnpm exec next build --webpack`, `pnpm start --hostname 127.0.0.1 --port 3100`, and a temporary Playwright config without `webServer`. The stock Playwright web-server command invokes a Turbopack build; that build failed to fetch Google Fonts in this network-restricted sandbox. The Webpack production build succeeded and served all browser checks. A separate escalated `pnpm build` retry failed with a Turbopack internal error while its CSS process tried to bind a port (`Operation not permitted`). These are environment-specific build limitations; the default build command is not counted as passing. The temporary runner config was removed after validation.

## Repository check results

| Check | Observed result |
| --- | --- |
| `node scripts/vendor-stockfish.mjs --check` | Passed (exit 0). |
| `pnpm test` | 50 files, 451 tests passed after the search-cache change. |
| `pnpm typecheck` | Passed. |
| `pnpm lint` | Passed. |
| `pnpm exec next build --webpack` | Passed; `/assessment` prerendered. |
| `pnpm build` | Failed in the sandbox: Google Fonts fetch; escalated retry: Turbopack CSS process port-binding panic. |
| Non-live Playwright, production Webpack build | 25 passed, 1 opt-in performance test skipped (1.7 minutes), before the final 429 retry guard. Its targeted recovery test passed again after that guard. |
| Opt-in live public API check | Passed, 1/1: browser-origin Chess.com archives and latest monthly endpoint readable. |
| Full 50-game benchmark | Failed at 15/50 after 28.3 minutes. |
| `git diff --check` | Passed. |

## Desktop 50-game performance result

The opt-in full reference batch was run with `MOECHESS_PERFORMANCE=1 pnpm e2e --config .temp-assessment-playwright.config.ts tests/e2e/assessment.spec.ts --grep @performance --reporter=line` on arm64 macOS 27.0 in Playwright Chromium against the production Webpack build. At Playwright's 1,700,000 ms completion deadline (28 minutes 20 seconds; reported test duration 28.3 minutes), the interface showed **15 of 50 games analyzed**, 35 unfinished, and zero invalid/ineligible records. The test failed because `50 of 50 games analyzed` was absent; the assessment remained in its analyzing phase. This is a desktop performance release blocker for this heterogeneous fixture. No engine node budgets or evidence thresholds were changed to make it pass.

The timed-out run did not emit its in-page timing/heap array because its original test version wrote results only on success. The test now writes partial metrics in a `finally` block for subsequent runs. Per-game times and peak memory from this full run are therefore **unavailable**, not estimated from the 15-game count. A bounded diagnostic subset can be run with `MOECHESS_PERFORMANCE_GAMES=<1–50>`; it does not replace the failed 50-game release criterion.

A three-game diagnostic subset (`MOECHESS_PERFORMANCE_GAMES=3`) completed in 112,448.5 ms from observer start, with browser progress checkpoints at 38,983.3, 54,572.8, and 112,448.5 ms. The implied intervals were 38.98, 15.59, and 57.88 seconds. This subset used the first three distinct legal fixture games (12, 14, and 16 plies); its timing cannot be extrapolated linearly to the remaining longer games. Chromium reported `performance.memory.usedJSHeapSize` as exactly 10,000,000 bytes at each sampled checkpoint, indicating a coarse or unavailable page-heap signal; no credible peak browser/worker memory measurement was obtained. The main page's sole Stockfish Resource Timing entry had a negative duration, so it was discarded as invalid.

A separate fresh Chromium page fetched each local engine asset with `cache: "no-store"` and read its complete body: worker JS 21,415 bytes in 3.8 ms, WASM 1,787,571 bytes in 43.8 ms, and NNUE 1,166,381 bytes in 2.2 ms, all HTTP 200 from localhost. These are local transfer observations, **not** engine initialization or remote-user download times. The browser identified itself as HeadlessChrome 153.0.8010.12 on macOS; `navigator.hardwareConcurrency` reported 10. The full benchmark's Playwright Desktop Chrome profile emitted a Windows-style user agent override even though the host was arm64 macOS.

### Exact-search reuse follow-up

The original timed-out 50-game result above predates a per-game cache for identical, completed Stockfish searches. Instrumentation showed that 55–61% of actual searches in three short games and one medium game repeated the same full position, perspective, node budget, and ordered root moves. The cache reuses only exact results with a fully legal principal variation and matching perspective/root; it does not change the 200,000/400,000 node budgets, tactical certificates, or analysis signature. Bounded, malformed, canceled, and failed searches are not retained.

With the cache, a three-short-game Chromium run took 63.8 seconds instead of 113.4 seconds and made 219 physical searches instead of 508. One medium game took 75.6 instead of 123.8 seconds and made 166 instead of 402 searches. A 46-ply long game still took 182.6 seconds (531 physical searches; 114.0 seconds in engine searches and 68.2 seconds in verifier work). A later three-game real-Stockfish corpus run took 63.9 seconds. The full 50-game batch was **not rerun** after this optimization: the long-game measurement alone indicates that 20 similar long games would exceed the original 28.3-minute deadline. This is a projection, not a measured full-batch result. The desktop completion criterion remains open.

## Remaining release verification

The desktop 50-game batch did not finish within the test deadline. Full-batch per-game timing and whole-browser/worker peak memory remain unavailable; these are release blockers for the measured performance criterion. The real-phone 50-game CPU/memory run remains unverified because no representative phone is connected to this workspace. Browser viewport emulation cannot establish phone processing time. The default Turbopack `pnpm build` also remains unverified in this sandbox, although the Webpack production build passed. The opt-in live Chess.com public API check passed.

For browser measurements, Chromium's `performance.memory.usedJSHeapSize` describes the page JavaScript heap only; it is not a whole-browser or worker/WASM peak. Main-page Resource Timing may omit worker-initiated WASM and NNUE requests. Any missing resource entry is recorded as unobserved, not zero load time or zero bytes.
