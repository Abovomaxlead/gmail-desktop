# OAuth Status In Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show per account in Settings → Accounts whether its Gmail connection works, with a button that fixes it when it does not.

**Architecture:** One pure function in `electron/oauth-health.ts` computes a four-state status per own account; the existing `accountsNeedingReconnect` is derived from it so the banner and the list cannot disagree. Main pushes the statuses over a new IPC pair from inside the health check it already runs. A new settings component draws the line and calls the `reconnectOAuth` bridge method that already exists.

**Tech Stack:** Electron 31 (main + preload), Next.js 14 static export renderer (React 18, Tailwind 3), TypeScript strict, Vitest.

## Global Constraints

- **Language of committed artifacts is English.** Code comments, commit messages and docs are English even though the app's UI text and this repo's older files are Dutch. Do not translate existing Dutch files.
- **UI text goes through `renderer/app/strings.ts`**, in all three sets: `STRINGS_NORMAL` (English), `STRINGS_RENE` (plain Dutch), `STRINGS_NL` (Dutch). Never hardcode UI text in a component.
- **Tailwind opacity must be bracketed:** `border-black/[0.08]`, never `border-black/8` — Tailwind 3's default scale steps by 5 and the unbracketed form emits nothing.
- **Settings styling comes from `renderer/app/settings/tokens.ts`.** Colour appears only where it means something.
- **Every test file lives in `tests/`** and tests a pure module. `electron/main.ts` is not unit-testable here; its gate is `tsc` plus the full suite plus a build.
- **Do not run `npm run build:renderer` (or `npm run build`, or `npm run dist`) while a Next dev server is running.** A production build poisons `renderer/.next` and makes the dev server 404 its own routes. Check for a listening port 3000 and for `electron.exe` first.
- Comments explain *why*, in the voice of the surrounding file. The existing files in this repo carry long explanatory headers; match that register rather than adding `// set the status`.

---

### Task 1: The four-state status, and the reconnect list derived from it

The load-bearing task. `accountsNeedingReconnect` currently answers "who needs reconnecting" by inspecting the inputs directly, and it collapses "no token was ever stored" and "the token stopped refreshing" into one reason. The accounts list needs those apart. Rather than compute the same thing twice — which is how a banner and a list end up disagreeing about one account, invisibly, until someone reports it — the reconnect list becomes a projection of the statuses.

**Files:**
- Create: `renderer/lib/oauth-status.ts`
- Modify: `electron/oauth-health.ts` (the `accountsNeedingReconnect` function, lines 24-34)
- Test: `tests/oauth-health.test.ts` (add two `describe` blocks; change nothing that is there)

**Interfaces:**
- Consumes: nothing from earlier tasks. `HealthInput` already exists in `electron/oauth-health.ts` with fields `ownEmails: string[]`, `hasToken: (email: string) => boolean`, `refreshFailed: (email: string) => boolean`, `pushConfigured: boolean`, `missingScopes: (email: string) => boolean`, `pushRefused: (email: string) => boolean`.
- Produces:
  - `type OAuthStatus = 'linked' | 'unlinked' | 'expired' | 'push-only'` from `renderer/lib/oauth-status`
  - `interface AccountOAuthStatus { email: string; status: OAuthStatus }` from `renderer/lib/oauth-status`
  - `accountOAuthStatuses(input: HealthInput): AccountOAuthStatus[]` from `electron/oauth-health`
  - `accountsNeedingReconnect(input: HealthInput): ReconnectAccount[]` — unchanged signature and unchanged behaviour

- [ ] **Step 1: Create the shared type module**

`renderer/lib/oauth-status.ts` is new. It lives in `renderer/lib` for the same reason `toast.ts` does: main imports from here and the renderer imports from here, so neither side has to reach into the other's tree and the two cannot drift.

```ts
// The OAuth link state of one account. In renderer/lib because both sides need it:
// electron/oauth-health.ts computes it from what main knows about the tokens, and the
// accounts panel draws it. Sharing the type is the point — a second copy on the renderer
// side is a second thing to forget when a state is added.
//
// Four states, where the reconnect banner has two. The banner only has to say that
// something needs attention, so "no token was ever stored" and "the token stopped
// refreshing" are the same sentence to it. A list has to answer a different question —
// whether this account was ever connected at all — and cannot do that from one reason.
//
// 'push-only' is the state that would be most misleading if it were folded into the
// others: the link works, mail can still be moved, and only notifications and the unread
// counter are down. Telling someone their connection is gone when it is not sends them
// re-granting consent for a problem they do not have.
export type OAuthStatus = 'linked' | 'unlinked' | 'expired' | 'push-only';

export interface AccountOAuthStatus {
  email: string;
  status: OAuthStatus;
}
```

