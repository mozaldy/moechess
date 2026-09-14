import { expect, test, vi } from "vitest";
import { LocalStorageSettingsStore } from "@/lib/settings/local-storage-store";
import { createSettingsSource } from "@/lib/settings/source";

test("get is stable until set, and set notifies, validates and saves", () => {
  const store = new LocalStorageSettingsStore(localStorage);
  const source = createSettingsSource(store);
  const first = source.get();
  expect(source.get()).toBe(first);

  const listener = vi.fn();
  const unsubscribe = source.subscribe(listener);
  source.set({ side: "black", sessionSize: 9999 });

  expect(listener).toHaveBeenCalledTimes(1);
  expect(source.get()).not.toBe(first);
  expect(source.get()).toMatchObject({ side: "black", sessionSize: 20 });
  expect(new LocalStorageSettingsStore(localStorage).load().side).toBe("black");

  unsubscribe();
  source.set({ themeId: "night-shift" });
  expect(listener).toHaveBeenCalledTimes(1);
});
