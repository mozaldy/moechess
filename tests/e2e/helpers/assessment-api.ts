import type { Page } from "@playwright/test";

/** Only the public archive endpoints used by the learner fixture are intercepted. */
export async function mockAssessmentApi(page: Page, games: unknown[]): Promise<void> {
  const months = new Map<string, unknown[]>();
  for (const game of games) {
    const endTime = (game as { end_time: number }).end_time;
    const month = new Date(endTime * 1000).toISOString().slice(0, 7).replace("-", "/");
    months.set(month, [...(months.get(month) ?? []), game]);
  }
  await page.route("https://api.chess.com/pub/player/learner/games/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const month = pathname.split("/").slice(-2).join("/");
    const json = pathname.endsWith("/archives")
      ? { archives: [...months.keys()].sort().map((key) => `https://api.chess.com/pub/player/learner/games/${key}`) }
      : { games: months.get(month) ?? [] };
    await route.fulfill({ status: 200, json, headers: { "access-control-allow-origin": "*" } });
  });
}
