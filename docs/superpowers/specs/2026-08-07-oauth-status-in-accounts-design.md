# Design: OAuth connection status in the accounts list

**Date:** 2026-08-07
**Status:** Approved design (ready for an implementation plan)

## Goal

Show, per account in Settings → Accounts, whether its Gmail connection is actually
working, and offer the button that fixes it when it is not.

Today that information exists in exactly one place: a banner in the bottom-right corner
that only appears when something is already broken. There is no way to ask "is this
account linked?" — you find out when notifications stop or moving mail fails. The
accounts list is where every other fact about an account lives, so it is where this
belongs too.

## What the user sees

Four states, one per own account:

| State       | Label (nl)              | Button              | Meaning |
|-------------|-------------------------|---------------------|---------|
| `linked`    | Verbonden               | none                | Token present and refreshable; push scopes present when push is configured |
| `unlinked`  | Nog niet verbonden      | Verbinden           | No token was ever stored for this account |
| `expired`   | Verbinding verlopen     | Opnieuw verbinden   | Token present but the refresh failed — moving mail no longer works |
| `push-only` | Meldingen staan stil    | Opnieuw toestaan    | Token works, but the push scopes are missing or push was refused — only notifications and the unread counter are affected |

A button appears only when something is wrong. A healthy account gets the label and
nothing else, so the button is a signal rather than furniture.

`unlinked` and `expired` are kept apart deliberately. The banner already conflates them,
which is fine for a warning, but in a list the difference is the question being asked:
whether anything was ever connected, or whether something that worked has stopped.

The three broken states get three different button words because they ask for three
different things. "Opnieuw verbinden" on an account that was never linked is a lie, and
"Opnieuw toestaan" is what the push case actually needs — consent for a scope, not a new
link.

Layout inside the account card: the status line goes under the email address, above the
colour swatches. The button, when present, sits under the status line. Neither pushes the
existing controls around, and a card that is healthy grows by one line of text.

## Where the status comes from

`electron/oauth-health.ts` gains one pure function:

```ts
export type OAuthStatus = 'linked' | 'unlinked' | 'expired' | 'push-only';

export interface AccountOAuthStatus {
  email: string;
  status: OAuthStatus;
}

export function accountOAuthStatuses(input: HealthInput): AccountOAuthStatus[];
```

It takes the `HealthInput` that already exists and returns one entry per own account.

**`accountsNeedingReconnect` is then derived from it** rather than computing the same
thing a second time: drop the `linked` entries, map `unlinked` and `expired` to the
banner's `expired` reason, and `push-only` to its `push` reason.

This is the load-bearing decision in this design. Two functions reading the same inputs
to answer overlapping questions is how a banner and a list end up disagreeing about the
same account, and that disagreement is invisible until someone reports it. Deriving one
from the other makes it impossible.

The banner keeps its existing two reasons and therefore its existing text and tests. The
fourth state exists only on the settings side.

Status precedence, unchanged from what `accountsNeedingReconnect` does today:

1. no token → `unlinked`
2. refresh failed → `expired`
3. push configured **and** (scopes missing **or** push refused) → `push-only`
4. otherwise → `linked`

Push reasons still count only when push is actually configured, for the reason already
documented in that file: every pre-existing token predates the push scope and would
otherwise flag every machine after an update.

## How it reaches the settings panel

A new IPC pair, alongside the existing reconnect channels:

- `OAUTH_STATUS_GET` (`'oauth:status-get'`) — `ipcMain.handle`, for a panel that has just
  opened
- `OAUTH_STATUS_CHANGED` (`'oauth:status-changed'`) — main → renderer, sent from
  `checkOAuthHealth` after every check

Payload: `{ accounts: AccountOAuthStatus[] }`.

Both, not one, for the same reason the reconnect page does both: main may have sent the
list before the panel existed.

**One rule covers every edge: an account with no entry in the list gets no status line.**
That is exactly the right answer for all three cases where there is nothing to say —
a delegated mailbox (no own OAuth), OAuth not configured at all (`checkOAuthHealth`
returns early, so nothing is ever pushed), and the window between startup and the first
health check. No `configured` flag is needed to tell them apart, because the panel does
the same thing in all three.

