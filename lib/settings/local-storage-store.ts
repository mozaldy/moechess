import { SETTINGS_KEY, parseSettings, type Settings, type SettingsStore } from "./types";

export class LocalStorageSettingsStore implements SettingsStore {
  private memory: Settings | null = null;
  private isAvailable = true;

  constructor(private readonly storage: Storage | null) {
    if (!storage) this.isAvailable = false;
  }

  load(): Settings {
    if (this.memory) return { ...this.memory };
    let text: string | null = null;
    if (this.storage) {
      try {
        text = this.storage.getItem(SETTINGS_KEY);
      } catch {
        this.isAvailable = false;
      }
    }
    this.memory = parseSettings(text);
    return { ...this.memory };
  }

  save(settings: Settings): void {
    this.memory = parseSettings(JSON.stringify(settings));
    if (!this.storage || !this.isAvailable) return;
    try {
      this.storage.setItem(SETTINGS_KEY, JSON.stringify(this.memory));
    } catch {
      this.isAvailable = false;
    }
  }

  available(): boolean {
    return this.isAvailable;
  }
}
