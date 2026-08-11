# Delegated Discovery — App Side Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app learns which mailboxes a person may reach by asking the relay, instead of only by parsing Google's account-switcher DOM.

**Architecture:** A second source feeding the same `DelegatedStore`. The relay answers with addresses and nothing else, so a mailbox can now be known without a `/mail/u/<n>/d/<id>/` URL to open it with. That is the one structural change: `mailUrl` becomes nullable end to end, and an entry without one is a mailbox the app can use over the API but cannot show in a web view — which the surface layer already has a shape for (`surfacesForRef`, `provisional`).

**Tech Stack:** TypeScript, Electron main process, vitest. No new dependencies.

This is phase B of [`2026-08-11-delegated-discovery-api-design.md`](../specs/2026-08-11-delegated-discovery-api-design.md). Phase A (the relay's `GET /delegated/mailboxes`) lives in a different repository and is not this plan. **This plan does not depend on phase A being deployed:** every task is tested against an injected `fetch`, exactly as `tests/delegated-token.test.ts` does, and with no `delegatedMailboxesUrl` configured the app behaves as it does today.

## Global Constraints

- **Off unless configured.** No `delegatedMailboxesUrl` means no discovery call, no error, no behaviour change. Same shape as `delegatedTokenUrl` (`electron/main.ts:1143`) and `push-config.ts`.
- **`https://` required, except on loopback.** The request carries a live Google access token.
- **Detection only ever adds.** Neither source may remove an entry; only explicit user removal does (`electron/delegated-store.ts:1`).
- **The scrape stays.** Out-of-domain delegations are invisible to the API and visible in the switcher. The two sources are complementary.
- **Written artifacts in English**; user-facing strings in `renderer/app/strings.ts` follow the existing Dutch/English pair.
- Comments explain *why*, matching the surrounding files.

## File Structure

| File | Responsibility |
| --- | --- |
| `electron/delegated-mailboxes.ts` | **New.** Parse the config URL; ask the relay; map its answer to addresses. Pure, injected `fetch`, no Electron imports — the sibling of `delegated-token.ts`. |
| `electron/delegated-store.ts` | Modified. `mailUrl` nullable, and a merge that never lets a URL-less entry blank a captured URL. |
| `renderer/lib/account-ref.ts` | Modified. `mailUrl: string \| null` on the delegated ref. |
| `renderer/lib/surfaces.ts` | Modified. A delegated ref with no `mailUrl` offers no surfaces, and asking for its mail URL throws rather than returning null. |
| `electron/main.ts` | Modified. Fetch on startup and on demand, merge into the store, keep URL-less profiles out of view creation. |
| `renderer/app/AccountTab.tsx` | Modified. A mailbox with no URL reads as "click it once in Gmail" instead of failing silently. |
| `tests/delegated-mailboxes.test.ts` | **New.** |
| `tests/delegated-store.test.ts`, `tests/surfaces.test.ts` | Extended. |

---

### Task 1: Ask the relay for the mailbox list

**Files:**
- Create: `electron/delegated-mailboxes.ts`
- Test: `tests/delegated-mailboxes.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `parseMailboxesUrl(raw: unknown): string | null`, `requestDelegatedMailboxes(deps: MailboxesDeps): Promise<MailboxesOutcome>` where `MailboxesDeps = { url: string; requesterToken: string; fetch?: typeof fetch }` and `MailboxesOutcome = { ok: true; mailboxes: string[]; refreshedAt: number } | { ok: false; status: number; error: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/delegated-mailboxes.test.ts
// Which mailboxes this person may reach, answered by the relay. The Gmail API has no
// reverse lookup, so the app cannot work this out for itself; what it can do is refuse to
// send a live access token somewhere unencrypted, and refuse to believe an answer shaped
// wrong.

import { describe, expect, it } from 'vitest';
import { parseMailboxesUrl, requestDelegatedMailboxes } from '../electron/delegated-mailboxes';

const ok = (body: unknown) =>
  (async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;
const bad = (status: number, body: unknown) =>
  (async () => ({ ok: false, status, json: async () => body })) as unknown as typeof fetch;

const deps = (f: typeof globalThis.fetch) => ({
  url: 'https://relay.example.nl/delegated/mailboxes',
  requesterToken: 'caller',
  fetch: f,
});

describe('the configured url', () => {
  it('accepts https', () => {
    expect(parseMailboxesUrl('https://relay.example.nl/delegated/mailboxes')).toBe(
      'https://relay.example.nl/delegated/mailboxes',
    );
  });

  // The request carries a live Google access token, which is the same reason push refuses
  // plain ws:// off-machine.
  it('refuses plain http off-machine', () => {
    expect(parseMailboxesUrl('http://relay.example.nl/delegated/mailboxes')).toBeNull();
  });

  it('allows plain http on loopback, so a local relay can be tested', () => {
    expect(parseMailboxesUrl('http://127.0.0.1:8099/delegated/mailboxes')).toBe(
      'http://127.0.0.1:8099/delegated/mailboxes',
    );
    expect(parseMailboxesUrl('http://localhost:8099/delegated/mailboxes')).toBe(
      'http://localhost:8099/delegated/mailboxes',
    );
  });

  it('treats absent, blank and unparseable alike', () => {
    expect(parseMailboxesUrl(undefined)).toBeNull();
    expect(parseMailboxesUrl('  ')).toBeNull();
    expect(parseMailboxesUrl('not a url')).toBeNull();
    expect(parseMailboxesUrl(42)).toBeNull();
  });
});

describe('what the relay answers', () => {
  it('returns the mailboxes, lowercased', async () => {
    const res = await requestDelegatedMailboxes(
      deps(ok({ mailboxes: ['Support@Example.nl', 'bart@example.nl'], refreshedAt: 1754 })),
    );
    expect(res).toEqual({
      ok: true,
      mailboxes: ['support@example.nl', 'bart@example.nl'],
      refreshedAt: 1754,
    });
  });

  // A relay that answers 200 with something else is a bug on that side, and treating its
  // shape as trustworthy would put junk in the sidebar under the name of a mailbox.
  it('rejects entries that are not addresses', async () => {
    const res = await requestDelegatedMailboxes(
      deps(ok({ mailboxes: ['support@example.nl', '', 'nonsense', 42, null] })),
    );
    expect(res).toEqual({ ok: true, mailboxes: ['support@example.nl'], refreshedAt: 0 });
  });

  it('reports the relay\'s own words on a refusal', async () => {
    const res = await requestDelegatedMailboxes(deps(bad(403, { error: 'Niet toegestaan' })));
    expect(res).toEqual({ ok: false, status: 403, error: 'Niet toegestaan' });
  });

  it('falls back to the status when there is no message', async () => {
    const res = await requestDelegatedMailboxes(deps(bad(502, {})));
    expect(res).toEqual({ ok: false, status: 502, error: 'HTTP 502' });
  });

  it('survives a relay that is not there', async () => {
    const f = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const res = await requestDelegatedMailboxes(deps(f));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/delegated-mailboxes.test.ts`
Expected: FAIL — cannot resolve `../electron/delegated-mailboxes`.

- [ ] **Step 3: Write the implementation**

```ts
// electron/delegated-mailboxes.ts
// Which mailboxes the person may reach, asked of the relay rather than read out of Google's
// account-switcher DOM.
//
// The app cannot work this out itself: the Gmail API answers "who may reach mailbox X" and
// never "which mailboxes may I reach", so the inversion has to happen somewhere that may
// impersonate every mailbox in the domain — which is the relay, and is why the answer is
// taken on trust as far as membership goes. What is not taken on trust is its shape: this
// list becomes rows in the sidebar, and a relay bug should not be able to put an arbitrary
// string there under the name of a mailbox.
//
// Addresses only. The relay knows no URL for these mailboxes and never will — the id in
// `/mail/u/<n>/d/<id>/` exists only in Google's own interface — so what comes back is a
// mailbox you can reach over the API, not necessarily one you can open.

/** An address-shaped string, the same test the switcher scrape applies. */
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export interface MailboxesDeps {
  url: string;
  /** An access token for the account doing the asking; the relay filters on its identity. */
  requesterToken: string;
  fetch?: typeof fetch;
}

export type MailboxesOutcome =
  | { ok: true; mailboxes: string[]; refreshedAt: number }
  | { ok: false; status: number; error: string };

/** The configured endpoint, or null when there is none to use. Plain http is refused off
 * loopback because the request carries a live Google access token — the rule push already
 * applies to ws://. */
export function parseMailboxesUrl(raw: unknown): string | null {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol === 'https:') return text;
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  return url.protocol === 'http:' && loopback ? text : null;
}

export async function requestDelegatedMailboxes(deps: MailboxesDeps): Promise<MailboxesOutcome> {
  const doFetch = deps.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(deps.url, {
      headers: { authorization: `Bearer ${deps.requesterToken}` },
    });
  } catch (e) {
    return { ok: false, status: 0, error: `Relay niet bereikbaar: ${(e as Error).message}` };
  }

  const json = (await res.json().catch(() => ({}))) as { mailboxes?: unknown; refreshedAt?: unknown; error?: unknown };
  if (!res.ok) {
    const error = typeof json.error === 'string' && json.error !== '' ? json.error : `HTTP ${res.status}`;
    return { ok: false, status: res.status, error };
  }
  const raw = Array.isArray(json.mailboxes) ? json.mailboxes : [];
  const mailboxes = raw
    .filter((m): m is string => typeof m === 'string' && EMAIL_RE.test(m.trim()))
    .map((m) => m.trim().toLowerCase());
  return {
    ok: true,
    mailboxes,
    refreshedAt: typeof json.refreshedAt === 'number' ? json.refreshedAt : 0,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/delegated-mailboxes.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/delegated-mailboxes.ts tests/delegated-mailboxes.test.ts
git commit -m "feat: ask the relay which mailboxes a person may reach"
```

---

### Task 2: A stored mailbox may have no URL

**Files:**
- Modify: `electron/delegated-store.ts:13-29`
- Test: `tests/delegated-store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `StoredDelegate.mailUrl: string | null`; `upsert(d)` and `mergeScan(existing, scanned)` both carrying the rule that a `null` `mailUrl` never overwrites a stored non-null one.

**Why the rule goes in `upsert` and not only in `mergeScan`:** `mergeScan` is exported and tested but **not called anywhere in `electron/`** — verify with `grep -rn "mergeScan" --include=*.ts electron`, which finds only its own definition and comment. Every real write goes through `upsert` (`addDelegatedMailbox` at `main.ts:413`, the URL refresh at `main.ts:394`, and Task 4). A rule that lived only in `mergeScan` would be a rule nothing enforces.

- [ ] **Step 1: Write the failing test**

Append to `tests/delegated-store.test.ts`:

```ts
// The API knows addresses and no URLs; the scrape knows both. Combining them therefore has
// a direction: membership may come from either source, but a URL may only ever be gained,
// never lost — a mailbox that was openable this morning must not become unopenable because
// the source that spoke last has nothing to say about URLs.
//
// The rule is on upsert because upsert is what the app actually calls. mergeScan carries it
// too, so the two cannot disagree the day something starts using it.
describe('a write that carries no url', () => {
  it('keeps the stored url when a url-less entry is written over it', () => {
    const file = join(tmpdir(), `delegated-${Math.random().toString(36).slice(2)}.json`);
    const store = new DelegatedStore(file);
    store.upsert({ email: 'support@example.nl', mailUrl: 'https://mail.google.com/mail/u/0/d/AB/', calendarUrl: null });
    store.upsert({ email: 'support@example.nl', mailUrl: null, calendarUrl: null });
    expect(store.list()).toEqual([
      { email: 'support@example.nl', mailUrl: 'https://mail.google.com/mail/u/0/d/AB/', calendarUrl: null },
    ]);
  });

  it('stores a mailbox that has no url at all', () => {
    const file = join(tmpdir(), `delegated-${Math.random().toString(36).slice(2)}.json`);
    const store = new DelegatedStore(file);
    store.upsert({ email: 'bart@example.nl', mailUrl: null, calendarUrl: null });
    expect(store.list()).toEqual([{ email: 'bart@example.nl', mailUrl: null, calendarUrl: null }]);
  });

  it('takes a url when one finally arrives for a mailbox that had none', () => {
    const file = join(tmpdir(), `delegated-${Math.random().toString(36).slice(2)}.json`);
    const store = new DelegatedStore(file);
    store.upsert({ email: 'bart@example.nl', mailUrl: null, calendarUrl: null });
    store.upsert({ email: 'bart@example.nl', mailUrl: 'https://mail.google.com/mail/u/0/d/CD/', calendarUrl: null });
    expect(store.list()[0].mailUrl).toBe('https://mail.google.com/mail/u/0/d/CD/');
  });

  it('applies the same rule in mergeScan, so the two cannot disagree', () => {
    const existing = [{ email: 'support@example.nl', mailUrl: 'https://mail.google.com/mail/u/0/d/AB/', calendarUrl: null }];
    const { next } = mergeScan(existing, [{ email: 'support@example.nl', mailUrl: null, calendarUrl: null }]);
    expect(next).toEqual(existing);
  });
});
```

Use whatever `tmpdir`/`join` imports the existing tests in that file already use; if it builds its stores another way, follow that instead of introducing a second pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/delegated-store.test.ts`
Expected: FAIL — the first case returns `mailUrl: null`, because `upsert` replaces the entry wholesale and `mergeScan`'s `{ ...held, ...s }` lets the newer null win.

- [ ] **Step 3: Write the implementation**

In `electron/delegated-store.ts`, change the interface, `upsert` and the merge:

```ts
export interface StoredDelegate {
  email: string;
  /** Null for a mailbox discovered through the API, which knows the address and cannot know
   * the URL: the id in `/mail/u/<n>/d/<id>/` exists only in Google's own interface. Such a
   * mailbox is reachable over the API and not openable in a web view. */
  mailUrl: string | null;
  calendarUrl: string | null;
}

/** Absent is not the same as gone. A source that knows no URL — the API knows addresses and
 * nothing else — must not blank one that was captured, or a mailbox that opened this morning
 * stops opening because something wrote its address again. */
function keepUrls(held: StoredDelegate | undefined, incoming: StoredDelegate): StoredDelegate {
  return {
    ...held,
    ...incoming,
    mailUrl: incoming.mailUrl ?? held?.mailUrl ?? null,
    calendarUrl: incoming.calendarUrl ?? held?.calendarUrl ?? null,
  };
}

export function mergeScan(
  existing: StoredDelegate[],
  scanned: StoredDelegate[],
): { next: StoredDelegate[]; healthOk: boolean } {
  const byEmail = new Map(existing.map((d) => [d.email.toLowerCase(), d]));
  for (const s of scanned) {
    const key = s.email.toLowerCase();
    byEmail.set(key, keepUrls(byEmail.get(key), s));
  }
  return { next: [...byEmail.values()], healthOk: scanned.length >= existing.length };
}
```

And in the class, so the rule holds on the path the app actually uses:

```ts
  upsert(d: StoredDelegate): void {
    const items = this.list();
    const held = items.find((x) => x.email.toLowerCase() === d.email.toLowerCase());
    const rest = items.filter((x) => x.email.toLowerCase() !== d.email.toLowerCase());
    rest.push(keepUrls(held, d));
    this.write(rest);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/delegated-store.test.ts`
Expected: PASS, including the pre-existing merge tests.

- [ ] **Step 5: Commit**

```bash
git add electron/delegated-store.ts tests/delegated-store.test.ts
git commit -m "feat: let a stored delegated mailbox have no url"
```

---

### Task 3: A mailbox with no URL offers no surfaces

**Files:**
- Modify: `renderer/lib/account-ref.ts:4-6`, `renderer/lib/surfaces.ts:41-56,110-119`
- Test: `tests/surfaces.test.ts`

**Interfaces:**
- Consumes: `StoredDelegate.mailUrl` from Task 2.
- Produces: `AccountRef` delegated variant with `mailUrl: string | null`; `surfacesForRef(ref)` returns `[]` for a delegated ref with no `mailUrl`; `openableSurfaces({ kind, hasCalendar, hasMail })` gains `hasMail`.

- [ ] **Step 1: Write the failing test**

Append to `tests/surfaces.test.ts`:

```ts
// A delegated mailbox known only by address has nothing to load. The rule already exists
// one field over — a delegated mailbox offers calendar only when a calendar URL was
// captured — and mail is now the same kind of conditional. Getting this wrong ends in
// webContents.loadURL(null), which kills the main process, so the throw is the safety net
// and this list is what keeps anything from reaching it.
describe('a delegated mailbox with no mail url', () => {
  const ref = { kind: 'delegated', email: 'bart@example.nl', mailUrl: null, calendarUrl: null } as const;

  it('offers no surfaces at all', () => {
    expect(surfacesForRef(ref)).toEqual([]);
  });

  it('throws rather than hand out a url for one', () => {
    expect(() => SURFACE_CONFIG.mail.url(ref)).toThrow(/no mail url/i);
  });

  it('offers mail again once a url is captured', () => {
    expect(surfacesForRef({ ...ref, mailUrl: 'https://mail.google.com/mail/u/0/d/AB/' })).toEqual(['mail']);
  });

  it('is closed to the renderer too, which never sees a ref', () => {
    expect(openableSurfaces({ kind: 'delegated', hasCalendar: false, hasMail: false })).toEqual([]);
    expect(openableSurfaces({ kind: 'delegated', hasCalendar: false, hasMail: true })).toEqual(['mail']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/surfaces.test.ts`
Expected: FAIL — `surfacesForRef` returns `['mail']`, and `SURFACE_CONFIG.mail.url` returns `null` instead of throwing.

- [ ] **Step 3: Write the implementation**

`renderer/lib/account-ref.ts`:

```ts
export type AccountRef =
  | { kind: 'authuser'; index: number }
  | { kind: 'delegated'; email: string; mailUrl: string | null; calendarUrl: string | null };
```

`renderer/lib/surfaces.ts` — add the mail guard beside the calendar one, and widen both surface lists:

```ts
function delegatedMailUrl(ref: { email: string; mailUrl: string | null }): string {
  if (!ref.mailUrl) {
    throw new Error(`no mail url captured for delegated mailbox ${ref.email}`);
  }
  return ref.mailUrl;
}
```

```ts
  mail: {
    label: 'Mail',
    host: 'mail.google.com',
    url: (ref) =>
      ref.kind === 'delegated' ? delegatedMailUrl(ref) : `https://mail.google.com/mail/u/${ref.index}/`,
    backgroundThrottling: true,
  },
```

```ts
export function surfacesForRef(ref: AccountRef): Surface[] {
  if (ref.kind === 'authuser') return [...SURFACES];
  if (!ref.mailUrl) return [];
  return ref.calendarUrl ? ['mail', 'calendar'] : ['mail'];
}

export interface AccountSurfaces {
  kind: AccountRef['kind'];
  hasCalendar: boolean;
  /** False for a mailbox the API found and nobody has opened in Gmail yet. Defaults to true
   * so every existing caller keeps its meaning. */
  hasMail?: boolean;
  provisional?: boolean;
}

export function openableSurfaces(account: AccountSurfaces): Surface[] {
  if (account.provisional) return [];
  if (account.kind === 'authuser') return [...SURFACES];
  if (account.hasMail === false) return [];
  return account.hasCalendar ? ['mail', 'calendar'] : ['mail'];
}
```

Also update the file's header comment, which currently states the rule as "delegated mailboxes offer only mail, plus calendar when Google's switcher exposed one".

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/surfaces.test.ts tests/account-ref.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: tests PASS. `tsc` will now point at every place assuming a non-null `mailUrl` — fix each by refusing rather than defaulting (see Task 4); do not silence one with `!`.

- [ ] **Step 5: Commit**

```bash
git add renderer/lib/account-ref.ts renderer/lib/surfaces.ts tests/surfaces.test.ts
git commit -m "feat: a delegated mailbox with no url opens nothing"
```

---

### Task 4: Read the list at startup and merge it

**Files:**
- Modify: `electron/main.ts` — config reader beside `delegatedTokenUrl` (`:1143`), a fetch beside `refreshAndSuggestDelegated` (`:384`), `addDelegatedMailbox` (`:406`), `loadDelegatedProfiles` (`:341`)
- Test: covered by Tasks 1-3 plus the manual check below

**Interfaces:**
- Consumes: `requestDelegatedMailboxes`, `parseMailboxesUrl` (Task 1); `StoredDelegate.mailUrl: string \| null` (Task 2); `surfacesForRef` (Task 3).
- Produces: `refreshDelegatedFromApi(): Promise<void>`.

- [ ] **Step 1: Add the config reader**

Beside `delegatedTokenUrl`:

```ts
/** Where to ask which mailboxes this person may reach. Absent means discovery stays off and
 * the switcher scrape is the only source, which is what it is today.
 *
 * Environment before file, the rule push already follows (`push-config.ts:34`), and for the
 * same reason: a relay on loopback has to be testable without editing the one file that holds
 * the client secret. Read before the file is even opened, so it works on a machine that has no
 * config at all.
 *
 * An env var that is set but unusable is not quietly replaced by the file. It was set on
 * purpose; falling back would hide the mistake behind behaviour that looks like it worked,
 * which is the failure mode the whole config path is written to avoid. */
function delegatedMailboxesUrl(): string | null {
  const fromEnv = (process.env.GMAIL_DELEGATED_MAILBOXES_URL ?? '').trim();
  if (fromEnv !== '') return parseMailboxesUrl(fromEnv);
  const text = oauthConfigText();
  if (text === null) return null;
  try {
    const raw = JSON.parse(text) as { delegatedMailboxesUrl?: unknown };
    return parseMailboxesUrl(raw.delegatedMailboxesUrl);
  } catch {
    return null;
  }
}
```

Note for whoever runs this: `delegatedTokenUrl` (`main.ts:1143`) has no env override — the one that existed lives on an unmerged branch. Do not add one here as a drive-by; it is a separate change with its own reason to exist.

- [ ] **Step 2: Add the fetch and merge**

```ts
/** The API's half of discovery. Adds mailboxes the switcher never showed and never removes
 * one it does not mention: it cannot see an out-of-domain delegation, so its silence about a
 * mailbox is not evidence about that mailbox.
 *
 * Asked with one of the user's own accounts, active one first, exactly as a token request is
 * — the relay filters on who is asking, so a second account answers about a second person. */
async function refreshDelegatedFromApi(): Promise<void> {
  const url = delegatedMailboxesUrl();
  if (!url || !delegated) return;
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return;

  for (const requester of requestersInOrder()) {
    const token = await accessTokenFor(cfg, oauthTokens, requester.email);
    if (!token) continue;
    const res = await requestDelegatedMailboxes({ url, requesterToken: token });
    if (!res.ok) {
      console.warn(`[delegated] mailbox list via ${requester.email}: ${res.error}`);
      continue;
    }
    const known = new Set(profiles.map((p) => p.email.toLowerCase()));
    const fresh = res.mailboxes.filter((email) => !known.has(email) && !removed?.has(email));
    if (fresh.length === 0) return;
    // Plain upserts, not mergeScan: upsert is where the keep-the-url rule lives (Task 2), so
    // writing an address over a mailbox the switcher already gave a URL to is harmless.
    for (const email of fresh) delegated.upsert({ email, mailUrl: null, calendarUrl: null });
    loadDelegatedProfiles();
    console.log(`[delegated] ${fresh.length} mailbox(es) via ${requester.email}`);
    return;
  }
}
```

`requestersInOrder()` is the account ordering `delegatedTokenFor` already uses (`electron/main.ts:1178-1200`); extract it there rather than duplicating the loop, and have `delegatedTokenFor` call it too.

- [ ] **Step 3: Call it where the scrape is started**

At the startup site that sets `delegatedScanStarted` (`electron/main.ts:2148`), after the existing scrape call:

```ts
      void refreshDelegatedFromApi();
```

- [ ] **Step 4: Keep URL-less profiles out of view creation**

`loadDelegatedProfiles` calls `warmAccount(profile)` for every fresh profile, and warming loads the mail URL. Guard it:

```ts
    // A mailbox known only by address has nothing to warm — surfacesForRef says so, and
    // SURFACE_CONFIG.mail.url would throw if anything tried.
    for (const profile of fresh) {
      if (surfacesForRef(profile.ref).length > 0) warmAccount(profile);
    }
```

Then run `npx tsc --noEmit -p tsconfig.json` and resolve every remaining nullability error the same way: a site that needs a URL refuses the mailbox with a reason, it does not invent one.

- [ ] **Step 5: Verify by hand**

With no `delegatedMailboxesUrl` in `google-oauth.json`: start the app, confirm the sidebar is unchanged and no `[delegated]` line about mailboxes appears.

With a stub relay (`node -e "require('http').createServer((q,s)=>{s.setHeader('content-type','application/json');s.end(JSON.stringify({mailboxes:['stub@'+'example.nl'],refreshedAt:Date.now()}))}).listen(8099)"`) and `"delegatedMailboxesUrl": "http://127.0.0.1:8099/delegated/mailboxes"`: start the app and confirm one `[delegated] 1 mailbox(es) via …` line, a row in the sidebar, and that clicking it does not crash the main process.

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts
git commit -m "feat: discover delegated mailboxes through the relay at startup"
```

---

### Task 5: Say what a URL-less mailbox needs

**Files:**
- Modify: `electron/main.ts:418-447` (`TabRow`, `decorate`), `renderer/app/page.tsx:45` (`Profile`) and `:338` (`open`), `renderer/app/AccountTab.tsx:32-98`, `renderer/app/strings.ts`
- Test: `tests/surfaces.test.ts` (Task 3 covers the rule; this task is presentation)

**Interfaces:**
- Consumes: `surfacesForRef` (Task 3).
- Produces: `TabRow.hasMail: boolean`, carried through to the renderer's `Profile`.

- [ ] **Step 1: Send the flag**

`hasCalendar` already answers exactly this question one surface over (`main.ts:443`), so mail gets the same treatment. In `TabRow`:

```ts
  hasCalendar: boolean;
  /** False for a mailbox the API found and nobody has opened in Gmail yet: known by address,
   * with no URL to load. The seeded rows below are false for a different reason — they have
   * no ref at all yet — and both mean "do not try to open this". */
  hasMail: boolean;
```

In `decorate`, on the confirmed branch:

```ts
      hasMail: surfacesForRef(p.ref).includes('mail'),
```

and on the seeded branch, beside `hasCalendar: false`:

```ts
      hasMail: false,
```

- [ ] **Step 2: Add the strings**

In `renderer/app/strings.ts`, beside `delegatedTooltipSuffix`, in both language objects:

```ts
  delegatedNeedsClick: 'nog één keer openen in Gmail',
```

```ts
  delegatedNeedsClick: 'open once in Gmail first',
```

- [ ] **Step 3: Show it on the tab**

In `renderer/app/page.tsx`, add `hasMail?: boolean` to `Profile` beside `provisional?: boolean`, and short-circuit `open()` the way a provisional row already does — but without setting `pendingEmail`, because nothing is coming: a provisional tab is waiting for detection to finish, while this one is waiting for the user to click something in Gmail.

```ts
  function open(key: string, surface: Surface) {
    if (settingsOpen) setSettingsOpen(false);
    const row = profiles.find((p) => p.key === key);
    if (row?.provisional) {
      setPendingEmail(row.email.toLowerCase());
      return;
    }
    // Known by address, with no URL to load. Opening it would reach
    // SURFACE_CONFIG.mail.url and throw; the tooltip is what tells the user why.
    if (row && row.kind === 'delegated' && row.hasMail === false) return;
```

In `AccountTab.tsx`, take the flag and say so in the tooltip and the opacity:

```tsx
  strings: { delegatedTooltipSuffix: string; delegatedNeedsClick: string; numberLocale: string };
```

```tsx
  const delegated = profile.kind === 'delegated';
  const needsUrl = delegated && profile.hasMail === false;
  const surface = activeSurface && activeSurface !== 'mail' ? activeSurface : null;
```

```tsx
      title={
        needsUrl
          ? `${profile.email} — ${strings.delegatedNeedsClick}`
          : delegated
            ? `${profile.email} ${strings.delegatedTooltipSuffix}`
            : profile.email
      }
```

and add `needsUrl ? 'opacity-50' : ''` to the same template literal that already carries `dragging ? 'opacity-40' : ''`.

Pass `delegatedNeedsClick` through from wherever `delegatedTooltipSuffix` is passed in `page.tsx`.

- [ ] **Step 4: Verify by hand**

With the stub relay from Task 4 still running, confirm the row appears muted, the tooltip explains why, and clicking it does nothing rather than throwing.

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: PASS. (`tests/rene.test.ts` fails on an unrelated working-tree change to `RENE_ZOOM_FACTOR`; confirm that is still the only failure and that it fails on a clean checkout too before ignoring it.)

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts renderer/app/page.tsx renderer/app/AccountTab.tsx renderer/app/strings.ts
git commit -m "feat: say when a delegated mailbox still needs one click in Gmail"
```

---

## Not in this plan

- **Phase A**, the relay's `GET /delegated/mailboxes` — a different repository (`~/projects/gmail-push-relay`), which is not checked out on this machine. Its plan needs that repo open.
- **Phase C**, click-through capture of the `/d/<id>/` URL. Independent of everything here, and the thing that would let a mailbox found in Task 4 become openable without the user knowing to go looking.
- **A refresh button in the accounts panel.** The spec names startup *and* on demand; this plan does startup only. The relay caches its sweep for an hour, so a button would spend most of its clicks re-reading the same answer, and restarting the app is the existing way to force it. Worth adding once phase A is deployed and the real refresh latency is known.
- Refreshing the list on a timer, for the same reason.