Main keeps the last computed list in a module-level variable declared next to
`reconnectAccounts`. It is computed, stored and pushed inside `checkOAuthHealth`, from the
same `HealthInput` that already feeds the banner, immediately before `showReconnectBanner`
is called — so the list the panel sees and the banner on screen always come from one pass
over one set of inputs.

On the renderer side the bridge gains two methods, following the reconnect pair it sits
beside: `getOAuthStatus(): Promise<{ accounts: AccountOAuthStatus[] }>` and
`onOAuthStatus(cb)`.

**Not a field on `Profile`.** `pushProfiles()` already calls `scheduleOAuthHealthCheck()`,
so pushing profiles from the health check would close a loop. The two also change on
different clocks: profiles when accounts are added, renamed or reordered, status on a
five-minute timer and after each reconnect.

## What the button does

Nothing new in main. `reconnectOAuth(email)` already exists on the bridge and already
does the whole job: it opens the consent flow in a view on the Gmail session partition,
clears the refresh-failure and push-refusal flags, re-runs the health check and restarts
push, and returns `{ ok, error }`.

The settings row calls it, shows a busy label while it is in flight, and shows the error
under the status line when it comes back false — the same three states the banner already
handles. Because `reconnectOAuth` re-runs the health check, the new status arrives over
`OAUTH_STATUS_CHANGED` by itself; the row does not have to update anything optimistically.

## Component boundary

The status line, the button, and their busy/error state go in their own component
(`renderer/app/settings/AccountOAuthRow.tsx`), not inline in `AccountsSection`.

`AccountsSection` is already ~330 lines and owns four unrelated concerns (naming,
ordering by drag, colour, removal). Adding a fifth with its own async state and error
display inline would make the file harder to read for the sake of one card row. The new
component takes an email and a status and owns only the reconnect call.

## Strings

All new text goes through `renderer/app/strings.ts`, in all three sets. The existing
set-equality test then covers the new keys with no extra work.

| Key             | `STRINGS_NORMAL` (en)  | `STRINGS_RENE` (nl, plain) | `STRINGS_NL` (nl) |
|-----------------|------------------------|----------------------------|-------------------|
| `oauthLinked`   | Connected              | Alles in orde              | Verbonden |
| `oauthUnlinked` | Not connected yet      | Nog niet aangezet          | Nog niet verbonden |
| `oauthExpired`  | Connection expired     | De verbinding is weg       | Verbinding verlopen |
| `oauthPushOnly` | Notifications are off  | Je krijgt geen meldingen   | Meldingen staan stil |
| `oauthConnect`  | Connect                | Aanzetten                  | Verbinden |
| `oauthReconnect`| Reconnect              | Opnieuw aanzetten          | Opnieuw verbinden |
| `oauthReallow`  | Allow again            | Meldingen aanzetten        | Opnieuw toestaan |
| `oauthBusy`     | Working…               | Momentje…                  | Bezig… |
| `oauthFailed`   | Did not work           | Het lukte niet             | Mislukt |

`oauthFailed` is the fallback for a failure that came back without a message, so the row
never shows an empty error.

The reconnect banner page has its Dutch hardcoded (`'Verbind'`, `'Bezig…'`, `'Mislukt'`).
That is left alone — it is not what this change is about — but the new row does not copy
the pattern.

## Testing

- `tests/oauth-health.test.ts`: a table of inputs to `accountOAuthStatuses` covering all
  four states, the precedence between them, and that push reasons are ignored when push
  is not configured.
- The same file: a test that `accountsNeedingReconnect` cannot drift from
  `accountOAuthStatuses` — for a set of inputs, the reconnect list must equal the
  derivation from the statuses. This is the test that protects the load-bearing decision.
- `tests/strings-sets.test.ts`: already enforces that the nine new keys exist in all three
  sets. No change needed.
- The card itself is not unit-testable here (every test in this repo is a pure module), so
  it is checked by hand in a build.

## Out of scope

- Translating the reconnect banner page's hardcoded Dutch.
- Any change to the banner's wording, placement or behaviour.
- Linking a delegated mailbox. Delegated mailboxes have no OAuth of their own and are
  reached through the account that delegates them.
- Automatically re-linking anything. Every connection attempt stays a deliberate click,
  because it opens a Google consent screen.