- [ ] **Step 2: Write the failing tests**

Append both `describe` blocks to `tests/oauth-health.test.ts`. Add `accountOAuthStatuses` to the existing import on line 4, so it reads:

```ts
import { accountOAuthStatuses, accountsNeedingReconnect, bannerBounds } from '../electron/oauth-health';
```

Then append:

```ts
// The status the accounts panel draws. The precedence between the states is the part worth
// pinning down: a link that is gone outranks a scope that is missing, because re-granting
// a scope on an account with no token cannot succeed.
describe('accountOAuthStatuses', () => {
  const one = (over: Partial<Parameters<typeof accountOAuthStatuses>[0]> = {}) => ({
    ownEmails: ['a@x.nl'],
    hasToken: () => true,
    refreshFailed: () => false,
    pushConfigured: true,
    missingScopes: () => false,
    pushRefused: () => false,
    ...over,
  });
  const statusOf = (over: Partial<Parameters<typeof accountOAuthStatuses>[0]> = {}) =>
    accountOAuthStatuses(one(over))[0].status;

  it('is linked when the token works and push is happy', () => {
    expect(statusOf()).toBe('linked');
  });

  it('is unlinked when no token was ever stored', () => {
    expect(statusOf({ hasToken: () => false })).toBe('unlinked');
  });

  it('is expired when the refresh failed', () => {
    expect(statusOf({ refreshFailed: () => true })).toBe('expired');
  });

  it('is push-only when the token predates a scope push needs', () => {
    expect(statusOf({ missingScopes: () => true })).toBe('push-only');
  });

  it('is push-only when the relay refused the token for good', () => {
    expect(statusOf({ pushRefused: () => true })).toBe('push-only');
  });

  // Same rule the banner has always had: every pre-existing token predates the push scope,
  // so counting that as a fault would flag every machine after an update.
  it('is linked despite a push problem when push is not configured at all', () => {
    expect(
      statusOf({ pushConfigured: false, missingScopes: () => true, pushRefused: () => true }),
    ).toBe('linked');
  });

  it('prefers unlinked over a push problem', () => {
    expect(statusOf({ hasToken: () => false, missingScopes: () => true })).toBe('unlinked');
  });

  it('prefers expired over a push problem', () => {
    expect(statusOf({ refreshFailed: () => true, pushRefused: () => true })).toBe('expired');
  });

  it('has one entry per own account, in the order given', () => {
    expect(accountOAuthStatuses(one({ ownEmails: ['b@x.nl', 'a@x.nl'] })).map((s) => s.email)).toEqual([
      'b@x.nl',
      'a@x.nl',
    ]);
  });

  // A delegated mailbox has no link of its own; it is reached through the account that
  // delegates it, and is never in ownEmails.
  it('says nothing at all about an account that is not its own', () => {
    expect(accountOAuthStatuses(one({ ownEmails: [] }))).toEqual([]);
  });
});

// The test that protects the decision this change is built on. The banner and the accounts
// panel must never disagree about the same account, which is guaranteed only while the
// reconnect list is a projection of the statuses. Every combination of the five inputs is
// checked, so a future state added to OAuthStatus without a mapping fails here rather than
// silently dropping an account out of the banner.
describe('accountsNeedingReconnect follows accountOAuthStatuses', () => {
  const bools = [true, false];
  const cases: Parameters<typeof accountsNeedingReconnect>[0][] = [];
  for (const token of bools)
    for (const failed of bools)
      for (const configured of bools)
        for (const scopes of bools)
          for (const refused of bools)
            cases.push({
              ownEmails: ['a@x.nl'],
              hasToken: () => token,
              refreshFailed: () => failed,
              pushConfigured: configured,
              missingScopes: () => scopes,
              pushRefused: () => refused,
            });

  it.each(cases.map((input, i) => ({ i, input })))(
    'case $i reports exactly what the statuses imply',
    ({ input }) => {
      const expected = accountOAuthStatuses(input)
        .filter((s) => s.status !== 'linked')
        .map((s) => ({ email: s.email, reason: s.status === 'push-only' ? 'push' : 'expired' }));
      expect(accountsNeedingReconnect(input)).toEqual(expected);
    },
  );
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/oauth-health.test.ts`

