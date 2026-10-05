const pending = new Map<string, Promise<unknown>>()

/** Shared local-write exclusion. Call once around the complete read/check/write operation. */
export function withWorkMutationLock<T>(workId: string, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(`novel-studio:work:${workId}`, fn)
  }
  const previous = pending.get(workId) ?? Promise.resolve()
  const run = previous.then(fn, fn)
  const settled = run.then(
    () => undefined,
    () => undefined,
  )
  pending.set(workId, settled)
  void settled.then(() => {
    if (pending.get(workId) === settled) pending.delete(workId)
  })
  return run
}
