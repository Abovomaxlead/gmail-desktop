// The per-account unread counts behind the taskbar badge and the sidebar markers.
//
// Reporting 0 forgets the key rather than storing a zero: a torn-down view never reports
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
   * Keeps only the accounts that still exist
   *
   * Reporting 0 is what normally forgets a key, and that only reaches here from a view
   * being torn down. A view that opened for an account which never became a profile --
   * a probe during detection, a delegation scan that came up empty -- leaves its count
   * behind with nothing that will ever zero it, and the badge adds it forever.
   *
   * @param keys the accountKeys the live profiles have
   * @returns true when something was dropped, so the caller can push the new total
   */
  retain(keys: Iterable<string>): boolean {
    const live = new Set(keys);
    let dropped = false;
    for (const key of Object.keys(this.counts)) {
      if (live.has(key)) continue;
      delete this.counts[key];
      dropped = true;
    }
    return dropped;
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
