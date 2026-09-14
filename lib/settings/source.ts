import { parseSettings, type Settings, type SettingsStore } from "./types";

// A cached, subscribable view of settings for React's useSyncExternalStore.
// get() returns the same object until settings change.
export interface SettingsSource {
  get(): Settings;
  set(patch: Partial<Omit<Settings, "schemaVersion">>): void;
  subscribe(listener: () => void): () => void;
}

export function createSettingsSource(store: SettingsStore): SettingsSource {
  let cached = store.load();
  const listeners = new Set<() => void>();

  return {
    get: () => cached,
    set(patch) {
      cached = parseSettings(JSON.stringify({ ...cached, ...patch }));
      store.save(cached);
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
