# Quota headroom and rate-limit retry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A copy of any size stops losing mail to Gmail's per-minute quota — by pacing below the ceiling instead of exactly on it, and by recognising a rate-limit refusal and waiting it out instead of exhausting three attempts inside two seconds.

**Architecture:** Three files, no controller and no UI. `quota.ts` gets a safety fraction applied where the pacing cursor advances, and nowhere else. `gmail-api.ts` learns to read the reason Gmail gives for a refusal. `retry.ts` gets a predicate that says whether a refusal was a rate limit, and one branch that gives such a refusal six attempts and a full window's patience instead of three attempts and a backoff. Then the two call sites that today test `status === 429` are pointed at the predicate.

**Tech Stack:** TypeScript, Electron main process, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-26-big-label-copy-batching-design.md` — this plan implements **part 1 only**. Part 2 (batching a label into a resumable job) gets its own plan.

**Deliberately not in this plan**, so it is not read as an omission: the spec's *"The cap splits in two"* section — `SCRAPE_MAX_THREADS`, `API_MAX_THREADS` and moving `EXISTING_SCAN_LIMIT` with them — belongs to part 2. Nothing in part 1 needs a thread list longer than 2,000, and splitting the cap before there is a job to slice would raise a ceiling with nothing behind it. Leave `MAX_THREADS` exactly as it is.

## Global Constraints

- **Written artifacts are English.** Comments, docblocks, commit messages. The repository is otherwise Dutch; do not translate what is already there.
- **Comment convention.** Banner sections (three lines, a row of 27 `=`, the Title-case name, another row of 27 `=`), fixed section order per file, empty sections stay. Docblocks are one-line description, blank `*`, then tags. Inline comments say *why*, never restate the line below. Roughly one comment line per ten of code. Every file in this plan already follows it — match what is there.
- **`UNITS_PER_SECOND = 250` stays exactly as it is.** It documents Google's published figure and it is what `refused()` and `recover()` measure against, which is how this project learns it has been moved to the tighter price list. The safety fraction is applied where the cursor advances and nowhere else.
- **`messages.insert` may never be repeated without proof Gmail refused it.** A duplicated mail is worse than a mail reported as failed. `retry.ts`'s `'POST'` branch is widened by exactly one named predicate in this plan and by nothing else.
- **A cancelled request is never repeated**, for any method, rate-limited or not. The user asked it to stop.
- **Verification commands:** `npm test` (vitest, 1877 tests green at the baseline), `npx tsc --noEmit -p tsconfig.json`, `npx tsc --noEmit -p renderer/tsconfig.json`.
- **Do not run `npm run build`, `npm run build:renderer`, or `npm run dev`.** A production build poisons `renderer/.next` and makes the user's dev server 404 its own routes. This plan needs neither.

---

## Task Overview

| Task | Files | Depends on |
|---|---|---|
| 1 | `electron/gmail/quota.ts`, `tests/gmail-quota.test.ts` | — |
| 2 | `electron/gmail/gmail-api.ts`, `tests/gmail-api.test.ts` | — |
| 3 | `electron/gmail/retry.ts`, `tests/gmail-retry.test.ts` | — |
| 4 | `electron/gmail/gmail-api.ts` | 2, 3 |

Tasks 1, 2 and 3 are independent of each other. Task 4 is the wiring and needs both 2 and 3.

---

### Task 1: Pace below the published ceiling

**Files:**
- Modify: `electron/gmail/quota.ts` — add `SAFETY`, apply it in `take()`
- Test: `tests/gmail-quota.test.ts` (append to the existing file)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `export const SAFETY: number` from `electron/gmail/quota.ts`. Nothing else in this plan reads it; the part 2 plan will.

**Why this is the whole fix for the reported failure:** `messages.insert` costs 25 units. At `UNITS_PER_SECOND = 250` the cursor advances 100ms per insert, which is 10 inserts a second, which is 15,000 units a minute — exactly the per-minute limit Gmail refused the live copy on. The copy did not burst over that line, it paced onto it and drifted over after four minutes. A tenth held back is the margin.

- [ ] **Step 1: Write the failing tests**

Append to `tests/gmail-quota.test.ts`. The `frozen()` and `clock()` helpers already exist at the top of that file — do not redefine them. Add `SAFETY` to the existing import from `../electron/gmail/quota`.

```ts
describe('the safety fraction', () => {
  // The live failure: an insert paced at the published 250 advances the cursor 100ms, which is
  // 15,000 units a minute -- the exact per-minute limit Gmail refused a copy of 2,574 mails on.
  it('paces an insert slower than the published ceiling would', async () => {
    const c = frozen();
    const budget = createQuotaBudget(c);
    await budget.take('messages.insert');
    await budget.take('messages.insert');
    expect(c.waits[0]).toBeCloseTo((25 * 1000) / (UNITS_PER_SECOND * SAFETY), 5);
    expect(c.waits[0]).toBeGreaterThan((25 * 1000) / UNITS_PER_SECOND);
  });

  it('holds a tenth of the published allowance back', () => {
    expect(SAFETY).toBe(0.9);
  });

  // What the fraction is for, stated as the property that matters rather than as a constant
  it('books less than a minute\'s published allowance across a simulated minute', async () => {
    const c = clock();
    const budget = createQuotaBudget(c);
    const start = c.now();
    let units = 0;
    while (c.now() - start < 60_000) {
      await budget.take('messages.insert');
      units += QUOTA_COST['messages.insert'];
    }
    expect(units).toBeLessThanOrEqual(UNITS_PER_SECOND * 60);
    expect(units).toBeGreaterThan(UNITS_PER_SECOND * 60 * 0.8);
  });

  // The property the fraction must not break: an idle spell is not credit. Letting it
  // accumulate is how a burst is built, and a burst is what Gmail answers with 429.
  it('still does not bank idle time', async () => {
    const c = clock();
    const budget = createQuotaBudget(c);
    await budget.take('messages.insert');
    c.tick(10_000);
    await budget.take('messages.insert');
    expect(c.waits).toEqual([]);
  });

  // The fraction is a pacing decision, not a new ceiling. If it leaked into either of these,
  // the one signal that this project has been moved to the tighter price list would be wrong.
  it('leaves the published figure as the one the ceiling reports', () => {
    expect(createQuotaBudget(frozen()).ceiling()).toBe(UNITS_PER_SECOND);
  });

  it('leaves the published figure as the one a refusal backs off from', () => {
    const budget = createQuotaBudget(frozen());
    budget.refused();
    expect(budget.ceiling()).toBe(Math.floor(UNITS_PER_SECOND * 0.6));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/gmail-quota.test.ts`

Expected: FAIL. The import of `SAFETY` does not resolve, so the whole file fails to collect. That is the expected first failure — not an assertion message.

- [ ] **Step 3: Add the constant**

In `electron/gmail/quota.ts`, in the `Constants` section, directly below `UNITS_PER_SECOND`:

```ts
/** What the budget actually spends of the published allowance above.
 *
 * Pacing at the whole of it is what cost a mail. `UNITS_PER_SECOND` is exactly 15,000 a minute,
 * which is the per-minute limit Gmail refused a copy of 2,574 mails on, so a copy at the full
 * rate does not burst over the line -- it paces onto it and drifts over after a few minutes.
 * A tenth held back is the margin that drift needs.
 *
 * Applied where the cursor advances and nowhere else: `ceiling()`, `refused()` and `recover()`
 * keep measuring against the published figure, because a ceiling that moved is the one signal
 * that this project has been put on the tighter price list. */
export const SAFETY = 0.9;
```

- [ ] **Step 4: Apply it where the cursor advances**

In `createQuotaBudget`'s `take()`, one line changes. Before:

```ts
      cursor = mine + (quotaCost(call) * 1000) / ceiling;
```

After:

```ts
      cursor = mine + (quotaCost(call) * 1000) / (ceiling * SAFETY);
```

Nothing else in the function changes. `mine`, the no-banking rule, and the sleep stay exactly as they are.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/gmail-quota.test.ts`
Expected: PASS, all of them, including the file's pre-existing tests.

Then: `npm test`
Expected: PASS. Nothing outside this file reads `SAFETY` yet, so no other suite should move.

- [ ] **Step 6: Commit**

```bash
git add electron/gmail/quota.ts tests/gmail-quota.test.ts
git commit -m "fix(gmail): pace below the published quota ceiling instead of onto it

250 units a second is exactly 15,000 a minute, which is the per-minute
limit a copy of 2,574 mails was refused on. The copy did not burst over
that line, it paced onto it and drifted over after four minutes. A tenth
held back is the margin. Applied where the cursor advances only, so the
published figure stays what refused() and recover() measure against.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Read the reason Gmail gives for refusing

**Files:**
- Modify: `electron/gmail/gmail-api.ts` — add `parseErrorReason`, add `reason` to `GmailHttpError`, fill it at the one construction site that has a body
- Test: `tests/gmail-api.test.ts` (append to the existing file)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `export function parseErrorReason(json: unknown): string | null`
  - `GmailHttpError` gains a fourth constructor parameter and readonly field, `reason: string | null = null`.

**Why:** `GmailHttpError` carries a message, a status and a Retry-After. Gmail's own `error.errors[].reason` and `error.status` are dropped on the floor, so a 403 carrying `userRateLimitExceeded` is indistinguishable from a 403 meaning "no access to this mailbox". Task 3 needs the difference.

The existing tests in `tests/gmail-api.test.ts` all exercise pure exported functions — parsers and URL builders — and none of them reach the HTTP layer. That is why the reading is a pure exported function rather than something tested through a mocked request: it matches the file's shape and the layer stays as thin as it is.

- [ ] **Step 1: Write the failing tests**

Append to `tests/gmail-api.test.ts`, and add `parseErrorReason` to the existing import from `../electron/gmail/gmail-api`.

```ts
describe('parseErrorReason', () => {
  it('reads the reason off the first error Gmail listed', () => {
    expect(parseErrorReason({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } })).toBe(
      'userRateLimitExceeded',
    );
  });

  // The quota layer in front of the API writes this one instead, and it is the shape the live
  // failure came back as: "Quota exceeded for quota metric 'Queries' ... for consumer ...".
  it('falls back to the status the quota front end writes', () => {
    expect(parseErrorReason({ error: { status: 'RESOURCE_EXHAUSTED' } })).toBe(
      'RESOURCE_EXHAUSTED',
    );
  });

  it('prefers a named reason over the status when both are there', () => {
    expect(
      parseErrorReason({
        error: { status: 'PERMISSION_DENIED', errors: [{ reason: 'rateLimitExceeded' }] },
      }),
    ).toBe('rateLimitExceeded');
  });

  it('walks past an entry with no reason rather than stopping at it', () => {
    expect(parseErrorReason({ error: { errors: [{}, { reason: 'quotaExceeded' }] } })).toBe(
      'quotaExceeded',
    );
  });

  it('says nothing for a body that carries neither', () => {
    expect(parseErrorReason({ error: { message: 'kapot' } })).toBeNull();
    expect(parseErrorReason({ error: {} })).toBeNull();
    expect(parseErrorReason({})).toBeNull();
    expect(parseErrorReason(null)).toBeNull();
    expect(parseErrorReason('niet eens json')).toBeNull();
  });
});

describe('GmailHttpError', () => {
  it('carries the reason alongside the status', () => {
    const e = new GmailHttpError('geweigerd', 403, null, 'userRateLimitExceeded');
    expect(e.status).toBe(403);
    expect(e.reason).toBe('userRateLimitExceeded');
  });

  // Two of the three places that construct one have no body to read a reason from -- an
  // unreadable answer and a batch refused as a whole -- so the parameter has to default.
  it('has no reason when none was given', () => {
    expect(new GmailHttpError('kapot', 500).reason).toBeNull();
    expect(new GmailHttpError('kapot', 500, '30').reason).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/gmail-api.test.ts`
Expected: FAIL — `parseErrorReason` is not exported, so the file fails to collect.

- [ ] **Step 3: Add the reader**

In `electron/gmail/gmail-api.ts`, beside the other parsers. Place it directly above `GmailHttpError` so the class and the function that feeds it read together.

```ts
/**
 * Reads the reason Gmail gave for refusing a request
 *
 * Two fields, written by two different layers, and either one identifies a refusal. The Gmail
 * API itself lists per-error `reason` strings; the quota front end in front of it answers with
 * an `error.status` instead and no `errors` array at all. The live quota failure of 2026-08-25
 * came back in the second shape.
 *
 * @param json the parsed error body, or anything at all -- a body that is not an object at
 *   least answers null rather than throwing, since the caller has already given up on it
 * @returns the reason, or null when the body carries neither
 */
export function parseErrorReason(json: unknown): string | null {
  const error = (json as { error?: { errors?: unknown; status?: unknown } } | null)?.error;
  if (!error) return null;
  if (Array.isArray(error.errors)) {
    for (const entry of error.errors) {
      const reason = (entry as { reason?: unknown })?.reason;
      if (typeof reason === 'string' && reason) return reason;
    }
  }
  return typeof error.status === 'string' && error.status ? error.status : null;
}
```

- [ ] **Step 4: Carry it on the error**

`GmailHttpError` gains a fourth parameter. Before:

```ts
export class GmailHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Gmail's own Retry-After, which the retry policy prefers over its own backoff */
    readonly retryAfter: string | null = null,
  ) {
    super(message);
  }
}
```

After:

```ts
export class GmailHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Gmail's own Retry-After, which the retry policy prefers over its own backoff */
    readonly retryAfter: string | null = null,
    /** Why Gmail says it refused -- see parseErrorReason. Defaulted because two of the three
     * places that construct one have no body to read: an answer that would not parse, and a
     * batch refused as a whole. Neither can name a reason, and neither should pretend to. */
    readonly reason: string | null = null,
  ) {
    super(message);
  }
}
```

- [ ] **Step 5: Fill it at the one site that has a body**

In `attemptJson`'s response handler, the branch that reads Gmail's own message (around line 1775). Before:

```ts
        if (res.statusCode >= 400) {
          const msg = (json as { error?: { message?: string } })?.error?.message;
          fail(new GmailHttpError(msg ?? `HTTP ${res.statusCode}`, res.statusCode, after));
          return;
        }
```

After:

```ts
        if (res.statusCode >= 400) {
          const msg = (json as { error?: { message?: string } })?.error?.message;
          fail(
            new GmailHttpError(
              msg ?? `HTTP ${res.statusCode}`,
              res.statusCode,
              after,
              parseErrorReason(json),
            ),
          );
          return;
        }
```

Leave the other two construction sites alone — the unreadable-answer one a few lines above, and the batch one in `attemptMultipart`. Neither has a parsed body, and both correctly default to no reason.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/gmail-api.test.ts`
Expected: PASS.

Then: `npm test` and `npx tsc --noEmit -p tsconfig.json`
Expected: PASS. The new parameter is defaulted, so no existing construction site changes.

- [ ] **Step 7: Commit**

```bash
git add electron/gmail/gmail-api.ts tests/gmail-api.test.ts
git commit -m "feat(gmail): read the reason Gmail gives for refusing a request

A 403 carrying userRateLimitExceeded was indistinguishable from a 403
meaning no access to this mailbox, because only the message, the status
and the Retry-After were kept. Reads error.errors[].reason, falling back
to the error.status the quota front end writes instead -- which is the
shape the live quota failure came back as.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: A rate limit is its own kind of refusal

**Files:**
- Modify: `electron/gmail/retry.ts` — add `RATE_LIMIT_REASONS`, `isRateLimit`, the quota constants, `rateLimited` on `RetryAttempt`, and one branch in `retryWaitMs`
- Test: `tests/gmail-retry.test.ts` (append to the existing file)

**Interfaces:**
- Consumes: nothing at runtime. `isRateLimit` is called with a status and a reason, which task 2 makes available on `GmailHttpError` — but this task does not import from `gmail-api.ts` and must not (the dependency runs the other way).
- Produces:
  - `export function isRateLimit(status: number | null, reason: string | null): boolean`
  - `export const QUOTA_ATTEMPTS: number` (6)
  - `export const MAX_QUOTA_WAIT_MS: number` (75_000)
  - `RetryAttempt` gains `rateLimited?: boolean`

**Why:** `retryWaitMs` gives an insert three attempts across about two seconds — `MAX_ATTEMPTS = 3`, 500ms then 1.5s. A blown *minute* cannot be waited out in two seconds, so the policy exhausts itself inside the very window that refused it and hands the caller a failed mail. That is the `2573 van 2574`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/gmail-retry.test.ts`. The `attempt()` and `mid()` helpers already exist at the top of that file. Add `isRateLimit`, `QUOTA_ATTEMPTS` and `MAX_QUOTA_WAIT_MS` to the existing import from `../electron/gmail/retry`.

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/gmail-retry.test.ts`
Expected: FAIL — `isRateLimit` is not exported, so the file fails to collect.

- [ ] **Step 3: Add the constants and the predicate**

In `electron/gmail/retry.ts`, in the `Constants` section, below `RETRIABLE_INSERT_STATUS`:

```ts
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

/** Where a rate-limited wait stops. Kept apart from MAX_WAIT_MS rather than raising it: 30
 * seconds is right for a drag somebody is watching, and far too short for an insert inside a
 * copy of ten thousand. */
export const MAX_QUOTA_WAIT_MS = 75_000;
```

Then, in the `Exported functions` section, above `retryWaitMs`:

```ts
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
```

- [ ] **Step 4: Add the flag to the attempt**

In `RetryAttempt`, below `cancelled`:

```ts
  /** Set when isRateLimit read this refusal as a rate limit. Carried as a flag rather than
   * re-derived here, because the same 403 means two different things depending on the reason
   * beside it, and this module deliberately does not import the error class that holds it. */
  rateLimited?: boolean;
```

- [ ] **Step 5: Give a rate limit its own budget and its own wait**

Two edits inside `retryWaitMs`. First, the attempt cap. Before:

```ts
  if (a.attempt >= MAX_ATTEMPTS) return null;
```

After:

```ts
  // The attempt budget is the one thing a rate limit changes for every method at once: an
  // insert and a GET both deserve to sit out a quota window, and neither can do that inside
  // three attempts spread over two seconds.
  if (a.attempt >= (a.rateLimited ? QUOTA_ATTEMPTS : MAX_ATTEMPTS)) return null;
```

Second, the per-method gates and the wait. Before:

```ts
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
```

After:

```ts
  if (a.method === 'POST') {
    if (a.timedOut || a.status === null) return null;
    // One predicate wider than it was, named on purpose. A rate-limited call was turned away
    // before it was accepted, so nothing landed and repeating it cannot put a mail in a mailbox
    // twice -- which is the same proof RETRIABLE_INSERT_STATUS asks for, arriving as a 403
    // instead of a 429. Nothing else widens this branch.
    if (!RETRIABLE_INSERT_STATUS.has(a.status) && !a.rateLimited) return null;
  } else if (a.timedOut || a.status === null) {
    // A time-out already cost the full request timeout, so one more try is the whole budget
    if (a.attempt >= 2) return null;
  } else if (!RETRIABLE_STATUS.has(a.status) && !a.rateLimited) {
    return null;
  }

  // A quota window cannot be waited out by the ordinary backoff, so it is not tried: the wait
  // is the window's whole width, and Gmail's own Retry-After is preferred only where it asks
  // for longer than that.
  if (a.rateLimited) {
    const asked = retryAfterMs(a.retryAfter, now) ?? 0;
    return Math.min(Math.max(asked, QUOTA_WAIT_MS + QUOTA_MARGIN_MS), MAX_QUOTA_WAIT_MS);
  }

  const asked = retryAfterMs(a.retryAfter, now);
  if (asked !== null) return Math.min(asked, MAX_WAIT_MS);
```

The `a.cancelled` check stays exactly where it is, above all of this. Do not move it: a cancelled rate-limited attempt must be refused before the new branch can grant it a window.

Then extend the file's opening comment block, which today explains only the per-method split. Append these paragraphs to it, below the existing one about `messages.insert`:

```ts
// A rate limit crosses all of that. It is not a fourth method but a property any of them can
// come back with, and it is the one refusal worth waiting minutes rather than milliseconds for:
// the limit is per minute, so the ordinary backoff of half a second and then one and a half
// exhausts itself inside the very window that refused the call. That is how a copy of 2,574
// mails came back as 2,573 -- three attempts, two seconds, one lost mail.
//
// So a rate-limited attempt gets its own budget (QUOTA_ATTEMPTS) and its own wait, and that
// wait is capped by MAX_QUOTA_WAIT_MS rather than by MAX_WAIT_MS. Two constants for what looks
// like one thing, on purpose: thirty seconds is right for a drag with somebody watching it, and
// far too short for an insert three-quarters of the way through a copy of ten thousand. Raising
// MAX_WAIT_MS would have made the drag hang to save the copy.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/gmail-retry.test.ts`
Expected: PASS, including every pre-existing test in the file — none of them sets `rateLimited`, so none of them should move.

Then: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add electron/gmail/retry.ts tests/gmail-retry.test.ts
git commit -m "feat(gmail): let a rate-limited request wait out the window

Three attempts across two seconds cannot outlast a blown minute, so the
policy exhausted itself inside the very window that refused it and handed
back a failed mail. A refusal isRateLimit recognises now gets six
attempts and a full window's wait, capped apart from MAX_WAIT_MS because
a drag and a ten-thousand-mail copy want opposite answers. The insert
branch is widened by that one named predicate and nothing else: a
rate-limited call was refused before it was accepted, so repeating it
cannot duplicate a mail.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Point the call sites at the predicate

**Files:**
- Modify: `electron/gmail/gmail-api.ts` — the import, and two `status === 429` tests with their two failure mappers

**Interfaces:**
- Consumes: `parseErrorReason` and `GmailHttpError.reason` from Task 2; `isRateLimit` from Task 3.
- Produces: nothing new. This is the wiring that makes Tasks 2 and 3 take effect.

**Why this is its own task:** Tasks 2 and 3 are both inert until this happens. Keeping it separate means the two behaviour changes can each be reviewed against their own tests, and the wiring can be reviewed as wiring.

**What cannot be unit tested here, stated plainly:** these four edits live inside `requestJson` and `requestBatch`, which the suite does not reach — every test in `tests/gmail-api.test.ts` exercises pure functions. The gate for this task is the type checker plus the whole suite still passing, and after that a live run. Do not invent a mocked-HTTP test to manufacture a green check for it; the honest verification is the manual one in Step 5.

- [ ] **Step 1: Import the predicate**

`electron/gmail/retry.ts` is already imported by `gmail-api.ts`. Add `isRateLimit` to that existing import — do not add a second import statement from the same module.

- [ ] **Step 2: The refusal that lowers the ceiling**

Two places, identical in shape. In `requestJson` (around line 1525):

```ts
        if (e instanceof GmailHttpError && isRateLimit(e.status, e.reason)) budget.refused();
```

And in `requestBatch` (around line 1584), the same line. Both replace `e.status === 429`.

- [ ] **Step 3: The flag on the attempt**

In `requestJson`'s failure mapper, add one property beside the others:

```ts
    (e) => ({
      method: retryMethod ?? (init ? 'POST' : 'GET'),
      status: e instanceof GmailHttpError ? e.status : null,
      timedOut: e instanceof GmailTimeoutError,
      cancelled: e instanceof GmailCancelledError,
      retryAfter: e instanceof GmailHttpError ? e.retryAfter : null,
      rateLimited: e instanceof GmailHttpError && isRateLimit(e.status, e.reason),
    }),
```

Keep the existing comment about `cancelled` where it is. Then the same addition in `requestBatch`'s mapper:

```ts
      (e) => ({
        method: 'GET',
        status: e instanceof GmailHttpError ? e.status : null,
        timedOut: e instanceof GmailTimeoutError,
        retryAfter: e instanceof GmailHttpError ? e.retryAfter : null,
        rateLimited: e instanceof GmailHttpError && isRateLimit(e.status, e.reason),
      }),
```

- [ ] **Step 4: Verify**

Run: `npm test`
Expected: PASS, 1877 or more.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0, no output.

Run: `npx tsc --noEmit -p renderer/tsconfig.json`
Expected: exit 0, no output.

Then read back the four edited spots and confirm no remaining `status === 429` comparison is left in the file:

Run: `grep -n "status === 429" electron/gmail/gmail-api.ts`
Expected: no matches.

- [ ] **Step 5: Name the live check, do not run it**

This plan cannot prove itself green. Write the following into the commit body and stop — starting the app or a copy is the user's call, and the installed app holds the single-instance lock.

What the next real copy should show in `notify.log`:

- `[quota] Gmail weigerde binnen het budget; plafond nu 150 van de 250 eenheden per seconde` — now reachable from a 403 rate limit as well as a 429. Seeing it means the predicate fired and the ceiling adapted, which is the whole point.
- `[quota] rustig gebleven, plafond weer op 250 van de 250` after a quiet minute.
- A copy of a few thousand mails finishing with no `n-1 van n` — the failure this fixes.
- No mail taking minutes for no reason: a wait of 65 seconds should only ever appear near one of the two lines above. If inserts start waiting out windows without a refusal being logged, the predicate is reading something as a rate limit that is not one.

- [ ] **Step 6: Commit**

```bash
git add electron/gmail/gmail-api.ts
git commit -m "fix(gmail): treat a 403 rate limit as the refusal it is

Both places that lowered the quota ceiling tested for a literal 429, and
the retry policy was never told a refusal was a rate limit at all, so a
403 carrying userRateLimitExceeded went unrecognised twice over: the
ceiling did not adapt and an insert was not repeated. Points both at
isRateLimit and passes the flag through to the policy.

Not verifiable by the suite -- these four edits sit inside requestJson
and requestBatch, which no test reaches. The gate is the next live copy:
watch notify.log for the [quota] ceiling lines and for a copy of a few
thousand finishing without an n-1 of n.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## After the plan

Part 1 is done and part 2 has its own plan to be written. Before that plan is worth writing, the live check in Task 4 Step 5 should have happened once: every number in part 1 is a judgment call against a limit nobody outside Google can read directly, and part 2's batch sizing rests on those numbers being roughly right.

Two things this plan deliberately does not touch, both recorded in the spec so they are not rediscovered as bugs:

- **Budgets are keyed by access token** (`gmail-api.ts:1461`), so a token refreshed mid-copy starts a fresh cursor while the minute it enters still carries the old budget's spend on Gmail's side. Closing that means keying budgets by user, which reaches through `requestJson`'s signature into every call site. The safety fraction absorbs it; it does not remove it.
- **`messages.insert` cannot be batched.** Media uploads are refused inside a batch. That leg is bandwidth-bound anyway, so there is nothing to win — but the question comes back regularly, and the answer is no.