Expected: FAIL. The `accountOAuthStatuses` block fails to import — vitest reports something like `No "accountOAuthStatuses" export is defined on the "../electron/oauth-health" mock` or a `TypeError: accountOAuthStatuses is not a function`. The 32 derivation cases fail for the same reason.

The pre-existing `accountsNeedingReconnect` and `bannerBounds` blocks must still pass. If they do not, you have edited something you should not have.

- [ ] **Step 4: Write the implementation**

In `electron/oauth-health.ts`, add the type import below the existing `ReconnectReason` type declaration area — it goes at the top of the file, since the file currently has no imports:

```ts
import type { AccountOAuthStatus, OAuthStatus } from '../renderer/lib/oauth-status';
```

Then replace the whole `accountsNeedingReconnect` function (currently lines 24-34) with:

```ts
/** The link state of every own account, in the order they were given. The panel draws
 * these directly; the banner takes the projection below. */
export function accountOAuthStatuses(input: HealthInput): AccountOAuthStatus[] {
  return input.ownEmails.map((email) => ({ email, status: statusFor(input, email) }));
}

/** Precedence matters and is not arbitrary. A link that is gone outranks a scope that is
 * missing, because there is nothing to re-grant a scope on; and a push fault only counts
 * when push is configured, since every token stored before the push scope existed lacks
 * it and would otherwise flag every machine after an update. */
function statusFor(input: HealthInput, email: string): OAuthStatus {
  if (!input.hasToken(email)) return 'unlinked';
  if (input.refreshFailed(email)) return 'expired';
  if (input.pushConfigured && (input.missingScopes(email) || input.pushRefused(email))) {
    return 'push-only';
  }
  return 'linked';
}

/** How each status reads to the banner, which has only two reasons and only needs two: a
 * link that is gone is 'expired' whether it expired or was never made, because the
 * sentence the banner writes about it is the same either way. `linked` is absent from this
 * map, which is what keeps a healthy account out of the banner. */
const RECONNECT_REASON: Partial<Record<OAuthStatus, ReconnectReason>> = {
  unlinked: 'expired',
  expired: 'expired',
  'push-only': 'push',
};

/** Which accounts the banner should name, derived from the statuses rather than worked out
 * again. Two functions reading the same inputs to answer overlapping questions is how the
 * banner and the accounts panel would come to disagree about one account, and that
 * disagreement would be invisible until someone reported it. */
export function accountsNeedingReconnect(input: HealthInput): ReconnectAccount[] {
  const out: ReconnectAccount[] = [];
  for (const { email, status } of accountOAuthStatuses(input)) {
    const reason = RECONNECT_REASON[status];
    if (reason) out.push({ email, reason });
  }
  return out;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/oauth-health.test.ts`

Expected: PASS, all blocks. The pre-existing `accountsNeedingReconnect` tests passing unchanged is the proof that behaviour was preserved.

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json`

Expected: all test files pass (the count should be the previous total plus 42 — 10 status tests and 32 derivation cases), and `tsc` prints nothing.

`tests/reconnect-text.test.ts` passing untouched matters here: it covers the banner headings that read the reasons this task just re-derived.

- [ ] **Step 7: Commit**

```bash
git add renderer/lib/oauth-status.ts electron/oauth-health.ts tests/oauth-health.test.ts
git commit -m "refactor: derive the reconnect list from a per-account OAuth status

