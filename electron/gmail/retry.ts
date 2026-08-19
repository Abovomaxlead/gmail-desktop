// When a refused request is worth sending again. Split off from the request itself so the
// policy is testable without a network: gmail-api.ts hands it a status and gets a wait back.
//
// The policy differs per method, and that difference is the reason this file exists. A GET
// can be repeated freely. A `messages.insert` that timed out may well have landed, and
// sending it again puts the mail in the mailbox twice — worse than the error it would paper
// over. So an insert is only repeated on the answers that prove Gmail refused it outright.



//===========================
// Types
//===========================

export type RetryMethod = 'GET' | 'POST';

export interface RetryAttempt {
  method: RetryMethod;
  /** 1 for the first try, so `attempt` is also how many have been made */
  attempt: number;
  /** The HTTP status, or null when nothing came back */
  status: number | null;
  timedOut?: boolean;
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
  if (a.attempt >= MAX_ATTEMPTS) return null;

  // An insert is the one call that is not free to repeat: without a status there is no
  // proof Gmail refused it, and a mail copied twice is worse than one reported as failed.
  if (a.method === 'POST') {
    if (a.timedOut || a.status === null) return null;
    if (!RETRIABLE_INSERT_STATUS.has(a.status)) return null;
  } else if (a.timedOut || a.status === null) {
    // A time-out already cost the full request timeout, so one more try is the whole budget
    if (a.attempt >= 2) return null;
  } else if (!RETRIABLE_STATUS.has(a.status)) {
    return null;
  }

  const asked = retryAfterMs(a.retryAfter, now);
  if (asked !== null) return Math.min(asked, MAX_WAIT_MS);

  const backoff = BASE_WAIT_MS * 3 ** (a.attempt - 1);
  return Math.min(Math.round(backoff * (0.8 + 0.4 * jitter())), MAX_WAIT_MS);
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
