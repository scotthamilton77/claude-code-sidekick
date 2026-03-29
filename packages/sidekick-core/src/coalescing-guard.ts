/**
 * Coalescing concurrency guard: at most one execution per key at a time.
 * If a second request arrives while one is in-flight, it marks a pending rerun.
 * Third+ requests during that window are dropped (already have a pending rerun).
 * On success, pending rerun fires as fire-and-forget. On error, rerun is suppressed.
 */
export class CoalescingGuard<K = string> {
  private inflight = new Map<K, boolean>()

  /** Reset all in-flight state. For use in test teardown. */
  clear(): void {
    this.inflight.clear()
  }

  /** Run fn with coalescing. Returns true if executed, false if coalesced into pending. */
  async run(key: K, fn: () => Promise<void>): Promise<boolean> {
    if (this.inflight.has(key)) {
      this.inflight.set(key, true)
      return false
    }
    this.inflight.set(key, false)
    let succeeded = false
    try {
      await fn()
      succeeded = true
    } finally {
      const rerunPending = this.inflight.get(key)
      this.inflight.delete(key)
      if (rerunPending && succeeded) {
        void this.run(key, fn).catch(() => {
          // Rerun failures are intentionally swallowed — callers
          // handle errors in their own explicit invocations.
        })
      }
    }
    return true
  }
}
