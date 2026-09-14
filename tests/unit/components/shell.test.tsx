import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { CourseList } from "@/components/home/CourseList";
import { TopBar } from "@/components/nav/TopBar";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { WorkspaceProvider } from "@/components/workspace/Providers";
import { buildCourseTree, parsePgnFile } from "@/lib/course/build-tree";
import type { CourseMeta } from "@/lib/course/types";
import { MemoryProgressStore } from "@/lib/progress/memory-store";
import { learnedLineKey } from "@/lib/progress/types";
import { emptySnapshot } from "@/lib/progress/validate";
import { LocalStorageSettingsStore } from "@/lib/settings/local-storage-store";
import { cardsForLine, generateCards } from "@/lib/training/cards";
import { DAY_MS, learnCards, newCardState } from "@/lib/training/scheduler";

vi.mock("next/navigation", () => ({ usePathname: () => "/course/ruy" }));

const NOW = new Date("2026-03-02T09:00:00.000Z");
const meta: CourseMeta = { slug: "ruy", name: "Ruy Lopez", eco: [], mainSide: "white", credits: [], contentLicense: "CC0" };
const tree = buildCourseTree(meta, parsePgnFile("ruy/lines.pgn", `[LineId "a"]
[LineName "A"]

1. e4 e5 2. Nf3 *

[LineId "b"]
[LineName "B"]

1. e4 c5 2. Nf3 *
`));

function withProvider(ui: React.ReactNode, store = new MemoryProgressStore()) {
  return render(
    <WorkspaceProvider progressStore={store} settingsStore={new LocalStorageSettingsStore(localStorage)} now={() => NOW}>
      {ui}
    </WorkspaceProvider>,
  );
}

describe("TopBar", () => {
  test("marks the current section and switches sides", () => {
    withProvider(<TopBar />);
    expect(screen.getByRole("link", { name: "Courses" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Review" })).not.toHaveAttribute("aria-current");
    fireEvent.click(screen.getByRole("radio", { name: "Black" }));
    expect(screen.getByRole("radio", { name: "Black" })).toBeChecked();
    expect(JSON.parse(localStorage.getItem("moechess:settings")!).side).toBe("black");
  });
});

describe("SettingsForm", () => {
  test("switching theme applies it to the page", async () => {
    withProvider(<SettingsForm />);
    fireEvent.click(screen.getByRole("radio", { name: "Night Shift" }));
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "night-shift"));
  });

  test("session size ignores values out of range", () => {
    withProvider(<SettingsForm />);
    const input = screen.getByRole("spinbutton", { name: "Positions per session" });
    fireEvent.change(input, { target: { value: "30" } });
    expect(input).toHaveValue(30);
    fireEvent.change(input, { target: { value: "500" } });
    expect(input).toHaveValue(30);
  });
});

describe("CourseList", () => {
  test("shows learned lines and due reviews for the chosen side", async () => {
    const learnedAt = new Date(NOW.getTime() - DAY_MS);
    const specs = generateCards([tree], "white");
    const snapshot = emptySnapshot();
    for (const card of learnCards(cardsForLine(tree, tree.lines[0], "white").map((id) => newCardState(specs.get(id)!, learnedAt)), learnedAt)) {
      snapshot.cards[card.id] = card;
    }
    snapshot.learnedLines[learnedLineKey("ruy", "white", "a")] = { learnedAt: learnedAt.toISOString() };

    withProvider(<CourseList courses={[tree]} />, new MemoryProgressStore(snapshot));
    expect(await screen.findByText("1 of 2 lines learned as white, 2 due for review")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Explore lines" })).toHaveAttribute("href", "/course/ruy");
    expect(screen.getByRole("link", { name: "Review 2 due" })).toHaveAttribute("href", "/review");
  });
});