The accounts panel needs to tell 'never linked' from 'link expired', which the
banner's two reasons cannot express. Rather than compute the same facts a second
time, accountsNeedingReconnect becomes a projection of the new statuses, so the
banner and the panel cannot disagree about one account."
```

---

### Task 2: Getting the statuses to the renderer

Main already computes everything this needs, once every five minutes and after every event that could change it. This task stores the result and pushes it, and adds the two bridge methods the panel will call.

**Files:**
- Modify: `electron/ipc.ts` (add two channels after `OAUTH_RECONNECT`, around line 60)
- Modify: `electron/main.ts` (import around line 135; module state next to `reconnectAccounts` around line 228; `checkOAuthHealth` around lines 1120-1145; `registerIpc` next to the `OAUTH_RECONNECT_GET` handler around line 2892)
- Modify: `electron/sidebar-preload.ts` (import around line 11; two methods next to `reconnectOAuth`, around line 119)
- Modify: `renderer/app/page.tsx` (the `DesktopBridge` interface, next to `reconnectOAuth` on line 232)
- Test: none. `main.ts` is not unit-testable in this repo; the gate is `tsc` on both projects, the full suite, and a main-process bundle.

**Interfaces:**
- Consumes: `accountOAuthStatuses(input: HealthInput): AccountOAuthStatus[]` from `electron/oauth-health` (Task 1); `AccountOAuthStatus` from `renderer/lib/oauth-status` (Task 1).
- Produces:
  - `IPC.OAUTH_STATUS_GET` (`'oauth:status-get'`) and `IPC.OAUTH_STATUS_CHANGED` (`'oauth:status-changed'`)
  - bridge method `getOAuthStatus(): Promise<{ accounts: AccountOAuthStatus[] }>`
  - bridge method `onOAuthStatus(cb: (arg: { accounts: AccountOAuthStatus[] }) => void): void`

Note for whoever picks this up: **the main window's preload is `sidebar-preload.ts`, not `preload.ts`.** `preload.ts` is loaded into the Gmail views. The settings panel therefore already has `reconnectOAuth` available, which is why this task adds no reconnect plumbing.

- [ ] **Step 1: Add the two channels**

In `electron/ipc.ts`, the existing lines read:

```ts
  OAUTH_RECONNECT_GET: 'oauth:reconnect-get',
  OAUTH_RECONNECT: 'oauth:reconnect',
```

Add directly beneath them:

```ts
  OAUTH_STATUS_GET: 'oauth:status-get',
  OAUTH_STATUS_CHANGED: 'oauth:status-changed',
```

- [ ] **Step 2: Compute, store and push the statuses in main**

In `electron/main.ts`, change the `oauth-health` import (line ~135) from:

```ts
import { accountsNeedingReconnect, bannerBounds, type ReconnectAccount } from './oauth-health';
```

to:

```ts
import {
  accountOAuthStatuses,
  accountsNeedingReconnect,
  bannerBounds,
  type ReconnectAccount,
} from './oauth-health';
import type { AccountOAuthStatus } from '../renderer/lib/oauth-status';
```

Next to `let reconnectAccounts: ReconnectAccount[] = [];` (line ~228), add:

```ts
// The last statuses the health check computed, for a settings panel that opens between
// two checks. Set in the same pass as the banner's list so the two cannot describe
// different moments. A removed account lingers here until the next check, which is
// harmless: the panel matches these against the profiles it has and an entry no profile
// claims is never drawn.
let oauthStatuses: AccountOAuthStatus[] = [];
```

Then in `checkOAuthHealth`, replace this block:

```ts
  const needing = accountsNeedingReconnect({
    ownEmails,
    hasToken: (e) => oauthTokens!.get(e) !== undefined,
    refreshFailed: (e) => refreshFailures.has(e),
    pushConfigured: pushConfig() !== null,
    missingScopes: (e) => {
      const token = oauthTokens!.get(e);
      return token !== undefined && !hasScopes(token);
    },
    pushRefused: (e) => pushRefusals.has(e),
  });
  showReconnectBanner(needing);
```

with:

```ts
  // One set of inputs, read once, for both answers. The banner and the accounts panel
  // describing the same accounts differently would be a bug nobody could see.
  const health = {
    ownEmails,
    hasToken: (e: string) => oauthTokens!.get(e) !== undefined,
    refreshFailed: (e: string) => refreshFailures.has(e),
    pushConfigured: pushConfig() !== null,
    missingScopes: (e: string) => {
      const token = oauthTokens!.get(e);
      return token !== undefined && !hasScopes(token);
    },
    pushRefused: (e: string) => pushRefusals.has(e),
  };
  oauthStatuses = accountOAuthStatuses(health);
  mainWindow.webContents.send(IPC.OAUTH_STATUS_CHANGED, { accounts: oauthStatuses });
  showReconnectBanner(accountsNeedingReconnect(health));
```

`mainWindow` is non-null here: `checkOAuthHealth` returns at its top unless `mainWindow` exists and is not destroyed.

Leave the early return at the top of `checkOAuthHealth` exactly as it is. When OAuth is not configured that return means nothing is ever pushed, `oauthStatuses` stays empty, and the panel draws no status lines — which is the correct answer for a machine where nothing is linkable.

- [ ] **Step 3: Answer the get in registerIpc**

In `registerIpc`, directly below the existing line:

```ts
  ipcMain.handle(IPC.OAUTH_RECONNECT_GET, () => ({ accounts: reconnectAccounts }));
```

add:

```ts
  ipcMain.handle(IPC.OAUTH_STATUS_GET, () => ({ accounts: oauthStatuses }));
