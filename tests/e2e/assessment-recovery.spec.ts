import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { rawGame } from "../fixtures/assessment";
import { mockAssessmentApi } from "./helpers/assessment-api";

async function importLearner(page: Page, games: unknown[]): Promise<void> {
  await mockAssessmentApi(page, games);
  await page.goto("/assessment");
  await page.getByRole("textbox", { name: "Chess.com username" }).fill("learner");
  await page.getByRole("button", { name: "Import games" }).click();
}

async function ruyPgn(): Promise<string> {
  return (await readFile(path.join(process.cwd(), "tests/fixtures/assessment-performance.pgn"), "utf8"))
    .split(/(?=\[Event )/)[0].trim();
}

async function completedAnalysisTimes(page: Page): Promise<Record<string, string>> {
  return page.evaluate(async () => new Promise<Record<string, string>>((resolve, reject) => {
    const request = indexedDB.open("moechess-assessment");
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("analyses", "readonly");
      const all = transaction.objectStore("analyses").getAll();
      all.onsuccess = () => resolve(Object.fromEntries(all.result.map((item) => [item.gameId, item.completedAt])));
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
    request.onerror = () => reject(request.error);
  }));
}

test("rate limit explains the wait and a later import can retry", async ({ page }) => {
  await page.route("https://api.chess.com/pub/player/learner/games/archives", async (route) => {
    await route.fulfill({ status: 429, body: "{}", headers: {
      "retry-after": "1", "access-control-allow-origin": "*",
    } });
  });
  await page.goto("/assessment");
  await page.getByRole("textbox", { name: "Chess.com username" }).fill("learner");
  await page.getByRole("button", { name: "Import games" }).click();
  await expect(page.getByText("Chess.com is limiting requests. Try again after the wait shown below.")).toBeVisible();
  await page.unroute("https://api.chess.com/pub/player/learner/games/archives");
  await mockAssessmentApi(page, [rawGame({ end_time: Math.floor(Date.now() / 1000) - 1 })]);
  await page.getByRole("button", { name: "Import games" }).click();
  await expect(page.getByRole("button", { name: "Start analysis" })).toBeVisible();
});

test("another tab cannot import while an assessment lock is held", async ({ context, page }) => {
  await page.goto("/assessment");
  await page.evaluate(() => {
    const holder = window as Window & { releaseAssessment?: () => void };
    void navigator.locks.request("moechess:assessment", async () => {
      await new Promise<void>((resolve) => { holder.releaseAssessment = resolve; });
    });
  });
  await expect.poll(() => page.evaluate(() => Boolean(
    (window as Window & { releaseAssessment?: () => void }).releaseAssessment))).toBe(true);
  const second = await context.newPage();
  await importLearner(second, [rawGame({ end_time: Math.floor(Date.now() / 1000) - 1 })]);
  await expect(second.getByText("Another tab is analyzing games. Close it or wait, then resume.")).toBeVisible();
  await page.close();
  await second.getByRole("button", { name: "Import games" }).click();
  await expect(second.getByRole("button", { name: "Start analysis" })).toBeVisible();
});

test("deleting a saved report remains deleted after reload", async ({ page }) => {
  await importLearner(page, [rawGame({ end_time: Math.floor(Date.now() / 1000) - 1 })]);
  await expect(page.getByRole("button", { name: "Start analysis" })).toBeVisible();
  await page.getByRole("button", { name: "Start analysis" }).click();
  await expect(page.getByText("1 of 1 games analyzed", { exact: true })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: "Delete local data for learner" }).click();
  await page.getByRole("button", { name: "Delete local data", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open learner" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Open learner" })).toHaveCount(0);
});

test("a saved report remains readable when Web Locks become unavailable", async ({ page }) => {
  await importLearner(page, [rawGame({ end_time: Math.floor(Date.now() / 1000) - 1 })]);
  await expect(page.getByRole("button", { name: "Start analysis" })).toBeVisible();
  await page.getByRole("button", { name: "Start analysis" }).click();
  await expect(page.getByText("1 of 1 games analyzed", { exact: true })).toBeVisible({ timeout: 120_000 });
  await page.addInitScript(() => Object.defineProperty(navigator, "locks", { value: undefined, configurable: true }));
  await page.reload();
  await page.getByRole("button", { name: "Open learner" }).click();
  await expect(page.getByText("1 of 1 games analyzed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start analysis" }).click();
  await expect(page.getByText("This browser cannot run this assessment. Try a current browser with local storage and Web Locks.")).toBeVisible();
});

