import type { Side } from "@/lib/chess/position";
import type { Commentary } from "@/lib/course/types";
import type { CardId } from "@/lib/training/cards";
import type { ReviewRating } from "@/lib/training/scheduler";

export interface SessionStats {
  graded: number;
  good: number;
  again: number;
  mistakes: number;
}

export type WorkspaceEvent =
  | { type: "moveMade"; san: string; by: "learner" | "opponent"; nodeId: string }
  | { type: "mistake"; played: string; expected: string; cardId?: CardId }
  | { type: "cardReviewed"; cardId: CardId; rating: ReviewRating }
  | { type: "lineLearned"; courseSlug: string; lineId: string; side: Side }
  | { type: "commentaryShown"; nodeId: string; commentary: Commentary }
  | { type: "sessionEnded"; mode: "learn" | "review"; stats: SessionStats };

export type WorkspaceEventType = WorkspaceEvent["type"];
export type EventOf<T extends WorkspaceEventType> = Extract<WorkspaceEvent, { type: T }>;

export interface EventBus {
  emit(event: WorkspaceEvent): void;
  on<T extends WorkspaceEventType>(type: T, handler: (event: EventOf<T>) => void): () => void;
  onAny(handler: (event: WorkspaceEvent) => void): () => void;
}

type AnyHandler = (event: WorkspaceEvent) => void;

// One failing subscriber (for example a future companion) must never break
// training, so handler errors are reported and swallowed.
export function createEventBus(onError: (error: unknown) => void = console.error): EventBus {
  const handlers = new Set<{ type: WorkspaceEventType | "*"; handler: AnyHandler }>();

  const subscribe = (type: WorkspaceEventType | "*", handler: AnyHandler) => {
    const entry = { type, handler };
    handlers.add(entry);
    return () => {
      handlers.delete(entry);
    };
  };

  return {
    emit(event) {
      for (const entry of [...handlers]) {
        if (entry.type !== "*" && entry.type !== event.type) continue;
        try {
          entry.handler(event);
        } catch (error) {
          onError(error);
        }
      }
    },
    on(type, handler) {
      return subscribe(type, handler as AnyHandler);
    },
    onAny(handler) {
      return subscribe("*", handler);
    },
  };
}
