// When a refused Gmail request is sent again, and when repeating it would do damage.

import { describe, it, expect } from 'vitest';
import {
  MAX_ATTEMPTS,
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
