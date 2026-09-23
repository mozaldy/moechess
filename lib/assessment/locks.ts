export async function withAssessmentLock<T>(
  work: () => Promise<T>,
  locks: LockManager | undefined = typeof navigator === "undefined" ? undefined : navigator.locks,
): Promise<T> {
  if (!locks) throw new Error("unsupported");
  return locks.request(
    "moechess:assessment",
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      if (!lock) throw new Error("busy");
      return work();
    },
  );
}
