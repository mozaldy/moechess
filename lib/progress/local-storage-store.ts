import { MemoryProgressStore } from "./memory-store";
import type { CardState, ProgressSnapshot, ProgressStore, StoreStatus } from "./types";
import { emptySnapshot, parseSnapshot } from "./validate";

export const PROGRESS_KEY = "moechess:progress";

export class LocalStorageProgressStore implements ProgressStore {
  private memory: MemoryProgressStore | null = null;
  private currentStatus: StoreStatus = { kind: "ok" };

  constructor(
    private readonly storage: Storage | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  status(): StoreStatus {
    return this.currentStatus;
  }

  async load(): Promise<ProgressSnapshot> {
    return this.ensureLoaded().load();
  }

  async saveCards(cards: CardState[]): Promise<void> {
    await this.ensureLoaded().saveCards(cards);
    await this.persist();
  }

  async markLineLearned(key: string, learnedAt: string): Promise<void> {
    await this.ensureLoaded().markLineLearned(key, learnedAt);
    await this.persist();
  }

  async setExplorePosition(slug: string, nodeId: string): Promise<void> {
    await this.ensureLoaded().setExplorePosition(slug, nodeId);
    await this.persist();
  }

  private ensureLoaded(): MemoryProgressStore {
    if (!this.memory) this.memory = new MemoryProgressStore(this.readInitial());
    return this.memory;
  }

  private readInitial(): ProgressSnapshot {
    if (!this.storage) {
      this.currentStatus = { kind: "unavailable" };
      return emptySnapshot();
    }
    let text: string | null;
    try {
      text = this.storage.getItem(PROGRESS_KEY);
    } catch {
      this.currentStatus = { kind: "unavailable" };
      return emptySnapshot();
    }

    const result = parseSnapshot(text);
    if (result.kind === "newer") {
      this.currentStatus = { kind: "newer-schema", version: result.version };
      return emptySnapshot();
    }
    if (result.kind === "ok" && result.dropped === 0) return result.snapshot;

    const snapshot = result.kind === "ok" ? result.snapshot : emptySnapshot();
    const backupKey = `${PROGRESS_KEY}:backup:${this.now().toISOString()}`;
    try {
      this.storage.setItem(backupKey, text ?? "");
      this.storage.setItem(PROGRESS_KEY, JSON.stringify(snapshot));
      this.currentStatus = { kind: "recovered", backupKey };
    } catch {
      this.currentStatus = { kind: "unavailable" };
    }
    return snapshot;
  }

  private async persist(): Promise<void> {
    const kind = this.currentStatus.kind;
    if (!this.storage || !this.memory || kind === "newer-schema" || kind === "unavailable") return;
    try {
      this.storage.setItem(PROGRESS_KEY, JSON.stringify(await this.memory.load()));
    } catch {
      this.currentStatus = { kind: "unavailable" };
    }
  }
}
