import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ImportForm } from "@/components/assessment/ImportForm";

describe("ImportForm", () => {
  test("imports a typed Chess.com username", async () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    render(<ImportForm busy={false} players={[]} onImport={onImport} onSelect={vi.fn()} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Chess.com username" }), "Learner");
    await userEvent.click(screen.getByRole("button", { name: "Import games" }));
    expect(onImport).toHaveBeenCalledWith("Learner");
  });

  test("selects an existing player", async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    render(<ImportForm busy={false} players={[{ key: "learner", displayName: "Learner" }]} onImport={vi.fn()} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: "Open Learner" }));
    expect(onSelect).toHaveBeenCalledWith("learner");
  });
});
