// One pattern, two call sites: subscribe once to a preload push event that has no unsubscribe
// of its own, cache the last value at module level so every mounted hook starts from what the
// last one already knew rather than its own default, and fetch once per mount to cover the
// gap before the first push arrives.
//
// `broadcastFetch` is what tells the two call sites apart. The hidden-accounts list treats its
// own fetch exactly like a push: every mounted hook is told, unconditionally, because nothing
// there depends on one fetch outrunning another. OAuth status instead keeps a fetch local to
// the hook that issued it, and only lets it through while no push has landed yet for anybody
// -- a stale answer must never overwrite a newer pushed one.

import { useEffect, useState } from 'react';


//===========================
// Exported functions
//===========================

/**
 * Builds a `use…()` hook around one preload push channel, with a module-level cache so every
 * mounted instance starts from what the last one already knew
 *
 * @param subscribe registers the preload's push callback; the preload itself never offers an
 *   unsubscribe, so this runs at most once no matter how many components mount
 * @param fetchOnce asks main for the current value once per mount, to cover the gap before the
 *   first push; a call site with nothing to ask returns undefined
 * @param initial what every hook returns before anything has arrived
 * @param broadcastFetch whether `fetchOnce`'s answer is told to every mounted hook like a push,
 *   or kept local to its own hook and dropped once a push has landed anywhere -- see the file
 *   banner
 * @returns a hook returning the live value
 */
export function createPushState<T>(
  subscribe: (cb: (value: T) => void) => void,
  fetchOnce: () => Promise<T> | undefined,
  initial: T,
  broadcastFetch: boolean,
): () => T {
  const listeners = new Set<(value: T) => void>();
  let subscribed = false;
  let known = initial;
  let seenPush = false;

  function tell(value: T): void {
    known = value;
    seenPush = true;
    for (const fn of listeners) fn(value);
  }

  return function usePushState(): T {
    const [value, setValue] = useState<T>(known);

    useEffect(() => {
      listeners.add(setValue);
      if (!subscribed) {
        subscribed = true;
        subscribe(tell);
      }
      const pending = fetchOnce();
      if (pending) {
        void pending.then((fetched) => {
          if (broadcastFetch) {
            tell(fetched);
            return;
          }
          if (!seenPush) {
            known = fetched;
            seenPush = true;
            setValue(fetched);
          }
        });
      }
      return () => {
        listeners.delete(setValue);
      };
    }, []);

    return value;
  };
}
