import { expect, test } from "@playwright/test";
import { Chess } from "chess.js";

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
