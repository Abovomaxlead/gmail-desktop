// When a refused Gmail request is sent again, and when repeating it would do damage.

import { describe, it, expect } from 'vitest';
import {
  MAX_ATTEMPTS,
  MAX_QUOTA_WAIT_MS,
  QUOTA_ATTEMPTS,
  isRateLimit,
  retryAfterMs,
  retryWaitMs,
  withRetry,
  type RetryAttempt,
} from '../electron/gmail/retry';

const attempt = (over: Partial<RetryAttempt> = {}): RetryAttempt => ({
  method: 'GET',
  attempt: 1,
  status: 429,
  ...over,
});

/** The middle of the jitter range, so a wait is a number a test can name */
const mid = () => 0.5;

describe('retryAfterMs', () => {
  it('reads a count of seconds', () => {
    expect(retryAfterMs('7', 0)).toBe(7000);
  });

  it('reads an HTTP date as the distance from now', () => {
    expect(retryAfterMs('Wed, 19 Aug 2026 10:00:30 GMT', Date.parse('2026-08-19T10:00:00Z'))).toBe(
      30_000,
    );
  });

  it('is zero rather than negative for a date that has passed', () => {
    expect(retryAfterMs('Wed, 19 Aug 2026 09:00:00 GMT', Date.parse('2026-08-19T10:00:00Z'))).toBe(0);
  });

  it('says nothing for an empty or unreadable header', () => {
    expect(retryAfterMs('', 0)).toBeNull();
    expect(retryAfterMs(undefined, 0)).toBeNull();
    expect(retryAfterMs('straks', 0)).toBeNull();
  });
});

describe('retryWaitMs', () => {
  it('repeats a GET that was rate limited', () => {
    expect(retryWaitMs(attempt(), 0, mid)).toBe(500);
  });

  it('waits longer on the second attempt', () => {
    expect(retryWaitMs(attempt({ attempt: 2 }), 0, mid)).toBe(1500);
  });

  it('gives up once the attempts are used', () => {
    expect(retryWaitMs(attempt({ attempt: MAX_ATTEMPTS }), 0, mid)).toBeNull();
  });

  it('repeats a GET on the server statuses that mean "not now"', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(retryWaitMs(attempt({ status }), 0, mid)).toBe(500);
    }
  });

  it('does not repeat a GET that was refused on its own merits', () => {
    for (const status of [400, 401, 403, 404]) {
      expect(retryWaitMs(attempt({ status }), 0, mid)).toBeNull();
    }
  });

  it('gives a timed-out GET exactly one more try', () => {
    expect(retryWaitMs(attempt({ status: null, timedOut: true }), 0, mid)).toBe(500);
    expect(retryWaitMs(attempt({ status: null, timedOut: true, attempt: 2 }), 0, mid)).toBeNull();
  });

  it('never repeats an insert that timed out, since the mail may have landed', () => {
    expect(retryWaitMs(attempt({ method: 'POST', status: null, timedOut: true }), 0, mid)).toBeNull();
  });

  it('never repeats an insert that came back without a status', () => {
    expect(retryWaitMs(attempt({ method: 'POST', status: null }), 0, mid)).toBeNull();
  });

  it('repeats an insert only on the statuses that prove Gmail refused it', () => {
    expect(retryWaitMs(attempt({ method: 'POST', status: 429 }), 0, mid)).toBe(500);
    expect(retryWaitMs(attempt({ method: 'POST', status: 503 }), 0, mid)).toBe(500);
    for (const status of [500, 502, 504]) {
      expect(retryWaitMs(attempt({ method: 'POST', status }), 0, mid)).toBeNull();
    }
  });

  it('repeats a trash that timed out, since trashing twice is a no-op', () => {
    expect(
      retryWaitMs(attempt({ method: 'POST_IDEMPOTENT', status: null, timedOut: true }), 0, mid),
    ).toBe(500);
    expect(
      retryWaitMs(
        attempt({ method: 'POST_IDEMPOTENT', status: null, timedOut: true, attempt: 2 }),
        0,
        mid,
      ),
    ).toBeNull();
  });

  it('does not let the idempotent opt-in widen to an insert', () => {
    // Same situation Gmail leaves an insert in -- no status, timed out -- decided the opposite
    // way depending only on which method the call site named.
    const situation = { status: null, timedOut: true } as const;
    expect(retryWaitMs(attempt({ method: 'POST_IDEMPOTENT', ...situation }), 0, mid)).toBe(500);
    expect(retryWaitMs(attempt({ method: 'POST', ...situation }), 0, mid)).toBeNull();
  });

  it('repeats a trash on the same server statuses as any other retriable call', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(retryWaitMs(attempt({ method: 'POST_IDEMPOTENT', status }), 0, mid)).toBe(500);
    }
  });

  it('does not repeat a trash refused on its own merits', () => {
    for (const status of [400, 401, 403, 404]) {
      expect(retryWaitMs(attempt({ method: 'POST_IDEMPOTENT', status }), 0, mid)).toBeNull();
    }
  });

  // A cancel is the user asking this specific request to stop -- sending it again would be
  // going behind their back, whatever the method and whatever status (if any) came back.
  it('never repeats a cancelled request, for any method', () => {
    expect(retryWaitMs(attempt({ method: 'GET', cancelled: true }), 0, mid)).toBeNull();
    expect(retryWaitMs(attempt({ method: 'POST', cancelled: true }), 0, mid)).toBeNull();
    expect(retryWaitMs(attempt({ method: 'POST_IDEMPOTENT', cancelled: true }), 0, mid)).toBeNull();
  });

  it('never repeats a cancelled request even when it also carries a retriable status', () => {
    expect(retryWaitMs(attempt({ status: 429, cancelled: true }), 0, mid)).toBeNull();
  });

  // The one place a plain timeout and a cancel would otherwise answer differently: a GET
  // gets one retry after a timeout, but not after being told to stop.
  it('refuses the one retry a timed-out GET would otherwise get, once it was cancelled too', () => {
    expect(retryWaitMs(attempt({ status: null, timedOut: true, cancelled: true }), 0, mid)).toBeNull();
  });

  it('still refuses a timed-out insert a retry -- unrelated to cancellation', () => {
    // Regression guard: adding `cancelled` must not have touched this existing refusal.
    expect(retryWaitMs(attempt({ method: 'POST', status: null, timedOut: true }), 0, mid)).toBeNull();
  });

  it('honours Retry-After over its own backoff', () => {
    expect(retryWaitMs(attempt({ retryAfter: '4' }), 0, mid)).toBe(4000);
  });

  it('caps a Retry-After that is really a refusal', () => {
    expect(retryWaitMs(attempt({ retryAfter: '1800' }), 0, mid)).toBe(30_000);
  });

  it('spreads the wait so parallel requests do not come back in step', () => {
    expect(retryWaitMs(attempt(), 0, () => 0)).toBe(400);
    expect(retryWaitMs(attempt(), 0, () => 1)).toBe(600);
  });
});

