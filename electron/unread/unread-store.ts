// The per-account unread counts behind the taskbar badge and the sidebar markers.
//
// Reporting 0 forgets the key rather than storing a zero: a torn-down view never reports
// again, so a lingering last count would sum into the badge total forever.
//
// Two sources write here and they are not equals. The Gmail page's own title moves the
// instant mail is read; the API sweep runs every five minutes and counts the whole mailbox
// rather than the tab on screen. So the page is the authority for any account it speaks for,
// and the sweep only fills in an account the page has said nothing about yet.


//===========================
// Constants
//===========================


//===========================
// Store
//===========================

export class UnreadStore {
  private counts: Record<string, number> = {};

  // The accounts the Gmail page itself has reported for. Runtime insertion, and cleared only
  // by forget/retain: a page that has spoken once keeps the last word for that account.
  private fromPage = new Set<string>();

  /**
   * Records what an account currently has unread, as the Gmail page reports it
   *
   * @param key accountKey
   * @param count anything not above zero forgets the count
   */
  report(key: string, count: number): void {
    this.fromPage.add(key);
    this.write(key, count);
  }

  /**
   * Fills in an account the page has not reported for, from the API sweep
   *
   * @param key accountKey
   * @param count anything not above zero forgets the count
   * @returns false when the page owns this account, so the caller can skip pushing a total
   *   that did not change
   */
  reportFromApi(key: string, count: number): boolean {
    if (this.fromPage.has(key)) return false;
    this.write(key, count);
    return true;
  }

  /**
   * Drops an account, so a torn-down view stops counting
   *
   * The page's claim goes with it: the next thing to speak for this account owns it again.
   *
   * @param key accountKey
   */
  forget(key: string): void {
    delete this.counts[key];
    this.fromPage.delete(key);
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
    for (const key of this.fromPage) if (!live.has(key)) this.fromPage.delete(key);
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

  /**
   * Whether the Gmail page itself is the source of an account's count
   *
   * @param key accountKey
   * @returns true when the page has reported for it, so the API sweep is standing back
   */
  ownedByPage(key: string): boolean {
    return this.fromPage.has(key);
  }

  /**
   * Stores a count, or forgets the key when there is nothing to count
   *
   * @param key accountKey
   * @param count
   * @private
   */
  private write(key: string, count: number): void {
    if (Number.isFinite(count) && count > 0) this.counts[key] = count;
    else delete this.counts[key];
  }
}