```

- [ ] **Step 4: Expose both on the bridge**

In `electron/sidebar-preload.ts`, add to the imports (next to the existing `import type { ReconnectAccount } from './oauth-health';`):

```ts
import type { AccountOAuthStatus } from '../renderer/lib/oauth-status';
```

Then, directly after the existing `reconnectOAuth` method (line ~119), add:

```ts
  getOAuthStatus: (): Promise<{ accounts: AccountOAuthStatus[] }> =>
    ipcRenderer.invoke(IPC.OAUTH_STATUS_GET),
  // Pushed after every health check. Paired with the get above because main may have sent
  // a list before the settings panel existed — the same reason the reconnect page does both.
  onOAuthStatus: (cb: (arg: { accounts: AccountOAuthStatus[] }) => void): void => {
    ipcRenderer.on(IPC.OAUTH_STATUS_CHANGED, (_e, arg) => cb(arg));
  },
```

- [ ] **Step 5: Declare both on the renderer's bridge type**

In `renderer/app/page.tsx`, add the type import next to the existing `import type { ReconnectAccount } from './reconnect-text';` (line ~17):

```ts
import type { AccountOAuthStatus } from '../lib/oauth-status';
```

Then in the `DesktopBridge` interface, directly after `reconnectOAuth(email: string): Promise<{ ok: boolean; error?: string }>;` (line ~232), add:

```ts
  getOAuthStatus(): Promise<{ accounts: AccountOAuthStatus[] }>;
  onOAuthStatus(cb: (arg: { accounts: AccountOAuthStatus[] }) => void): void;
```

- [ ] **Step 6: Typecheck both projects, run the suite, bundle main**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p renderer/tsconfig.json && npx vitest run && npm run build:main`

Expected: both `tsc` runs print nothing, every test passes with the same count as at the end of Task 1, and esbuild reports the three bundles. `build:main` only runs esbuild and does not touch `renderer/.next`, so it is safe with a dev server running.

- [ ] **Step 7: Commit**

```bash
git add electron/ipc.ts electron/main.ts electron/sidebar-preload.ts renderer/app/page.tsx
git commit -m "feat: push the per-account OAuth status to the renderer

Computed in the same pass as the reconnect banner's list, from one read of one
set of inputs, and offered both as a push and as a get because main may have
sent it before the settings panel existed."
```

---

### Task 3: The nine strings, in all three sets

**Files:**
- Modify: `renderer/app/strings.ts` — the `UiStrings` interface (after `noAccounts: string;`, line ~245), `STRINGS_NORMAL` (after `noAccounts:`, line ~623), `STRINGS_RENE` (after `noAccounts:`, line ~903), `STRINGS_NL` (after `noAccounts:`, line ~1198)
- Test: `tests/strings-sets.test.ts` — no edit needed; it already asserts the three sets are interchangeable and will fail if a key is missing from one.

**Interfaces:**
- Consumes: nothing.
- Produces: nine keys on `UiStrings`, all `string`: `oauthLinked`, `oauthUnlinked`, `oauthExpired`, `oauthPushOnly`, `oauthConnect`, `oauthReconnect`, `oauthReallow`, `oauthBusy`, `oauthFailed`.

- [ ] **Step 1: Add the keys to the interface**

`UiStrings` is what makes the compiler check `STRINGS_NL`, so this step is what turns the next two into compile errors until they are done. In `renderer/app/strings.ts`, after `noAccounts: string;`:

```ts
  // The OAuth link state of one account, in the accounts list. Three broken states get
  // three different button words because they ask for three different things: an account
  // that was never linked cannot be "reconnected", and a push fault needs consent for a
  // scope rather than a new link.
  oauthLinked: string;
  oauthUnlinked: string;
  oauthExpired: string;
  oauthPushOnly: string;
  oauthConnect: string;
  oauthReconnect: string;
  oauthReallow: string;
  oauthBusy: string;
  oauthFailed: string;
```

- [ ] **Step 2: Run the typecheck to verify it fails**

Run: `npx tsc --noEmit -p renderer/tsconfig.json`

Expected: FAIL, with errors on `STRINGS_NORMAL`, `STRINGS_RENE` and `STRINGS_NL` of the form `Property 'oauthLinked' is missing in type ... but required in type 'UiStrings'`. Three errors, one per set. (If only some sets error, check whether that set is annotated `: UiStrings`; add the missing keys to all three regardless.)

- [ ] **Step 3: Fill in the English set**

