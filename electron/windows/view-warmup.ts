// Tracks how each account's one-off warmup is doing. All time arrives as a parameter
// and there is no Electron in sight, so it is testable on its own. A warmup may cool
// once the page title has taken the mailbox shape plus a settle margin — the title
// flips while Gmail is still drawing its message list — or at a hard cap, which is
// the fallback for an account that never loads at all (signed out, no network, a
// login page). Preloading happens once per session, so a finished key never restarts.
import { mailboxTitleLoaded } from '../unread/unread-parser';



//===========================
// Constants
//===========================

// The hard cap is the fallback for an account that never loads at all: signed out, no
// network, a login page. The settle margin exists because the title flips while Gmail is
// still drawing its message list.
export const WARMUP_CAP_MS = 25_000;
export const WARMUP_SETTLE_MS = 1_500;


//===========================
// Types
//===========================

export type WarmupVerdict = 'wait' | 'cool' | 'unknown';

interface WarmupEntry {
  startedAt: number;
  readyAt: number | null;
}


//===========================
// Tracker
//===========================

export class WarmupTracker {
  private entries = new Map<string, WarmupEntry>();
  private done = new Set<string>();

  /**
   * Starts the warmup for an account
   *
   * @param key accountKey
   * @param now epoch ms
   * @returns false when it is already running or already finished this session
   */
  begin(key: string, now: number): boolean {
    if (this.entries.has(key) || this.done.has(key)) return false;
    this.entries.set(key, { startedAt: now, readyAt: null });
    return true;
  }

  /**
   * Whether a warmup may cool yet
   *
   * @param key accountKey
   * @param title the view's current page title
   * @param now epoch ms
   * @returns 'unknown' for a key that is not warming up
   */
  verdict(key: string, title: string | null | undefined, now: number): WarmupVerdict {
    const entry = this.entries.get(key);
    if (!entry) return 'unknown';
    if (entry.readyAt === null && mailboxTitleLoaded(title)) entry.readyAt = now;
    if (entry.readyAt !== null && now - entry.readyAt >= WARMUP_SETTLE_MS) return 'cool';
    if (now - entry.startedAt >= WARMUP_CAP_MS) return 'cool';
    return 'wait';
  }

  /**
   * Ends a warmup for good; preloading happens once per session
   *
   * @param key accountKey
   */
  finish(key: string): void {
    this.entries.delete(key);
    this.done.add(key);
  }

  /**
   * Which accounts are still warming up
   *
   * @returns their accountKeys
   */
  pending(): string[] {
    return [...this.entries.keys()];
  }
}
