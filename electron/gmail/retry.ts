// When a refused request is worth sending again. Split off from the request itself so the
// policy is testable without a network: gmail-api.ts hands it a status and gets a wait back.
//
// The policy differs per method, and that difference is the reason this file exists. A GET
// can be repeated freely. A `messages.insert` that timed out may well have landed, and
// sending it again puts the mail in the mailbox twice — worse than the error it would paper
// over. So an insert is only repeated on the answers that prove Gmail refused it outright.
//
// A rate limit crosses all of that. It is not a fourth method but a property any of them can
// come back with, and it is the one refusal worth waiting minutes rather than milliseconds for:
// the limit is per minute, so the ordinary backoff of half a second and then one and a half
// exhausts itself inside the very window that refused the call. That is how a copy of 2,574
// mails came back as 2,573 — three attempts, two seconds, one lost mail.
//
// So a rate-limited attempt gets its own budget (QUOTA_ATTEMPTS) and its own wait, and that
// wait is capped by MAX_QUOTA_WAIT_MS rather than by MAX_WAIT_MS. Two constants for what looks
// like one thing, on purpose: thirty seconds is right for a drag with somebody watching it, and
// far too short for an insert three-quarters of the way through a copy of ten thousand. Raising
// MAX_WAIT_MS would have made the drag hang to save the copy.



//===========================
// Types
//===========================

export type RetryMethod = 'GET' | 'POST' | 'POST_IDEMPOTENT';

export interface RetryAttempt {
  method: RetryMethod;
  /** 1 for the first try, so `attempt` is also how many have been made */
  attempt: number;
  /** The HTTP status, or null when nothing came back */
  status: number | null;
  timedOut?: boolean;
  /** Severed on purpose -- a running copy was told to stop, not a request that merely ran
   * out of time. Never retried, for any method: repeating a request nobody wants any more
   * would defeat the reason it was cut in the first place. Kept apart from `timedOut` since
   * a GET is otherwise allowed one retry after a timeout, and a cancelled one must not be. */
  cancelled?: boolean;
  /** Set when isRateLimit read this refusal as a rate limit. Carried as a flag rather than
   * re-derived here, because the same 403 means two different things depending on the reason
   * beside it, and this module deliberately does not import the error class that holds it. */
  rateLimited?: boolean;
  retryAfter?: string | null;
}


//===========================
// Constants
//===========================

export const MAX_ATTEMPTS = 3;

const BASE_WAIT_MS = 500;

/** A Retry-After of half an hour is Gmail saying no, not "hold on": beyond this the drag is
 * better off failing than hanging. */
const MAX_WAIT_MS = 30_000;

const RETRIABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** What an insert may be repeated on: both mean the upload was refused before it was
 * accepted, so nothing landed. */
const RETRIABLE_INSERT_STATUS = new Set([429, 503]);

/** The reasons Gmail gives when it was a rate limit that refused, across both layers that can
 * refuse one: the three the Gmail API lists per error, and the one the quota front end in front
 * of it answers with instead. */
const RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'quotaExceeded',
  'RESOURCE_EXHAUSTED',
]);

/** How many attempts a rate-limited call gets, against MAX_ATTEMPTS for everything else. Five
 * waits between six attempts is just over six minutes of patience for one mail -- the right
 * trade inside a copy that runs for twenty, and the wrong one anywhere a person is waiting. */
export const QUOTA_ATTEMPTS = 6;

/** A whole minute, not the remainder of one. The app cannot see where Gmail's window boundary
 * falls, so the full width is the only wait guaranteed to clear it. */
const QUOTA_WAIT_MS = 60_000;

/** On top of the window, because the meter this app keeps and the meter Gmail keeps do not tick
 * together. */
const QUOTA_MARGIN_MS = 5_000;

/** Where a rate-limited wait stops. Kept apart from MAX_WAIT_MS rather than raising it: thirty
 * seconds is right for a drag somebody is watching, and far too short for an insert inside a
 * copy of ten thousand. */
export const MAX_QUOTA_WAIT_MS = 75_000;


//===========================
// Exported functions
//===========================

/**
 * Reads Gmail's Retry-After header
 *
 * @param header the header value, as seconds or as an HTTP date
 * @param now milliseconds, against which a date is measured
 * @returns the wait in milliseconds, or null when the header says nothing usable
 */
