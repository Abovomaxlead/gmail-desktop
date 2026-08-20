// What Gmail lets one user spend, kept in one place. Concurrency limits used to be guesses with
// a comment about quota units next to them; the guess was the wrong lever, because how many
// requests a second a given number of calls in flight produces depends on the round trip and
// nothing else. This prices each call and paces it instead.
//
// Paced, not rationed per second. A window that hands out a whole second's worth and then blocks
// went wrong twice over, both measured on a copy of 147 mails: waiters woke together, all passed
// the check before any of them had booked, and went over the ceiling in one burst; and the burst
// itself is what Gmail answers with 429, after which the retry backoff cost more than the
// concurrency ever won -- that copy came out 2.2x slower than the same one at a third of the
// concurrency. So each call is given a moment to go, in the order it asked, and the moments are
// spread evenly.
//
// The prices below are the ones this project is billed at. Google published a new table on
// 1 May 2026 -- messages.get 20, threads.get 40, 6,000 units a minute per user -- but projects
// that called the API between November 2025 and April 2026 keep the old table for now, and the
// measured 16 requests a second without a single 429 says this project is one of them. Nobody is
// told when that changes, which is what `refused` is for.
//
// Batching does not help with any of this: a batch of n counts as n requests, so it saves round
// trips and not units.


//===========================
// Types
//===========================

export interface QuotaClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export interface QuotaBudget {
  /** Waits for this call's turn, then books it */
  take(call: string): Promise<void>;
  /** The units a second currently allows, which is not always the published number */
  ceiling(): number;
  /** Tells the budget Gmail refused a call it thought there was room for */
  refused(): void;
}


//===========================
// Constants
//===========================

/** Per user per project, and the one number to change when this project moves to the new table:
 * that one is published as 6,000 a minute, which is 100 a second. */
export const UNITS_PER_SECOND = 250;

/** What is kept of the ceiling each time Gmail refuses a call the budget thought fitted. */
const BACK_OFF = 0.6;

/** Where backing off stops. Below this the app is not working anyway, and one wrong reading
 * should not be able to grind it to a halt. */
const FLOOR = 25;

/** How long without a refusal before the ceiling takes a step back up. One bad burst used to
 * cost the rest of the session, because the ceiling only ever went down. */
const RECOVER_AFTER_MS = 60_000;

/** Gmail's price list, for the calls this app makes. */
export const QUOTA_COST: Record<string, number> = {
  'messages.get': 5,
  'messages.list': 5,
  'messages.insert': 25,
  'messages.send': 100,
  'messages.modify': 5,
  'messages.trash': 5,
  'threads.get': 10,
  'threads.list': 10,
  'history.list': 2,
  'labels.list': 1,
  'users.getProfile': 1,
  watch: 100,
};

const DEAREST = Math.max(...Object.values(QUOTA_COST));


//===========================
// Exported functions
//===========================

/**
 * Reads the price of a call
 *
 * @param call the method name, as Gmail's own price list writes it
 * @returns the units, and the dearest price known for a call that is not on the list, since
 *   guessing low is the one mistake that overspends
 */
export function quotaCost(call: string): number {
  return QUOTA_COST[call] ?? DEAREST;
}

/**
 * Names the call a URL stands for, so the price list can be looked up
 *
 * The names are Gmail's own, since that is what the published price list is written in.
 *
 * @param url the request URL
 * @returns the method name, and an empty string for a URL that is none of these, which prices as
 *   the dearest call rather than as free
 */
export function callForUrl(url: string): string {
  const path = url.split('?')[0];
  if (path.includes('/upload/gmail/')) return 'messages.insert';
  if (path.endsWith('/watch') || path.endsWith('/stop')) return 'watch';
  if (path.endsWith('/profile')) return 'users.getProfile';
  if (path.endsWith('/history')) return 'history.list';
  if (path.endsWith('/labels')) return 'labels.list';

  for (const kind of ['messages', 'threads'] as const) {
    const at = path.lastIndexOf(`/${kind}`);
    if (at === -1) continue;
    const rest = path.slice(at + kind.length + 2);
    if (rest === '') return `${kind}.list`;
    // A verb after the id is a change to the message, which Gmail prices apart from reading it
    const verb = rest.split('/')[1];
    return verb ? `${kind.slice(0, -1)}s.${verb}` : `${kind}.get`;
  }
  return '';
}

/**
 * A budget one user's calls are drawn from, handed out a moment at a time
 *
 * The cursor is the instant the next unit may be spent. A caller reads it, moves it on by what
 * its own call costs, and only then waits for its turn to come round. Moving it before any
 * `await` is what makes booking atomic: there is no window in which two callers can both see room
 * that only one of them can have.
 *
 * @param clock now and sleep, injected so a test does not wait
 * @param note where to report a ceiling that moved, so it lands in the log the app keeps rather
 *   than in a terminal nobody is watching
 * @returns the budget
 */
export function createQuotaBudget(
  clock: QuotaClock,
  note?: (message: string) => void,
): QuotaBudget {
  let ceiling = UNITS_PER_SECOND;
  let lastRefusal = -Infinity;
  let cursor = clock.now();

  /** Steps the ceiling back up once per quiet spell, never past the published allowance. */
  const recover = (now: number): void => {
    if (ceiling >= UNITS_PER_SECOND) return;
    if (now - lastRefusal < RECOVER_AFTER_MS) return;
    ceiling = Math.min(UNITS_PER_SECOND, Math.ceil(ceiling / BACK_OFF));
    lastRefusal = now;
    note?.(`[quota] rustig gebleven, plafond weer op ${ceiling} van de ${UNITS_PER_SECOND}`);
  };

  return {
    async take(call: string): Promise<void> {
      const now = clock.now();
      recover(now);
      // No banking: an idle spell leaves the cursor in the past, which makes the next call free
      // and the ones behind it paced. Letting idle time accumulate is how a burst is built.
      const mine = Math.max(cursor, now);
      cursor = mine + (quotaCost(call) * 1000) / ceiling;
      const wait = mine - now;
      if (wait > 0) await clock.sleep(wait);
    },
    ceiling(): number {
      return ceiling;
    },
    refused(): void {
      lastRefusal = clock.now();
      const lowered = Math.max(FLOOR, Math.floor(ceiling * BACK_OFF));
      if (lowered === ceiling) return;
      ceiling = lowered;
      note?.(
        `[quota] Gmail weigerde binnen het budget; plafond nu ${ceiling} van de ${UNITS_PER_SECOND} eenheden per seconde`,
      );
    },
  };
}