In `STRINGS_NORMAL`, after its `noAccounts:` entry:

```ts
  oauthLinked: 'Connected',
  oauthUnlinked: 'Not connected yet',
  oauthExpired: 'Connection expired',
  oauthPushOnly: 'Notifications are off',
  oauthConnect: 'Connect',
  oauthReconnect: 'Reconnect',
  oauthReallow: 'Allow again',
  oauthBusy: 'Working…',
  oauthFailed: 'Did not work',
```

- [ ] **Step 4: Fill in the plain-Dutch (Rene) set**

In `STRINGS_RENE`, after its `noAccounts:` entry. This set is the plainest Dutch of the three — short sentences and no jargon, and where the other sets name the mechanism ("verbinding verlopen", "opnieuw toestaan") this one says what the person gets instead:

```ts
  oauthLinked: 'Alles in orde',
  oauthUnlinked: 'Nog niet aangezet',
  oauthExpired: 'De verbinding is weg',
  oauthPushOnly: 'Je krijgt geen meldingen',
  oauthConnect: 'Aanzetten',
  oauthReconnect: 'Opnieuw aanzetten',
  oauthReallow: 'Meldingen aanzetten',
  oauthBusy: 'Momentje…',
  oauthFailed: 'Het lukte niet',
```

- [ ] **Step 5: Fill in the Dutch set**

In `STRINGS_NL`, after its `noAccounts:` entry:

```ts
  oauthLinked: 'Verbonden',
  oauthUnlinked: 'Nog niet verbonden',
  oauthExpired: 'Verbinding verlopen',
  oauthPushOnly: 'Meldingen staan stil',
  oauthConnect: 'Verbinden',
  oauthReconnect: 'Opnieuw verbinden',
  oauthReallow: 'Opnieuw toestaan',
  oauthBusy: 'Bezig…',
  oauthFailed: 'Mislukt',
```

- [ ] **Step 6: Verify the typecheck and the set test pass**

Run: `npx tsc --noEmit -p renderer/tsconfig.json && npx vitest run tests/strings-sets.test.ts`

Expected: `tsc` prints nothing; the strings-sets tests pass.

- [ ] **Step 7: Commit**

```bash
git add renderer/app/strings.ts
git commit -m "feat: strings for the OAuth status of an account

Nine keys in all three sets. The three broken states get three different button
words on purpose: an account that was never linked cannot be reconnected, and a
push fault needs consent for a scope rather than a new link."
```

---

### Task 4: The status line and its button, in the account card

**Files:**
- Create: `renderer/app/settings/AccountOAuthRow.tsx`
- Modify: `renderer/app/settings/AccountsSection.tsx` (imports at the top; one call to the hook inside the component; one lookup and one element inside the `profiles.map` callback, right after the email `<span>` that ends with the delegated suffix)
- Test: none automated — every test in this repo is a pure module and there is no React test setup. Verified by hand in a build, in Step 6.

**Interfaces:**
- Consumes: `AccountOAuthStatus`, `OAuthStatus` from `renderer/lib/oauth-status` (Task 1); `getOAuthStatus` / `onOAuthStatus` / `reconnectOAuth` from the bridge (Task 2, and `reconnectOAuth` pre-existing); the nine `oauth*` strings (Task 3); `BUTTON` and `DANGER_TEXT` from `renderer/app/settings/tokens`.
- Produces:
  - `useOAuthStatuses(): AccountOAuthStatus[]`
  - `AccountOAuthRow({ S, email, status }: { S: UiStrings; email: string; status: OAuthStatus })`

- [ ] **Step 1: Create the component and the hook**

