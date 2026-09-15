import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { BranchMap } from "@/components/branch-map/BranchMap";
import { buildCourseTree, parsePgnFile } from "@/lib/course/build-tree";
import type { CourseMeta } from "@/lib/course/types";

const meta: CourseMeta = { slug: "ruy", name: "Ruy Lopez", eco: [], mainSide: "white", credits: [], contentLicense: "CC0" };
const tree = buildCourseTree(meta, parsePgnFile("ruy/lines.pgn", `[LineId "berlin"]
[LineName "Berlin"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 4. O-O *

[LineId "morphy"]
[LineName "Morphy"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 *
`));

function setup(props: Partial<Parameters<typeof BranchMap>[0]> = {}) {
  const onSelect = vi.fn();
  const utils = render(
    <BranchMap
      tree={tree}
      currentNodeId="e4 e5 Nf3"
      learnedLineIds={new Set(["berlin"])}
      dueNodeIds={new Set(["e4 e5 Nf3 Nc6 Bb5 Nf6"])}
      onSelect={onSelect}
      {...props}
    />,
  );
  return { onSelect, ...utils };
}

describe("BranchMap", () => {
  test("labels stations with move numbers and line names", () => {
    setup();
    expect(screen.getByRole("navigation", { name: "Ruy Lopez lines" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2... Nc6" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "4. O-O, Berlin" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2. Nf3" })).toHaveAttribute("aria-current", "step");
  });

  test("clicking a station selects that position", () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByRole("button", { name: "3... a6" }));
    expect(onSelect).toHaveBeenCalledWith("e4 e5 Nf3 Nc6 Bb5 a6");
  });

  test("learned routes and due stations carry state hooks", () => {
    const { container } = setup();
    expect(container.querySelectorAll('.mc-branch[data-state="learned"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.mc-branch[data-state="unlearned"]').length).toBeGreaterThan(0);
    expect(container.querySelector('.mc-station[data-state="due"]')).not.toBeNull();
    expect(container.querySelector('.mc-station[data-state="current"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "3... Nf6, due for review" })).toBeInTheDocument();
    expect(container.querySelector('.mc-branch-label[data-state="learned"]')).toHaveTextContent("Berlin");
    // 1... e5 is a plain ply; 3. Bb5 is where the lines split.
    expect(container.querySelectorAll('.mc-station[data-role="pass"]').length).toBeGreaterThan(0);
    const stops = container.querySelectorAll('.mc-station[data-role="stop"]');
    expect(stops.length).toBeLessThan(container.querySelectorAll(".mc-station").length);
  });

  test("collapsed branches open when clicked", () => {
    setup({ collapseDepth: 3, currentNodeId: "e4" });
    const stub = screen.getByRole("button", { name: "Show 2 more lines after 2. Nf3" });
    fireEvent.click(stub);
    expect(screen.getByRole("button", { name: "2... Nc6" })).toBeInTheDocument();
  });

  test("only the current station is in the tab order", () => {
    setup();
    const tabbable = screen.getAllByRole("button").filter((button) => button.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAccessibleName("2. Nf3");
  });

  test("the first station is tabbable when no station is current", () => {
    setup({ currentNodeId: "missing" });
    const tabbable = screen.getAllByRole("button").filter((button) => button.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAccessibleName("Start");
  });

  test("arrow keys move focus between stations", async () => {
    setup();
    const user = userEvent.setup();
    screen.getByRole("button", { name: "2. Nf3" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "2... Nc6" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("button", { name: "2. Nf3" })).toHaveFocus();

    // 3. Bb5 splits into two lanes; move sideways to the other branch at the same depth.
    screen.getByRole("button", { name: "3... Nf6, due for review" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "3... a6" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("button", { name: "3... Nf6, due for review" })).toHaveFocus();
  });

  test("a non-interactive map renders no station buttons", () => {
    const { container } = setup({ interactive: false });
    expect(screen.getByRole("navigation", { name: "Ruy Lopez lines" })).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.querySelectorAll(".mc-station").length).toBeGreaterThan(0);
  });

  test("a newly learned line gets a stamp", () => {
    setup({ stampLineId: "morphy" });
    expect(screen.getByRole("status")).toHaveTextContent("Learned!");
  });
});
