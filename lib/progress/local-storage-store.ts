import { MemoryProgressStore } from "./memory-store";
import type { CardState, ProgressSnapshot, ProgressStore, StoreStatus } from "./types";
import { emptySnapshot, parseSnapshot, type ParseResult } from "./validate";

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
    await this.write((store) => store.saveCards(cards));
  }

  async markLineLearned(key: string, learnedAt: string): Promise<void> {
    await this.write((store) => store.markLineLearned(key, learnedAt));
  }

  async setExplorePosition(slug: string, nodeId: string): Promise<void> {
    await this.write((store) => store.setExplorePosition(slug, nodeId));
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

  // Read-merge-write: another tab may have saved since this one loaded, so apply
  // this change on top of what is in storage now rather than on the in-memory copy.
  private async write(apply: (store: MemoryProgressStore) => Promise<void>): Promise<void> {
    this.ensureLoaded();
    const kind = this.currentStatus.kind;
    if (!this.storage || kind === "newer-schema" || kind === "unavailable") {
      await apply(this.memory!);
      return;
    }

    const fresh = this.readFresh();
    if (fresh?.kind === "newer") {
      // Another tab upgraded the schema: keep working in memory, never overwrite it.
      this.currentStatus = { kind: "newer-schema", version: fresh.version };
      await apply(this.memory!);
      return;
    }
    // A corrupt fresh read falls back to the in-memory snapshot.
    if (fresh?.kind === "ok") this.memory = new MemoryProgressStore(fresh.snapshot);
    await apply(this.memory!);
    try {
      this.storage.setItem(PROGRESS_KEY, JSON.stringify(await this.memory!.load()));
    } catch {
      this.currentStatus = { kind: "unavailable" };
    }
  }

  private readFresh(): ParseResult | null {
    try {
      return parseSnapshot(this.storage!.getItem(PROGRESS_KEY));
    } catch {
      return null;
    }
  }
}