Create `renderer/app/settings/AccountOAuthRow.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { AccountOAuthStatus, OAuthStatus } from '../../lib/oauth-status';
import type { UiStrings } from '../strings';
import { BUTTON, DANGER_TEXT } from './tokens';

// Whether an account's Gmail link actually works, in the account's own card. Until this
// existed the only place that said so was a banner in the bottom-right corner, and only
// once something was already broken — so "is this account linked?" was a question you
// answered by noticing that notifications had stopped.
//
// Its own file rather than more lines in AccountsSection, which already owns naming,
// drag-ordering, colour and removal. This is the one concern here with async state and an
// error to display, and it is the one a reader can skip entirely if they came for the
// drag-and-drop.
//
// The button is only drawn for a state that needs it, so it reads as a signal rather than
// as furniture — four identical buttons down the list would say nothing about which
// account is the problem. Nothing is updated optimistically after a click: main re-runs
// the health check as part of reconnecting, so the new status arrives over
// onOAuthStatus by itself, and a row that guessed would only be able to guess wrong.

// One IPC listener per page load, no matter how many times the accounts section is
// mounted. The section unmounts every time the user visits another settings section, and
// the bridge's `on` has no removal, so subscribing per mount would stack listeners for as
// long as the panel is open. This is the same shape DownloadHistorySection uses.
const listeners = new Set<(accounts: AccountOAuthStatus[]) => void>();
let subscribed = false;
// The last list seen, so re-opening the section shows what is known instead of flashing
// blank until the next check — which can be five minutes away.
let known: AccountOAuthStatus[] = [];

function subscribeToStatus(cb: (accounts: AccountOAuthStatus[]) => void): () => void {
  listeners.add(cb);
  if (!subscribed) {
    subscribed = true;
    window.desktop?.onOAuthStatus(({ accounts }) => {
      known = accounts;
      for (const l of listeners) l(accounts);
    });
  }
  return () => {
    listeners.delete(cb);
  };
}

/** The statuses main has computed, live. Empty until the first health check has run, which
 *  is the honest answer: no entry means no status line, which is also what a delegated
 *  mailbox and a machine without OAuth configured get. */
export function useOAuthStatuses(): AccountOAuthStatus[] {
  const [accounts, setAccounts] = useState<AccountOAuthStatus[]>(known);

  useEffect(() => {
    const unsubscribe = subscribeToStatus(setAccounts);
    const pending = window.desktop?.getOAuthStatus();
    if (pending) {
      void pending.then(({ accounts: fetched }) => {
        // Only if nothing has arrived by push in the meantime: this answer was true when
        // it was asked for, and a push that landed first is newer.
        if (known.length === 0) {
          known = fetched;
          setAccounts(fetched);
        }
      });
    }
    return unsubscribe;
  }, []);

  return accounts;
}

function statusLabel(status: OAuthStatus, S: UiStrings): string {
  switch (status) {
    case 'linked':
      return S.oauthLinked;
    case 'unlinked':
      return S.oauthUnlinked;
    case 'expired':
      return S.oauthExpired;
    case 'push-only':
      return S.oauthPushOnly;
  }
}

/** Null for a link that works — there is nothing to ask for. */
function actionLabel(status: OAuthStatus, S: UiStrings): string | null {
  switch (status) {
    case 'linked':
      return null;
    case 'unlinked':
      return S.oauthConnect;
    case 'expired':
      return S.oauthReconnect;
    case 'push-only':
      return S.oauthReallow;
  }
}

function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// The same triangle the reconnect banner uses, so the two places that report this problem
// look like they are reporting the same problem.
function WarningIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
    </svg>
  );
}

export function AccountOAuthRow({
  S,
  email,
  status,
}: {
  S: UiStrings;
  email: string;
  status: OAuthStatus;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const action = actionLabel(status, S);
  const broken = status !== 'linked';

  function connect(): void {
    setBusy(true);
    setError('');
    const pending = window.desktop?.reconnectOAuth(email);
    // No bridge means no consent screen will ever open, so the row must not sit on "busy"
    // waiting for an answer that cannot come.
    if (!pending) {
      setBusy(false);
      return;
    }
    void pending.then((r) => {
      setBusy(false);
      if (!r.ok) setError(r.error || S.oauthFailed);
    });
  }

  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span
        className={`flex min-w-0 items-center gap-1.5 text-xs ${
          broken ? 'text-amber-600 dark:text-amber-500' : 'text-neutral-500'
        }`}
      >
        {broken ? (
          <WarningIcon className="h-3 w-3 shrink-0" />
        ) : (
          <CheckIcon className="h-3 w-3 shrink-0" />
        )}
        <span className="truncate">{statusLabel(status, S)}</span>
      </span>

      {action ? (
        <span className="flex min-w-0 flex-col gap-1">
          <button type="button" onClick={connect} disabled={busy} className={`${BUTTON} self-start`}>
            {busy ? S.oauthBusy : action}
          </button>
          {error ? (
            <span className={`truncate text-xs ${DANGER_TEXT}`} title={error}>
              {error}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
```

- [ ] **Step 2: Render it in the account card**

In `renderer/app/settings/AccountsSection.tsx`, add to the imports at the top:

```tsx
import { AccountOAuthRow, useOAuthStatuses } from './AccountOAuthRow';
```

