import { describe, expect, test, vi } from "vitest";
import { createEventBus, type WorkspaceEvent } from "@/lib/events/bus";

const move: WorkspaceEvent = { type: "moveMade", san: "e4", by: "learner", nodeId: "e4" };
const learned: WorkspaceEvent = { type: "lineLearned", courseSlug: "ruy", lineId: "berlin", side: "white" };

describe("createEventBus", () => {
  test("typed subscribers only receive their event type", () => {
    const bus = createEventBus();
    const onMove = vi.fn();
    bus.on("moveMade", onMove);
    bus.emit(learned);
    bus.emit(move);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith(move);
  });

  test("onAny receives every event in order", () => {
    const bus = createEventBus();
    const seen: string[] = [];
    bus.onAny((event) => seen.push(event.type));
    bus.emit(move);
    bus.emit(learned);
    expect(seen).toEqual(["moveMade", "lineLearned"]);
  });

  test("unsubscribing stops delivery", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    const off = bus.on("lineLearned", handler);
    off();
    bus.emit(learned);
    expect(handler).not.toHaveBeenCalled();
  });

  test("a throwing handler is reported and does not block other handlers", () => {
    const onError = vi.fn();
    const bus = createEventBus(onError);
    const after = vi.fn();
    bus.onAny(() => {
      throw new Error("companion crashed");
    });
    bus.onAny(after);
    bus.emit(move);
    expect(after).toHaveBeenCalledWith(move);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "companion crashed" }));
  });

  test("handlers added during an emit start with the next event", () => {
    const bus = createEventBus();
    const late = vi.fn();
    bus.onAny(() => {
      bus.onAny(late);
    });
    bus.emit(move);
    expect(late).not.toHaveBeenCalled();
    bus.emit(learned);
    expect(late).toHaveBeenCalledWith(learned);
  });
});
