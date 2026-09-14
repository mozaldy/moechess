"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore,
  type ReactNode,
} from "react";
import { createEventBus, type EventBus } from "@/lib/events/bus";
import { LocalStorageProgressStore } from "@/lib/progress/local-storage-store";
import type { ProgressSnapshot, ProgressStore, StoreStatus } from "@/lib/progress/types";
import { LocalStorageSettingsStore } from "@/lib/settings/local-storage-store";
import { createSettingsSource, type SettingsSource } from "@/lib/settings/source";
import { DEFAULT_SETTINGS, type Settings, type SettingsStore } from "@/lib/settings/types";
import { applyTheme } from "@/lib/theme/apply";
import { getTheme } from "@/lib/theme/themes";

export interface WorkspaceContextValue {
  // null until progress has loaded on the client
  snapshot: ProgressSnapshot | null;
  status: StoreStatus;
  settings: Settings;
  updateSettings: SettingsSource["set"];
  events: EventBus;
  now: () => Date;
  // Runs a write against the progress store, then refreshes snapshot and status.
  commitProgress: (write: (store: ProgressStore) => Promise<void>) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export interface WorkspaceProviderProps {
  children: ReactNode;
  progressStore?: ProgressStore;
  settingsStore?: SettingsStore;
  now?: () => Date;
}

const systemNow = () => new Date();

export function WorkspaceProvider({ children, progressStore, settingsStore, now = systemNow }: WorkspaceProviderProps) {
  const [progress] = useState(() => progressStore ?? new LocalStorageProgressStore(browserStorage()));
  const [settingsSource] = useState(() => createSettingsSource(settingsStore ?? new LocalStorageSettingsStore(browserStorage())));
  const [events] = useState(() => createEventBus());
  const [snapshot, setSnapshot] = useState<ProgressSnapshot | null>(null);
  const [status, setStatus] = useState<StoreStatus>({ kind: "ok" });

  const settings = useSyncExternalStore(settingsSource.subscribe, settingsSource.get, () => DEFAULT_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    progress.load().then((loaded) => {
      if (cancelled) return;
      setSnapshot(loaded);
      setStatus(progress.status());
    });
    return () => {
      cancelled = true;
    };
  }, [progress]);

  useEffect(() => {
    applyTheme(document.documentElement, getTheme(settings.themeId));
  }, [settings.themeId]);

  const commitProgress = useCallback(async (write: (store: ProgressStore) => Promise<void>) => {
    try {
      await write(progress);
    } catch (error) {
      // Callers fire and forget; surface the failure through the storage banner instead.
      console.error(error);
      setStatus({ kind: "unavailable" });
      return;
    }
    setSnapshot(await progress.load());
    setStatus(progress.status());
  }, [progress]);

  const value = useMemo<WorkspaceContextValue>(() => ({
    snapshot, status, settings, updateSettings: settingsSource.set, events, now, commitProgress,
  }), [snapshot, status, settings, settingsSource, events, now, commitProgress]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return value;
}
