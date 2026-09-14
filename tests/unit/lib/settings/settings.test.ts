import { describe, expect, test } from "vitest";
import { LocalStorageSettingsStore } from "@/lib/settings/local-storage-store";
import { DEFAULT_SETTINGS, SETTINGS_KEY, parseSettings } from "@/lib/settings/types";

describe("parseSettings", () => {
  test("defaults when nothing is saved or the data is unreadable", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("{oops")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("[]")).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({ schemaVersion: 1, side: "white", sessionSize: 20, themeId: "summer-sky" });
  });

  test("keeps valid fields and replaces invalid ones individually", () => {
    expect(parseSettings(JSON.stringify({ side: "black", sessionSize: 1000, themeId: "night-shift" })))
      .toEqual({ schemaVersion: 1, side: "black", sessionSize: 20, themeId: "night-shift" });
    expect(parseSettings(JSON.stringify({ side: "green", sessionSize: 30, themeId: "missing" })))
      .toEqual({ schemaVersion: 1, side: "white", sessionSize: 30, themeId: "summer-sky" });
    expect(parseSettings(JSON.stringify({ sessionSize: 12.5 })).sessionSize).toBe(20);
  });
});

describe("LocalStorageSettingsStore", () => {
  test("saves and reloads", () => {
    new LocalStorageSettingsStore(localStorage).save({ ...DEFAULT_SETTINGS, side: "black", themeId: "night-shift" });
    const loaded = new LocalStorageSettingsStore(localStorage).load();
    expect(loaded).toMatchObject({ side: "black", themeId: "night-shift" });
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).themeId).toBe("night-shift");
  });

  test("keeps settings in memory when storage is blocked", () => {
    const blocked = {
      getItem: () => { throw new DOMException("blocked", "SecurityError"); },
      setItem: () => { throw new DOMException("blocked", "SecurityError"); },
    } as unknown as Storage;
    const store = new LocalStorageSettingsStore(blocked);
    expect(store.load()).toEqual(DEFAULT_SETTINGS);
    store.save({ ...DEFAULT_SETTINGS, sessionSize: 40 });
    expect(store.load().sessionSize).toBe(40);
    expect(store.available()).toBe(false);
  });

  test("works without any storage", () => {
    const store = new LocalStorageSettingsStore(null);
    store.save({ ...DEFAULT_SETTINGS, side: "black" });
    expect(store.load().side).toBe("black");
    expect(store.available()).toBe(false);
  });
});
