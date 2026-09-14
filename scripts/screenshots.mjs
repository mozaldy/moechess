// Visual review: captures key pages at three widths in both built-in themes.
// Usage: pnpm build && pnpm start   (in one terminal)
//        node scripts/screenshots.mjs [baseUrl]   (in another; default http://localhost:3000)
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const outDir = "test-results/screenshots";
mkdirSync(outDir, { recursive: true });

async function type(page, sans) {
  const input = page.getByRole("textbox", { name: "Type a move" });
  for (const san of sans) {
    await page.waitForFunction(() => !document.querySelector(".mc-move-input input")?.disabled);
    await input.fill(san);
    await input.press("Enter");
  }
}

const pages = [
  { name: "home", path: "/" },
  {
    name: "explore",
    path: "/course/ruy-lopez",
    setup: async (page) => {
      await type(page, ["e4", "e5", "Nf3", "Nc6", "Bb5"]);
      await page.waitForTimeout(2500);
    },
  },
  {
    name: "learn",
    path: "/course/ruy-lopez/learn/marshall",
    setup: async (page) => {
      await type(page, ["e4", "Nf3", "Bb5", "Ba4", "O-O", "Re1", "Bb3"]);
      await page.waitForTimeout(2500);
      await type(page, ["d4"]);
      await page.waitForTimeout(150);
    },
  },
  { name: "settings", path: "/settings" },
];

const viewports = [
  { width: 1440, height: 900 },
  { width: 820, height: 1180 },
  { width: 390, height: 844 },
];

const browser = await chromium.launch();
for (const theme of ["summer-sky", "night-shift"]) {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript((themeId) => {
      localStorage.setItem("moechess:settings", JSON.stringify({ schemaVersion: 1, side: "white", sessionSize: 20, themeId }));
    }, theme);
    for (const shot of pages) {
      if (viewport.width === 820 && !["explore", "learn"].includes(shot.name)) continue;
      const page = await context.newPage();
      await page.goto(base + shot.path, { waitUntil: "networkidle" });
      if (shot.setup) await shot.setup(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 0) console.warn(`horizontal scroll: ${shot.name} ${theme} ${viewport.width}px overflows by ${overflow}px`);
      const file = `${outDir}/${shot.name}-${theme}-${viewport.width}.png`;
      await page.screenshot({ path: file, fullPage: viewport.width === 390 });
      console.log(file);
      await page.close();
    }
    await context.close();
  }
}
await browser.close();
