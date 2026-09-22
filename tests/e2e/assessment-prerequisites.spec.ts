import { expect, test } from "@playwright/test";
import { Chess } from "chess.js";
import { bundleBrowserEntry } from "./helpers/assessment-bundle";

const MATE_FEN = "7k/8/5KQ1/8/8/8/8/8 w - - 0 1";

test("vendored Stockfish handshakes and finds a legal mate in one", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async ({ fen }) => {
    const manifestResponse = await fetch("/engines/stockfish/manifest.json");
    if (!manifestResponse.ok) throw new Error(`manifest HTTP ${manifestResponse.status}`);
    const manifest = await manifestResponse.json() as { workerUrl: string };

    return await new Promise<{ mate: number | null; pv: string[]; bestmove: string }>((resolve, reject) => {
      const worker = new Worker(manifest.workerUrl);
      let mate: number | null = null;
      let pv: string[] = [];
      const timeout = window.setTimeout(() => {
        worker.terminate();
        reject(new Error("Stockfish browser prerequisite timed out"));
      }, 30_000);
      const finish = (value: { mate: number | null; pv: string[]; bestmove: string }) => {
        window.clearTimeout(timeout);
        worker.terminate();
        resolve(value);
      };
      worker.onerror = (event) => {
        window.clearTimeout(timeout);
        worker.terminate();
        reject(new Error(event.message || "Stockfish worker crashed"));
      };
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (typeof event.data !== "string") return;
        const line = event.data.trim();
        if (line === "uciok") {
          worker.postMessage("setoption name Hash value 16");
          worker.postMessage("setoption name MultiPV value 1");
          worker.postMessage("isready");
          return;
        }
        if (line === "readyok") {
          worker.postMessage(`position fen ${fen}`);
          worker.postMessage("go nodes 200000");
          return;
        }
        if (line.startsWith("info ")) {
          const tokens = line.split(/\s+/);
          const score = tokens.indexOf("score");
          if (tokens[score + 1] === "mate") mate = Number(tokens[score + 2]);
          const pvIndex = tokens.indexOf("pv");
          if (pvIndex >= 0) pv = tokens.slice(pvIndex + 1);
          return;
        }
        if (line.startsWith("bestmove ")) {
          finish({ mate, pv, bestmove: line.split(/\s+/)[1] });
        }
      };
      worker.postMessage("uci");
    });
  }, { fen: MATE_FEN });

  expect(result.mate).toBe(1);
  expect(result.pv[0]).toBe(result.bestmove);
  const position = new Chess(MATE_FEN);
  for (const move of result.pv) {
    expect(() => position.move({
      from: move.slice(0, 2),
      to: move.slice(2, 4),
      ...(move[4] ? { promotion: move[4] } : {}),
    })).not.toThrow();
  }
  expect(position.isCheckmate()).toBe(true);
});