test("corrupt saved evidence is excluded after reload", async ({ page }) => {
  await importLearner(page, [rawGame({ end_time: Math.floor(Date.now() / 1000) - 1 })]);
  await expect(page.getByRole("button", { name: "Start analysis" })).toBeVisible();
  await page.getByRole("button", { name: "Start analysis" }).click();
  await expect(page.getByText("1 of 1 games analyzed", { exact: true })).toBeVisible({ timeout: 120_000 });
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("moechess-assessment");
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("analyses", "readwrite");
        const analyses = transaction.objectStore("analyses");
        const all = analyses.getAll();
        all.onsuccess = () => {
          for (const analysis of all.result) analyses.put({ ...analysis, findings: [{ theme: "hanging" }] });
        };
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => { database.close(); reject(transaction.error); };
      };
      request.onerror = () => reject(request.error);
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "Open learner" }).click();
  await expect(page.getByText("0 of 1 games analyzed", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Example from your game" })).toHaveCount(0);
});

test("pause after a checkpoint, reload, and resume without recomputing it", async ({ page }) => {
  test.setTimeout(240_000);
  const now = Math.floor(Date.now() / 1000);
  const pgn = await ruyPgn();
  const longGame = (n: number) => rawGame({
    uuid: `ruy-${n}`, url: `https://www.chess.com/game/live/${8000 + n}`,
    pgn, end_time: now - n,
    white: { username: "learner", rating: 900, result: "win" },
    black: { username: "self-play", rating: 950, result: "resigned" },
  });
  await importLearner(page, [
    rawGame({ uuid: "quick", url: "https://www.chess.com/game/live/8000", end_time: now }),
    longGame(1), longGame(2),
  ]);
  await expect(page.getByText("0 of 3 games analyzed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start analysis" }).click();
  await expect(page.getByText("1 of 3 games analyzed", { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect.poll(async () => (await completedAnalysisTimes(page)).quick).toBeTruthy();
  const before = await completedAnalysisTimes(page);
  expect(before.quick).toBeDefined();
  const started = Date.now();
  await page.getByRole("button", { name: "Pause assessment" }).click();
  await expect(page.locator(".mc-assessment[data-state='paused']")).toBeVisible({ timeout: 10_000 });
  const cancelObservedMs = Date.now() - started;
  console.log(JSON.stringify({ cancelObservedMs }));
  expect(cancelObservedMs).toBeLessThan(1_000);
  await page.reload();
  await page.getByRole("button", { name: "Open learner" }).click();
  await expect(page.getByText("1 of 3 games analyzed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resume analysis" }).click();
  await expect(page.getByText("3 of 3 games analyzed", { exact: true })).toBeVisible({ timeout: 180_000 });
  const after = await completedAnalysisTimes(page);
  expect(after.quick).toBe(before.quick);
});

test("pausing before the first checkpoint leaves the game unfinished", async ({ page }) => {
  test.setTimeout(120_000);
  const now = Math.floor(Date.now() / 1000);
  await importLearner(page, [rawGame({
    uuid: "early-cancel", url: "https://www.chess.com/game/live/8100", end_time: now,
    pgn: await ruyPgn(),
    white: { username: "learner", rating: 900, result: "win" },
    black: { username: "self-play", rating: 950, result: "resigned" },
  })]);
  await page.getByRole("button", { name: "Start analysis" }).click();
  await expect(page.locator(".mc-assessment[data-state='analyzing']")).toBeVisible();
  await page.getByRole("button", { name: "Pause assessment" }).click();
  await expect(page.getByText("0 of 1 games analyzed", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Open learner" }).click();
  await expect(page.getByText("0 of 1 games analyzed", { exact: true })).toBeVisible();
});

test("a failed engine asset load can be retried", async ({ page }) => {
  test.setTimeout(120_000);
  await importLearner(page, [rawGame({ end_time: Math.floor(Date.now() / 1000) - 1 })]);
  await page.route("**/engines/stockfish/stockfish-19-lite-single.js", (route) => route.abort());
  await page.getByRole("button", { name: "Start analysis" }).click();
  await expect(page.locator(".mc-assessment[data-state='paused']")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("0 of 1 games analyzed", { exact: true })).toBeVisible();
  await page.unroute("**/engines/stockfish/stockfish-19-lite-single.js");
  await page.getByRole("button", { name: "Resume analysis" }).click();
  await expect(page.getByText("1 of 1 games analyzed", { exact: true })).toBeVisible({ timeout: 90_000 });
});

test("refresh replaces the selected game set after the cooldown", async ({ page }) => {
  const now = Math.floor(Date.now() / 1000);
  await importLearner(page, [rawGame({
    uuid: "old-game", url: "https://www.chess.com/game/live/8301", end_time: now - 2,
  })]);
  await expect(page.getByRole("button", { name: "Start analysis" })).toBeVisible();
  await page.evaluate(async () => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("moechess-assessment");
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("players", "readwrite");
      const players = transaction.objectStore("players");
      const get = players.get("learner");
      get.onsuccess = () => players.put({ ...get.result, refreshAfter: "2000-01-01T00:00:00.000Z" });
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
    request.onerror = () => reject(request.error);
  }));
  await page.unroute("https://api.chess.com/pub/player/learner/games/**");
  await mockAssessmentApi(page, [rawGame({
    uuid: "new-game", url: "https://www.chess.com/game/live/8302", end_time: now - 1,
  })]);
  await page.getByRole("button", { name: "Refresh games" }).click();
  await expect(page.locator(".mc-assessment[data-state='ready']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start analysis" })).toBeVisible();
  await expect.poll(async () => page.evaluate(async () => new Promise<string[]>((resolve, reject) => {
    const request = indexedDB.open("moechess-assessment");
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("games", "readonly");
      const all = transaction.objectStore("games").getAll();
      all.onsuccess = () => resolve(all.result.map((game) => game.id));
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
    request.onerror = () => reject(request.error);
  }))).toEqual(["new-game"]);
});

test("switching usernames never shows the previous player's report", async ({ page }) => {
  await importLearner(page, [rawGame({ end_time: Math.floor(Date.now() / 1000) - 1 })]);
  await page.getByRole("button", { name: "Start analysis" }).click();
  await expect(page.getByText("1 of 1 games analyzed", { exact: true })).toBeVisible({ timeout: 120_000 });
  await page.locator(".mc-study-priority summary").first().click();
  await page.getByRole("button", { name: /Inspect example 1/ }).first().click();
  await expect(page.getByRole("heading", { name: "Example from your game" })).toBeVisible();
  await page.route("https://api.chess.com/pub/player/rival/games/**", async (route) => {
    await route.fulfill({ status: 200,
      json: { archives: [] }, headers: { "access-control-allow-origin": "*" },
    });
  });
  await page.getByRole("textbox", { name: "Chess.com username" }).fill("rival");
  await page.getByRole("button", { name: "Import games" }).click();
  await expect(page.getByText("No eligible rated rapid games were found in the selected period.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Example from your game" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open learner" }).click();
  await expect(page.getByText("1 of 1 games analyzed", { exact: true })).toBeVisible();
});

test("storage quota failure offers explicit session-only continuation", async ({ page }) => {
  test.setTimeout(120_000);
  await importLearner(page, [rawGame({ end_time: Math.floor(Date.now() / 1000) - 1 })]);
  await expect(page.getByRole("button", { name: "Start analysis" })).toBeVisible();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    Object.defineProperty(IDBObjectStore.prototype, "put", {
      configurable: true,
      value: new Proxy(original, {
        apply(target, thisArg: IDBObjectStore, args) {
          if (thisArg.name === "analyses") throw new DOMException("Quota exceeded", "QuotaExceededError");
          return Reflect.apply(target, thisArg, args);
        },
      }),
    });
  });
  await page.getByRole("button", { name: "Start analysis" }).click();
  await expect(page.getByText("Browser storage is full.")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("button", { name: "Continue for this session" })).toBeVisible();
  await page.getByRole("button", { name: "Continue for this session" }).click();
  await expect(page.getByText("Session only: results will be lost when this tab closes.")).toBeVisible();
  await page.getByRole("button", { name: "Resume analysis" }).click();
  await expect(page.getByText("1 of 1 games analyzed", { exact: true })).toBeVisible({ timeout: 90_000 });
});

test("deletion during engine work cannot restore a late result", async ({ page }) => {
  test.setTimeout(120_000);
  await importLearner(page, [rawGame({
    uuid: "delete-during-engine", url: "https://www.chess.com/game/live/8401",
    end_time: Math.floor(Date.now() / 1000) - 1,
    pgn: await ruyPgn(),
    white: { username: "learner", rating: 900, result: "win" },
    black: { username: "self-play", rating: 950, result: "resigned" },
  })]);
  await page.getByRole("button", { name: "Start analysis" }).click();
  await expect(page.locator(".mc-assessment[data-state='analyzing']")).toBeVisible();
  await page.getByRole("button", { name: "Delete local data for learner" }).click();
  await page.getByRole("button", { name: "Delete local data", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open learner" })).toHaveCount(0);
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.getByRole("button", { name: "Open learner" })).toHaveCount(0);
});
