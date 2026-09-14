import { expect, test, type Page } from "@playwright/test";

const BERLIN_WHITE_MOVES = ["e4", "Nf3", "Bb5", "O-O", "d4", "Bxc6", "dxe5", "Qxd8+", "Nc3", "h3"];

async function play(page: Page, san: string) {
  const input = page.getByRole("textbox", { name: "Type a move" });
  await expect(input).toBeEnabled();
  await input.fill(san);
  await input.press("Enter");
}

test("learn the Berlin, reload, and review it the next day", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-03-01T09:00:00.000Z") });

  await page.goto("/course/ruy-lopez/learn/berlin");
  await expect(page.getByRole("heading", { name: "Berlin Defence" })).toBeVisible();

  await expect(page.getByText("Step 1 of 2: follow the highlighted moves")).toBeVisible();
  for (const san of BERLIN_WHITE_MOVES) await play(page, san);

  await expect(page.getByText("Step 2 of 2: play the line from memory")).toBeVisible();
  for (const san of BERLIN_WHITE_MOVES) await play(page, san);

  await expect(page.getByRole("status").filter({ hasText: "Learned!" })).toBeVisible();

  await page.reload();
  await page.goto("/review");
  await expect(page.getByRole("heading", { name: "Nothing is due right now" })).toBeVisible();

  await page.clock.fastForward("24:00:00");
  await page.goto("/review");
  await expect(page.getByRole("heading", { name: "Berlin Defence" })).toBeVisible();
  for (const san of BERLIN_WHITE_MOVES) await play(page, san);

  await expect(page.getByRole("heading", { name: "Review done" })).toBeVisible();
  await expect(page.getByText("10 remembered, 0 to practise again.")).toBeVisible();

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("moechess:progress") ?? "{}"));
  const dues = Object.values(saved.cards as Record<string, { fsrs: { due: string } }>).map((card) => Date.parse(card.fsrs.due));
  expect(dues).toHaveLength(10);
  for (const due of dues) expect(due).toBeGreaterThan(Date.parse("2026-03-03T09:00:00.000Z"));
});

test("a saved theme is applied before the page paints", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("moechess:settings", JSON.stringify({ schemaVersion: 1, side: "white", sessionSize: 20, themeId: "night-shift" }));
    // Record the theme when <body> is inserted: the <head> boot script has run, React has not.
    const record = () => {
      (window as unknown as { __themeAtBody?: string | null }).__themeAtBody = document.documentElement.getAttribute("data-theme");
    };
    new MutationObserver((_, observer) => {
      if (document.body) {
        record();
        observer.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto("/");
  expect(await page.evaluate(() => (window as unknown as { __themeAtBody?: string | null }).__themeAtBody)).toBe("night-shift");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "night-shift");
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(26, 20, 51)");
});