test("real Stockfish verifies the tactical corpus conservatively", async ({ page }) => {
  test.setTimeout(240_000);
  const bundle = await bundleBrowserEntry(`
    import { createBrowserEngine } from "@/lib/analysis/engine/browser-engine";
    import { findCandidates, replayHistory } from "@/lib/analysis/tactics/candidates";
    import { verifyCandidate } from "@/lib/analysis/tactics/verify";
    import { TACTICAL_FIXTURES, TACTICAL_TACTICS } from "@/tests/fixtures/tactics";

    const legal = (fen, line) => {
      try {
        replayHistory({ initialFen: fen, moves: line });
        return true;
      } catch { return false; }
    };

    window.runTacticalCorpus = async () => {
      const signal = new AbortController().signal;
      const engine = createBrowserEngine();
      await engine.init(signal);
      const selectedPositiveNames = new Set([
        "missed mate in one", "allowed mate in one", "missed hanging queen",
        "allowed hanging queen", "missed knight fork", "allowed knight fork",
        "black allowed knight fork", "promotion capture wins a hanging queen",
      ]);
      const fixtures = TACTICAL_FIXTURES.filter(fixture =>
        selectedPositiveNames.has(fixture.name) || fixture.expected === "rejected");
      const results = [];
      try {
        for (const fixture of fixtures) {
          const history = { initialFen: fixture.initialFen, moves: fixture.moves };
          const side = replayHistory(history).turn() === "w" ? "white" : "black";
          const candidate = findCandidates(history, fixture.played, side).find(item =>
            item.theme === fixture.theme && item.direction === fixture.direction
              && item.tactic === TACTICAL_TACTICS[fixture.name]);
          if (!candidate) {
            results.push({ name: fixture.name, expected: fixture.expected, kind: "missing", legal: false });
            continue;
          }
          const outcome = await verifyCandidate(candidate, engine, signal);
          const linesLegal = outcome.kind !== "verified" || (
            legal(outcome.finding.beforeFen, outcome.finding.playedLine)
            && legal(outcome.finding.beforeFen, outcome.finding.recommendedLine)
          );
          results.push({ name: fixture.name, expected: fixture.expected, kind: outcome.kind, legal: linesLegal,
            theme: candidate.theme, direction: candidate.direction,
            reason: outcome.kind === "verified" ? null : outcome.reason });
        }
      } finally { engine.dispose(); }
      return results;
    };
  `);

  await page.goto("/");
  await page.addScriptTag({ content: bundle });
  const results = await page.evaluate(async () => await (
    window as unknown as { runTacticalCorpus: () => Promise<Array<{
      name: string; expected: string; kind: string; legal: boolean; theme?: string; direction?: string; reason?: string | null;
    }>> }
  ).runTacticalCorpus());

  const positives = results.filter(({ expected }) => expected === "verified");
  expect(positives, JSON.stringify(results, null, 2)).toHaveLength(8);
  expect(positives.every(({ kind, legal }) => kind === "verified" && legal), JSON.stringify(results, null, 2)).toBe(true);
  expect(positives, JSON.stringify(results, null, 2)).toEqual(expect.arrayContaining([
      expect.objectContaining({ theme: "mate-one", direction: "missed", kind: "verified", legal: true }),
      expect.objectContaining({ theme: "mate-one", direction: "allowed", kind: "verified", legal: true }),
      expect.objectContaining({ theme: "hanging", direction: "missed", kind: "verified", legal: true }),
      expect.objectContaining({ theme: "hanging", direction: "allowed", kind: "verified", legal: true }),
      expect.objectContaining({ theme: "fork", direction: "missed", kind: "verified", legal: true }),
      expect.objectContaining({ theme: "fork", direction: "allowed", kind: "verified", legal: true }),
      expect.objectContaining({ name: "black allowed knight fork", kind: "verified", legal: true }),
      expect.objectContaining({ name: "promotion capture wins a hanging queen", kind: "verified", legal: true }),
    ]));
  expect(results.filter(({ expected, kind }) => expected === "rejected" && kind === "verified"), JSON.stringify(results, null, 2)).toEqual([]);
  const consequenceSensitive = new Set([
    "capturing attacker is recaptured",
    "hanging capture permits immediate mate",
    "allowed loss was unavoidable before the move",
    "played move retains another forced mate",
    "forking knight is immediately recaptured",
    "en passant creates a pawn fork",
  ]);
  expect(results.filter(({ name }) => consequenceSensitive.has(name)), JSON.stringify(results, null, 2))
    .toEqual(expect.arrayContaining([...consequenceSensitive].map((name) =>
      expect.objectContaining({ name, expected: "rejected", kind: "rejected" }))));
});

test("public game import is readable from this origin @live", async ({ page }) => {
  test.skip(process.env.MOECHESS_LIVE_API !== "1", "Opt-in network integration check");
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const archivesResponse = await fetch("https://api.chess.com/pub/player/hikaru/games/archives", {
      credentials: "omit",
      signal: AbortSignal.timeout(30_000),
    });
    const archivesBody = await archivesResponse.json() as { archives?: unknown };
    if (!Array.isArray(archivesBody.archives) || archivesBody.archives.length === 0) {
      return { archivesStatus: archivesResponse.status, archivesBody, monthlyStatus: null, monthlyBody: null, monthlyUrl: null };
    }
    const monthlyUrl = archivesBody.archives.at(-1);
    if (typeof monthlyUrl !== "string" || !/^https:\/\/api\.chess\.com\/pub\/player\/hikaru\/games\/\d{4}\/\d{2}$/.test(monthlyUrl)) {
      return { archivesStatus: archivesResponse.status, archivesBody, monthlyStatus: null, monthlyBody: null, monthlyUrl };
    }
    const monthlyResponse = await fetch(monthlyUrl, {
      credentials: "omit",
      signal: AbortSignal.timeout(30_000),
    });
    return {
      archivesStatus: archivesResponse.status,
      archivesBody,
      monthlyStatus: monthlyResponse.status,
      monthlyBody: await monthlyResponse.json(),
      monthlyUrl,
    };
  });

  expect(result.archivesStatus).toBe(200);
  expect(Array.isArray(result.archivesBody.archives)).toBe(true);
  expect(result.monthlyUrl).toMatch(/^https:\/\/api\.chess\.com\/pub\/player\/hikaru\/games\/\d{4}\/\d{2}$/);
  expect(result.monthlyStatus).toBe(200);
  expect(Array.isArray((result.monthlyBody as { games?: unknown })?.games)).toBe(true);
});