Inside the `AccountsSection` component, next to the other `useState` calls, add:

```tsx
  const oauthStatuses = useOAuthStatuses();
```

Inside the `profiles.map((p) => {` callback, next to the existing `const delegated = p.kind === 'delegated';`, add:

```tsx
    // Only own accounts have a link of their own; a delegated mailbox is reached through
    // the account that delegates it. An account with no entry has no status line either —
    // that covers OAuth not being configured at all, and the moment before the first
    // health check has run.
    const oauth = delegated ? undefined : oauthStatuses.find((s) => s.email === p.email);
```

Then find the email `<span>` — it is the one that closes right after the delegated suffix:

```tsx
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-neutral-500">
                      <span className="truncate">{p.email}</span>
                      {delegated && (
                        <>
                          <DelegatedIcon className="h-3 w-3 shrink-0" />
                          <span className="truncate">{S.delegatedTooltipSuffix}</span>
                        </>
                      )}
                    </span>
```

Directly after that closing `</span>`, add:

```tsx
                    {oauth ? <AccountOAuthRow S={S} email={p.email} status={oauth.status} /> : null}
```

This puts the status line under the email address and above the colour swatches, inside the existing `flex flex-col gap-1` column, so it needs no layout of its own.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p renderer/tsconfig.json && npx tsc --noEmit -p tsconfig.json`

Expected: both print nothing.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run`

Expected: everything passes, same count as at the end of Task 3. No test covers the component; this is a check that nothing else broke.

- [ ] **Step 5: Build**

First make sure nothing is holding `renderer/.next` or the single-instance lock:

```bash
tasklist | grep -i -E "electron|node.exe"
netstat -ano | grep LISTENING | grep :3000
```

If a Next dev server is listening on 3000, stop it before building — a production build poisons `.next` and the dev server then 404s its own routes. If `electron.exe` is running, close the app or the built one will start and silently exit on the single-instance lock.

Then:

```bash
npm run build && npx electron-builder --win nsis --publish never
```

Expected: Next reports all routes exported, esbuild reports three bundles, electron-builder writes `dist/Gmail Desktop Setup <version>.exe`. Use `--publish never` so a local build can never push a GitHub release.

- [ ] **Step 6: Verify by hand**

Run `dist/win-unpacked/Gmail Desktop.exe` (no install needed, same userData) and open Settings → Accounts.

Check:
1. Every own account shows a status line under its email address. A working one reads "Verbonden" with a check, in grey, and has **no** button.
2. A delegated mailbox shows no status line at all.
3. Switch to another settings section and back several times. The status is still there immediately, and does not flash blank.
4. Switch the language (Settings → General) and confirm the status line follows it.

To see a broken state, back up the token file and remove one account's entry:

```bash
cp "$APPDATA/gmail-desktop/google-tokens.json" "$APPDATA/gmail-desktop/google-tokens.json.bak"
```

Edit `google-tokens.json`, delete one account's object, restart the app, and wait about two seconds for the health check. That account must read "Nog niet verbonden" with a **Verbinden** button, and the bottom-right reconnect banner must name the same account — the two agreeing is the point of Task 1. Click the button, complete the Google consent screen, and the line must turn to "Verbonden" on its own, with the button gone and the banner closed.

Afterwards:

```bash
mv "$APPDATA/gmail-desktop/google-tokens.json.bak" "$APPDATA/gmail-desktop/google-tokens.json"
```

(If the consent flow re-linked the account, the backup is no longer needed — delete it instead.)

- [ ] **Step 7: Commit**

```bash
git add renderer/app/settings/AccountOAuthRow.tsx renderer/app/settings/AccountsSection.tsx
git commit -m "feat: show each account's OAuth status, with a button to fix it

The link state was only ever reported by a banner, and only once it was already
broken. It now sits in the account's own card, with a button only for the states
that need one and wording that matches what each of them actually asks for."
```

---

## Notes for the reviewer

- **Task 1 is where the value is.** The four states are visible in the UI, but the change that prevents a class of bug is `accountsNeedingReconnect` becoming a projection. If you review one task closely, review that one, and specifically the 32-case derivation test.
- **`push-only` is the state most likely to be got wrong later.** It means the link works and only notifications are down. Anything that treats it as "not connected" is a regression, however it is worded.
- **What this plan deliberately leaves alone:** the reconnect banner page (`renderer/app/reconnect/page.tsx`) has its Dutch hardcoded rather than going through `strings.ts`. It is not touched here. The new row does not copy the pattern.
