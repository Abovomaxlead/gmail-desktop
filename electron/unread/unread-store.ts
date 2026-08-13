// Owns the per-account unread counts behind the taskbar badge and the sidebar
// markers, keyed by accountKey. Reporting 0 forgets the key instead of storing a
// zero, and that is the point: a view that is torn down (a delegated mailbox
// reloading, a discarded probe, a removed account) never reports a fresh number
// again, so a lingering last count would sum into the badge total forever.
export class UnreadStore {
  private counts: Record<string, number> = {};

  /**
   * Records what an account currently has unread
   *
   * @param key accountKey
   * @param count anything not above zero forgets the key
   */
  report(key: string, count: number): void {
    if (Number.isFinite(count) && count > 0) this.counts[key] = count;
    else delete this.counts[key];
  }

  /**
   * Drops an account, so a torn-down view stops counting
   *
   * @param key accountKey
   */
  forget(key: string): void {
    delete this.counts[key];
  }

  /**
   * Returns a copy of the current counts
   *
   * @returns unread per accountKey
   */
  snapshot(): Record<string, number> {
    return { ...this.counts };
  }
}
