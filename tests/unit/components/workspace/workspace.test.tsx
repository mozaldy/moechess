import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { StorageBanner } from "@/components/workspace/StorageBanner";
import { WorkspaceProvider, useWorkspace, type WorkspaceContextValue } from "@/components/workspace/Providers";
import { Workspace } from "@/components/workspace/Workspace";
import { MemoryProgressStore } from "@/lib/progress/memory-store";
import type { StoreStatus } from "@/lib/progress/types";
import { emptySnapshot } from "@/lib/progress/validate";
import { LocalStorageSettingsStore } from "@/lib/settings/local-storage-store";

function Probe({ onValue }: { onValue: (value: WorkspaceContextValue) => void }) {
  onValue(useWorkspace());
  return null;
}

describe("WorkspaceProvider", () => {
  test("loads progress on the client and refreshes after a commit", async () => {
    const store = new MemoryProgressStore();
    let latest: WorkspaceContextValue | null = null;
    render(
      <WorkspaceProvider progressStore={store}>
        <Probe onValue={(v) => { latest = v; }} />
      </WorkspaceProvider>,
    );
    await waitFor(() => expect(latest!.snapshot).toEqual(emptySnapshot()));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await latest!.commitProgress((s) => s.setExplorePosition("ruy", "e4"));
    });
    expect(ok).toBe(true);
    expect(latest!.snapshot!.explore.ruy).toEqual({ lastNodeId: "e4" });
    expect(latest!.status).toEqual({ kind: "ok" });
  });

  test("settings updates are saved and apply the theme to the page", async () => {
    let latest: WorkspaceContextValue | null = null;
    render(
      <WorkspaceProvider progressStore={new MemoryProgressStore()} settingsStore={new LocalStorageSettingsStore(localStorage)}>
        <Probe onValue={(v) => { latest = v; }} />
      </WorkspaceProvider>,
    );
    expect(latest!.settings.themeId).toBe("summer-sky");
    act(() => latest!.updateSettings({ themeId: "night-shift" }));
    expect(latest!.settings.themeId).toBe("night-shift");
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "night-shift"));
    expect(JSON.parse(localStorage.getItem("moechess:settings")!).themeId).toBe("night-shift");
  });

  test("the event bus is stable across renders", async () => {
    const seen: WorkspaceContextValue["events"][] = [];
    const { rerender } = render(
      <WorkspaceProvider progressStore={new MemoryProgressStore()}>
        <Probe onValue={(v) => seen.push(v.events)} />
      </WorkspaceProvider>,
    );
    rerender(
      <WorkspaceProvider progressStore={new MemoryProgressStore()}>
        <Probe onValue={(v) => seen.push(v.events)} />
      </WorkspaceProvider>,
    );
    await waitFor(() => expect(seen.length).toBeGreaterThan(1));
    expect(new Set(seen).size).toBe(1);
  });

  test("useWorkspace outside the provider explains the fix", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe onValue={() => {}} />)).toThrowError("useWorkspace must be used inside <WorkspaceProvider>");
    vi.mocked(console.error).mockRestore();
  });
});

describe("StorageBanner", () => {
  const renderWithStatus = async (status: StoreStatus) => {
    render(
      <WorkspaceProvider progressStore={new MemoryProgressStore(emptySnapshot(), status)}>
        <StorageBanner />
      </WorkspaceProvider>,
    );
    if (status.kind !== "ok") await screen.findByRole("status");
  };

  test("shows nothing when storage works", async () => {
    await renderWithStatus({ kind: "ok" });
    await act(async () => {});
    expect(screen.queryByRole("status")).toBeNull();
  });

  test.each([
    [{ kind: "unavailable" } as const, "Progress won't be saved in this browser."],
    [{ kind: "recovered", backupKey: "k" } as const, "Some saved progress couldn't be read and was reset."],
    [{ kind: "newer-schema", version: 2 } as const, "saved by a newer version of Moechess"],
  ])("explains %o", async (status, text) => {
    await renderWithStatus(status);
    expect(screen.getByRole("status")).toHaveTextContent(text);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("a failed progress write shows the banner", async () => {
    const store = new MemoryProgressStore();
    store.saveCards = vi.fn().mockRejectedValue(new Error("disk full"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let latest: WorkspaceContextValue | null = null;
    render(
      <WorkspaceProvider progressStore={store}>
        <Probe onValue={(v) => { latest = v; }} />
        <StorageBanner />
      </WorkspaceProvider>,
    );
    await waitFor(() => expect(latest!.snapshot).toEqual(emptySnapshot()));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await latest!.commitProgress((s) => s.saveCards([]));
    });
    expect(ok).toBe(false);

    expect(screen.getByRole("status")).toHaveTextContent("Progress won't be saved in this browser.");
    expect(consoleError).toHaveBeenCalledWith(expect.any(Error));
    consoleError.mockRestore();
  });
});

describe("Workspace", () => {
  test("renders slots and keeps the companion dock closed when empty", () => {
    const { container } = render(
      <Workspace board={<div>board</div>} dialogue={<div>dialogue</div>} map={<div>map</div>} panel={<div>panel</div>} />,
    );
    expect(container.querySelector(".mc-workspace")).toHaveAttribute("data-dock", "closed");
    expect(container.querySelector(".mc-workspace-dock")).toHaveAttribute("hidden");
    for (const slot of ["board", "dialogue", "map", "panel"]) {
      expect(container.querySelector(`.mc-workspace-${slot}`)).toHaveTextContent(slot);
    }
  });

  test("a docked companion opens the dock", () => {
    const { container } = render(<Workspace board={<div />} dock={<canvas aria-label="Companion" />} />);
    expect(container.querySelector(".mc-workspace-dock")).toHaveAttribute("data-state", "open");
    expect(screen.getByLabelText("Companion")).toBeInTheDocument();
  });

  test("the lines drawer toggles on small screens", () => {
    render(<Workspace board={<div />} map={<div />} />);
    const toggle = screen.getByRole("button", { name: "Show lines" });
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide lines" })).toHaveAttribute("aria-expanded", "true");
  });
});
