// One pull at a time. A drop arriving while mail is being fetched used to empty
// lastDropSaved and bump the drag serial before the first pull had written its files, which
// lost the first drag's results and left the picker offering mail that was never saved.
//
// A token rather than a plain flag, because the pull that holds the lock is not always the
// pull that comes back: one that answers after its hold went stale must not release the lock
// that replaced it. And stale holds exist at all because a request that never answers would
// otherwise take dropping mail out of the app until it is restarted.


//===========================
// Types
//===========================

export interface DropLock {
  /** Takes the lock, and answers null when another pull holds it */
  take(now: number): number | null;
  /** Gives the lock back, and answers whether this token still held it */
  release(token: number): boolean;
  /** Whether a pull holds it at this moment */
  held(now: number): boolean;
}


//===========================
// Constants
//===========================

/** How long one pull may hold the lock before the next drop is allowed to take it over.
 * Wide enough for a label of two hundred conversations over the API, narrow enough that a
 * hung request is not the end of dropping mail. */
export const DROP_LOCK_MS = 5 * 60 * 1000;


//===========================
// Exported functions
//===========================

/**
 * A lock that one pull at a time may hold
 *
 * @param limitMs how long a hold lasts before a later caller may take it over
 * @returns the lock
 */
export function createDropLock(limitMs = DROP_LOCK_MS): DropLock {
  let holder: { token: number; since: number } | null = null;
  let handed = 0;

  const stale = (now: number): boolean => holder !== null && now - holder.since >= limitMs;

  return {
    take(now: number): number | null {
      if (holder && !stale(now)) return null;
      handed += 1;
      holder = { token: handed, since: now };
      return holder.token;
    },
    release(token: number): boolean {
      if (holder?.token !== token) return false;
      holder = null;
      return true;
    },
    held(now: number): boolean {
      return holder !== null && !stale(now);
    },
  };
}