export function retryAfterMs(header: string | null | undefined, now: number): number | null {
  const value = (header ?? '').trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

/**
 * Whether Gmail refused this because of a rate limit rather than on the merits
 *
 * A 429 always is. A 403 only is when it names one of the reasons above: a 403 without one is a
 * mailbox refusing us, and that must fail at once rather than sit out six quota windows first.
 * A 400 never is -- admitting it would let a malformed insert be repeated for six minutes
 * before failing anyway.
 *
 * @param status the HTTP status, or null when nothing came back
 * @param reason Gmail's own reason for it, from parseErrorReason
 * @returns true when waiting and repeating is the right answer
 */
export function isRateLimit(status: number | null, reason: string | null): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  return reason !== null && RATE_LIMIT_REASONS.has(reason);
}

/**
 * Whether this request may be sent again at all
 *
 * Independent of how long the wait would be, and asked first: the attempt budget, the user's
 * own cancellation and the per-method rules all answer "no" outright, and none of them cares
 * what the backoff would have been.
 *
 * @param a what the failed attempt ran into
 * @returns true when repeating this request is allowed
 * @private
 */
function mayRepeat(a: RetryAttempt): boolean {
  // The attempt budget is the one thing a rate limit changes for every method at once: an
  // insert and a GET both deserve to sit out a quota window, and neither can do that inside
  // three attempts spread over two seconds.
  if (a.attempt >= (a.rateLimited ? QUOTA_ATTEMPTS : MAX_ATTEMPTS)) return false;

  // The user asked this specific request to stop; sending it again is not a retry, it is going
  // behind their back. Checked for every method, so a plain GET's one-retry-after-a-timeout
  // allowance cannot apply to a cut request either.
  if (a.cancelled) return false;

  // An insert is the one call that is not free to repeat: without a status there is no proof
  // Gmail refused it, and a mail copied twice is worse than one reported as failed.
  // 'POST_IDEMPOTENT' exists so a write that repeating cannot duplicate -- trash, say, where
  // trashing an already-trashed message is a no-op -- can opt back into the GET-like policy.
  if (a.method === 'POST') {
    if (a.timedOut || a.status === null) return false;
    // A rate-limited call was turned away before it was accepted, so nothing landed and
    // repeating it cannot put a mail in a mailbox twice -- the same proof
    // RETRIABLE_INSERT_STATUS asks for, arriving as a 403 instead of a 429.
    return RETRIABLE_INSERT_STATUS.has(a.status) || a.rateLimited === true;
  }

  // A time-out already cost the full request timeout, so one more try is the whole budget
  if (a.timedOut || a.status === null) return a.attempt < 2;
  return RETRIABLE_STATUS.has(a.status) || a.rateLimited === true;
}

/**
 * How long to wait before sending this request again
 *
 * @param a what the failed attempt ran into
 * @param now milliseconds, for reading a Retry-After date
 * @param jitter 0..1, spreading parallel requests so they do not come back in step
 * @returns the wait in milliseconds
 * @private
 */
function waitFor(a: RetryAttempt, now: number, jitter: () => number): number {
  // A quota window cannot be waited out by the ordinary backoff, so it is not tried: the wait
  // is the window's whole width, and Gmail's own Retry-After is preferred only where it asks
  // for longer than that.
  if (a.rateLimited) {
    const askedForQuota = retryAfterMs(a.retryAfter, now) ?? 0;
    return Math.min(Math.max(askedForQuota, QUOTA_WAIT_MS + QUOTA_MARGIN_MS), MAX_QUOTA_WAIT_MS);
  }

  const asked = retryAfterMs(a.retryAfter, now);
  if (asked !== null) return Math.min(asked, MAX_WAIT_MS);

  const backoff = BASE_WAIT_MS * 3 ** (a.attempt - 1);
  return Math.min(Math.round(backoff * (0.8 + 0.4 * jitter())), MAX_WAIT_MS);
}

/**
 * How long to wait before sending this request again
 *
 * @param a what the failed attempt ran into
 * @param now milliseconds, for reading a Retry-After date
 * @param jitter 0..1, spreading parallel requests so they do not come back in step
 * @returns the wait in milliseconds, or null when this request must not be repeated
 */
export function retryWaitMs(
  a: RetryAttempt,
  now = Date.now(),
  jitter: () => number = Math.random,
): number | null {
  return mayRepeat(a) ? waitFor(a, now, jitter) : null;
}

/**
 * Runs an attempt until it succeeds or the policy gives up
 *
 * @param run receives the attempt number, 1 for the first
 * @param failure reads a thrown error into what the policy needs; the method is the caller's
 * @param sleep injected so a test does not wait
 * @returns whatever run returned
 * @throws the error of the last attempt
 */
export async function withRetry<T>(
  run: (attempt: number) => Promise<T>,
  failure: (e: unknown) => Omit<RetryAttempt, 'attempt'>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run(attempt);
    } catch (e) {
      const wait = retryWaitMs({ ...failure(e), attempt });
      if (wait === null) throw e;
      await sleep(wait);
    }
  }
}
