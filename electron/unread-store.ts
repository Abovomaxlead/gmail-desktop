// Owns the per-account unread counts behind the taskbar badge and the sidebar
// markers, keyed by accountKey. Reporting 0 forgets the key instead of storing a
// zero, and that is the point: a view that is torn down (a delegated mailbox
// reloading, a discarded probe, a removed account) never reports a fresh number
// again, so a lingering last count would sum into the badge total forever.
export class UnreadStore {
  private counts: Record<string, number> = {};

  report(key: string, count: number): void {
    if (Number.isFinite(count) && count > 0) this.counts[key] = count;
    else delete this.counts[key];
  }

  forget(key: string): void {
    delete this.counts[key];
  }

  snapshot(): Record<string, number> {
    return { ...this.counts };
  }
}
