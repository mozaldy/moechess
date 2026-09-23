import { describe, expect, test, vi } from "vitest";

import { withAssessmentLock } from "@/lib/assessment/locks";

function locksWith(value: Lock | null): LockManager {
  return {
    request: vi.fn(async (
      _name: string,
      _options: LockOptions,
      callback: (lock: Lock | null) => unknown,
    ) => callback(value)),
    query: vi.fn(),
  } as unknown as LockManager;
}

describe("withAssessmentLock", () => {
  test("runs work while holding the shared exclusive lock", async () => {
    const work = vi.fn(async () => "done");
    const locks = locksWith({ name: "moechess:assessment", mode: "exclusive" });

    await expect(withAssessmentLock(work, locks)).resolves.toBe("done");
    expect(work).toHaveBeenCalledOnce();
    expect(locks.request).toHaveBeenCalledWith(
      "moechess:assessment",
      { mode: "exclusive", ifAvailable: true },
      expect.any(Function),
    );
  });

  test("rejects busy before invoking work", async () => {
    const work = vi.fn(async () => undefined);

    await expect(withAssessmentLock(work, locksWith(null))).rejects.toThrow("busy");
    expect(work).not.toHaveBeenCalled();
  });

  test("rejects unsupported before invoking work", async () => {
    const work = vi.fn(async () => undefined);

    await expect(withAssessmentLock(work, undefined)).rejects.toThrow("unsupported");
    expect(work).not.toHaveBeenCalled();
  });
});