describe('withRetry', () => {
  const rateLimited = () => ({ method: 'GET' as const, status: 429 });

  it('returns the first answer without waiting', async () => {
    const waits: number[] = [];
    const out = await withRetry(
      async () => 'ok',
      rateLimited,
      async (ms) => void waits.push(ms),
    );
    expect(out).toBe('ok');
    expect(waits).toEqual([]);
  });

  it('sends the request again after the wait the policy gives', async () => {
    const waits: number[] = [];
    let tries = 0;
    const out = await withRetry(
      async () => {
        tries += 1;
        if (tries < 3) throw new Error('429');
        return tries;
      },
      rateLimited,
      async (ms) => void waits.push(ms),
    );
    expect(out).toBe(3);
    expect(waits).toHaveLength(2);
  });

  it('throws the last error once the attempts are used', async () => {
    let tries = 0;
    await expect(
      withRetry(
        async () => {
          tries += 1;
          throw new Error(`refused ${tries}`);
        },
        rateLimited,
        async () => {},
      ),
    ).rejects.toThrow(`refused ${MAX_ATTEMPTS}`);
    expect(tries).toBe(MAX_ATTEMPTS);
  });

  it('does not send a request again that the policy refuses to repeat', async () => {
    let tries = 0;
    await expect(
      withRetry(
        async () => {
          tries += 1;
          throw new Error('unauthorised');
        },
        () => ({ method: 'GET', status: 401 }),
        async () => {},
      ),
    ).rejects.toThrow('unauthorised');
    expect(tries).toBe(1);
  });

  it('counts the attempts it hands to run', async () => {
    const seen: number[] = [];
    await withRetry(
      async (n) => {
        seen.push(n);
        if (n < 3) throw new Error('429');
        return n;
      },
      rateLimited,
      async () => {},
    );
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe('isRateLimit', () => {
  it('reads a 429 as one whatever sits beside it', () => {
    expect(isRateLimit(429, null)).toBe(true);
    expect(isRateLimit(429, 'somethingElse')).toBe(true);
  });

  it('reads a 403 as one when it names a rate limit', () => {
    expect(isRateLimit(403, 'rateLimitExceeded')).toBe(true);
    expect(isRateLimit(403, 'userRateLimitExceeded')).toBe(true);
    expect(isRateLimit(403, 'quotaExceeded')).toBe(true);
    expect(isRateLimit(403, 'RESOURCE_EXHAUSTED')).toBe(true);
  });

  // The distinction the whole predicate exists for: a mailbox refusing us must fail at once,
  // not sit out six quota windows first.
  it('leaves a 403 that is a mailbox refusing us alone', () => {
    expect(isRateLimit(403, 'forbidden')).toBe(false);
    expect(isRateLimit(403, 'insufficientPermissions')).toBe(false);
    expect(isRateLimit(403, null)).toBe(false);
  });

  // Admitting a 400 would let a malformed insert be repeated for six minutes before failing
  // anyway, which is the one outcome worse than failing immediately.
  it('never reads a 400 as one, however it is worded', () => {
    expect(isRateLimit(400, 'quotaExceeded')).toBe(false);
  });

  it('says no when nothing came back at all', () => {
    expect(isRateLimit(null, null)).toBe(false);
    expect(isRateLimit(null, 'quotaExceeded')).toBe(false);
  });
});

describe('retryWaitMs, rate limited', () => {
  const limited = (over: Partial<RetryAttempt> = {}): RetryAttempt =>
    attempt({ rateLimited: true, ...over });

  // A whole minute rather than the remainder of one: the app cannot see where Gmail's window
  // boundary falls, and the full width is the only wait guaranteed to clear it.
  it('waits out a whole window rather than backing off', () => {
    expect(retryWaitMs(limited(), 0, mid)).toBe(65_000);
  });

  it('gives an insert the same patience as a GET', () => {
    expect(retryWaitMs(limited({ method: 'POST' }), 0, mid)).toBe(65_000);
  });

  // The behaviour change that fixes the live failure if it arrived as a 403: before this,
  // zero retries.
  it('repeats an insert a 403 rate limit refused, where it used to give up', () => {
    expect(retryWaitMs(limited({ method: 'POST', status: 403 }), 0, mid)).toBe(65_000);
    expect(retryWaitMs(attempt({ method: 'POST', status: 403 }), 0, mid)).toBeNull();
  });

  it('takes a longer Retry-After but never past the cap', () => {
    expect(retryWaitMs(limited({ retryAfter: '70' }), 0, mid)).toBe(70_000);
    expect(retryWaitMs(limited({ retryAfter: '600' }), 0, mid)).toBe(MAX_QUOTA_WAIT_MS);
  });

  it('ignores a Retry-After shorter than the window is wide', () => {
    expect(retryWaitMs(limited({ retryAfter: '2' }), 0, mid)).toBe(65_000);
  });

  it('gets six attempts where an ordinary refusal gets three', () => {
    expect(retryWaitMs(limited({ attempt: MAX_ATTEMPTS }), 0, mid)).toBe(65_000);
    expect(retryWaitMs(limited({ attempt: QUOTA_ATTEMPTS }), 0, mid)).toBeNull();
    expect(QUOTA_ATTEMPTS).toBeGreaterThan(MAX_ATTEMPTS);
  });

  // The user asked this run to stop. Sitting out a quota window on its behalf is going behind
  // their back, rate limit or not.
  it('is still refused outright when the run was cancelled', () => {
    expect(retryWaitMs(limited({ cancelled: true }), 0, mid)).toBeNull();
    expect(retryWaitMs(limited({ method: 'POST', cancelled: true }), 0, mid)).toBeNull();
  });

  // An ordinary 429 keeps its own backoff, so nothing that is not flagged changes shape.
  it('leaves an unflagged refusal on the ordinary backoff', () => {
    expect(retryWaitMs(attempt(), 0, mid)).toBe(500);
    expect(retryWaitMs(attempt({ attempt: 2 }), 0, mid)).toBe(1500);
  });
});
