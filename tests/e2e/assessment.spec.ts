import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { rawGame } from "../fixtures/assessment";
import { mockAssessmentApi } from "./helpers/assessment-api";

test("assesses imported games, preserves training progress, and restores the report", async ({ page }) => {
  test.setTimeout(240_000);
  const progress = JSON.stringify({ schemaVersion: 1, cards: {}, learnedLines: {}, explore: {} });
  await page.addInitScript((value) => localStorage.setItem("moechess:progress", value), progress);
  const now = Math.floor(Date.now() / 1000);
  const games = [1, 2, 3].map((n) => rawGame({
    uuid: `game-${n}`,
    url: `https://www.chess.com/game/live/${1000 + n}`,
    end_time: now - n,
  }));
  await mockAssessmentApi(page, games);

  await page.goto("/assessment");
  await page.getByRole("textbox", { name: "Chess.com username" }).fill("learner");
  await page.getByRole("button", { name: "Import games" }).click();
  await expect(page.getByRole("button", { name: "Start analysis" })).toBeVisible();
  await page.getByRole("button", { name: "Start analysis" }).click();
  await expect(page.getByText("3 of 3 games analyzed", { exact: true })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole("heading", { name: "What to study next" })).toBeVisible();
  await page.locator(".mc-study-priority details").first().locator("summary").click();
  await page.getByRole("button", { name: /Inspect example 1/ }).first().click();
  await expect(page.getByRole("heading", { name: "Example from your game" })).toBeVisible();
  await page.getByRole("button", { name: "Next move" }).click();
  await page.getByRole("button", { name: "Recommended line" }).click();
  await expect(page.getByRole("button", { name: "Recommended line" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("link", { name: "View completed game on Chess.com" })).toHaveAttribute("href", /chess\.com\/game\/live\/100[1-3]/);
  expect(await page.evaluate(() => localStorage.getItem("moechess:progress"))).toBe(progress);
  await page.reload();
  await page.getByRole("button", { name: "Open learner" }).click();
  await expect(page.getByText("3 of 3 games analyzed", { exact: true })).toBeVisible();
});

test("a legal Ruy Lopez game links to the matching course position", async ({ page }) => {
  test.setTimeout(180_000);
  const pgn = (await readFile(path.join(process.cwd(), "tests/fixtures/assessment-performance.pgn"), "utf8"))
    .split(/(?=\[Event )/)[0].trim();
  const game = rawGame({
    uuid: "ruy-example",
    url: "https://www.chess.com/game/live/2001",
    pgn,
    end_time: Math.floor(Date.now() / 1000) - 1,
    white: { username: "learner", rating: 900, result: "win" },
    black: { username: "self-play", rating: 950, result: "resigned" },
  });
  await mockAssessmentApi(page, [game]);
  await page.goto("/assessment");
  await page.getByRole("textbox", { name: "Chess.com username" }).fill("learner");
  await page.getByRole("button", { name: "Import games" }).click();
  await expect(page.getByRole("button", { name: "Start analysis" })).toBeVisible();
  await page.getByRole("button", { name: "Start analysis" }).click();
  await expect(page.getByText("1 of 1 games analyzed", { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("link", { name: "Explore course position" })).toHaveAttribute("href", /\/course\/ruy-lopez\?node=/);
  await page.getByRole("link", { name: "Explore course position" }).click();
  await expect(page).toHaveURL(/\/course\/ruy-lopez\?node=/);
});

test("keyboard users can import, hear progress, and replay evidence", async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockAssessmentApi(page, [rawGame({ end_time: Math.floor(Date.now() / 1000) - 1 })]);
  await page.goto("/assessment");
  await page.getByRole("textbox", { name: "Chess.com username" }).focus();
  await page.keyboard.type("learner");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Start analysis" })).toBeVisible();
  await expect(page.locator(".mc-assessment-status [role=status]")).toHaveAttribute("aria-live", "polite");
  await page.evaluate(() => {
    const owned = window as Window & { __assessmentAnnouncements?: string[] };
    const region = document.querySelector(".mc-assessment-status [role=status]")!;
    owned.__assessmentAnnouncements = [region.textContent ?? ""];
    new MutationObserver(() => owned.__assessmentAnnouncements!.push(region.textContent ?? ""))
      .observe(region, { childList: true, subtree: true, characterData: true });
  });
  await page.getByRole("button", { name: "Start analysis" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("1 of 1 games analyzed", { exact: true })).toBeVisible({ timeout: 90_000 });
  expect(await page.evaluate(() => (window as Window & { __assessmentAnnouncements?: string[] }).__assessmentAnnouncements))
    .toEqual(expect.arrayContaining([
      expect.stringContaining("0 of 1 games analyzed"),
      expect.stringContaining("1 of 1 games analyzed"),
    ]));
  await page.locator(".mc-study-priority summary").first().focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /Inspect example 1/ }).first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("group", { name: "Replay controls" }).locator("[aria-live=polite]")).toBeVisible();
  await page.getByRole("button", { name: "Next move" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Previous move" })).toBeEnabled();
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
});

test("measures the varied 50-game browser batch @performance", async ({ page }, testInfo) => {
  test.skip(process.env.MOECHESS_PERFORMANCE !== "1", "Opt-in 50-game real-engine benchmark");
  test.setTimeout(1_800_000);
  const pgns = (await readFile(path.join(process.cwd(), "tests/fixtures/assessment-performance.pgn"), "utf8"))
    .split(/(?=\[Event )/).map((pgn) => pgn.trim()).filter(Boolean);
  expect(pgns).toHaveLength(50);
  const diagnosticSize = Number(process.env.MOECHESS_PERFORMANCE_GAMES ?? 50);
  expect(Number.isInteger(diagnosticSize) && diagnosticSize >= 1 && diagnosticSize <= 50).toBe(true);
  const now = Math.floor(Date.now() / 1000);
  const games = pgns.slice(0, diagnosticSize).map((pgn, index) => rawGame({
    uuid: `perf-${index + 1}`,
    url: `https://www.chess.com/game/live/${5001 + index}`,
    pgn,
    end_time: now - index,
    white: { username: "learner", rating: 900, result: "win" },
    black: { username: "self-play", rating: 950, result: "resigned" },
  }));
  await mockAssessmentApi(page, games);
  await page.goto("/assessment");
  await page.getByRole("textbox", { name: "Chess.com username" }).fill("learner");
  await page.getByRole("button", { name: "Import games" }).click();
  await expect(page.getByText(`0 of ${diagnosticSize} games analyzed`, { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const owned = window as Window & { __assessmentMetrics?: {
      startedAt: number; samples: Array<{ done: number; elapsedMs: number; heapBytes: number | null }>;
      peakHeapBytes: number | null;
    } };
    const startedAt = performance.now();
    owned.__assessmentMetrics = { startedAt, samples: [], peakHeapBytes: null };
    const memory = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
    const read = () => {
      const label = document.querySelector(".mc-assessment-count")?.textContent ?? "";
      const done = Number(/^\d+/.exec(label)?.[0] ?? 0);
      const heapBytes = memory();
      const previous = owned.__assessmentMetrics?.samples.at(-1)?.done;
      if (done !== previous) owned.__assessmentMetrics?.samples.push({ done, elapsedMs: performance.now() - startedAt, heapBytes });
      if (heapBytes !== null) owned.__assessmentMetrics!.peakHeapBytes = Math.max(owned.__assessmentMetrics!.peakHeapBytes ?? 0, heapBytes);
    };
    const observer = new MutationObserver(read);
    observer.observe(document.querySelector(".mc-assessment-count")!, { subtree: true, childList: true, characterData: true });
    window.setInterval(read, 250);
  });
  await page.getByRole("button", { name: "Start analysis" }).click();
  try {
    await expect(page.getByText(`${diagnosticSize} of ${diagnosticSize} games analyzed`, { exact: true })).toBeVisible({ timeout: 1_700_000 });
  } finally {
    if (!page.isClosed()) {
      const measurements = await page.evaluate((gameCount) => {
        const owned = window as Window & { __assessmentMetrics?: unknown };
        return { gameCount, metrics: owned.__assessmentMetrics,
          browser: navigator.userAgent,
          resources: performance.getEntriesByType("resource").filter((entry) => entry.name.includes("/engines/stockfish/"))
            .map((entry) => ({ name: entry.name, durationMs: entry.duration, transferSize: (entry as PerformanceResourceTiming).transferSize })),
        };
      }, diagnosticSize);
      await writeFile(testInfo.outputPath("assessment-performance.json"), JSON.stringify(measurements, null, 2));
      console.log(JSON.stringify(measurements));
    }
  }
});
