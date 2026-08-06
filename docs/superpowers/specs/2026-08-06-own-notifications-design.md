# Own notifications: a stack we control

Date: 2026-08-06

## Why

Every notification in the app is an Electron `Notification`, which on Windows is a
system toast. Five of them exist: new mail from the API push (`main.ts:1515`), a failed
account link (`main.ts:590`), an available update (`main.ts:1867`), the test
notification (`main.ts:2020`), and a finished download (`main.ts:2174`). Gmail's own
page notifications are a sixth path — `preload.ts:326` wraps `window.Notification` and
`rerouteServiceWorkerNotifications` funnels the service worker into that same wrapper.

Two things are wrong with the system toast and neither can be fixed from our side:

**They do not stack.** Windows shows one toast at a time and files the rest into the
Action Center. Ten mails arriving together means one visible toast and nine that were
technically delivered.

**Persist does not persist.** The per-account "notification stays" switch sets
`timeoutType: 'never'` (`main.ts:1519`) and `requireInteraction: true`
(`preload.ts:112`). Windows honours neither for a normal app toast — it dismisses after
its own interval regardless. The setting is a switch that does nothing.

Owning the window solves both, and buys a third thing the system toast cannot do at all:
buttons on the card.

## Decisions

**1. One window for the whole stack, not one per toast.**

A single frameless, transparent, always-on-top `BrowserWindow` anchored bottom-right,
sized to the stack it contains. Stacking, reordering and animation are then CSS inside
one document instead of five windows main has to keep in formation pixel by pixel.

Two properties matter more than the rest:

- `focusable: false` — a toast must never take focus from whatever you are typing in.
  Windows still delivers mouse input to a non-focusable window, so clicks and hover
  work; only the keyboard is out, which the card does not need.
- `setIgnoreMouseEvents(true, { forward: true })`, turned off by the page while the
  pointer is over a card. Without it the transparent gaps between the cards swallow
  clicks meant for the desktop behind them.

Both follow the pattern `compose-account-window.ts` already established: frameless and
transparent because the page paints its own card, `show: false` until the first paint to
avoid a white flash, zoom factor applied before load and again on `did-finish-load`, and
the page reports its own measured height so main can size the window to it.

**2. Pure logic in its own modules, Electron only where it must be.**

| File | Role |
| --- | --- |
| `renderer/lib/toast.ts` | Types shared by main and the page, as `lib/compose-account.ts` does |
| `electron/toast-model.ts` | **Pure**: the stack reducer — add, dismiss, dismiss all, expire, the collapse rule |
| `electron/toast-layout.ts` | **Pure**: bottom-right anchoring inside a work area, zoom, clamping |
| `electron/toast-window.ts` | The window: create, load, size, position, hide when empty |
| `electron/toast-controller.ts` | Holds the state, pushes it to the window, routes clicks back to main |
| `renderer/app/toasts/page.tsx` | The cards — a static export route, so `toasts.html` |

The split exists so the two parts worth testing can be tested without Electron. The
reducer decides what the stack contains; the layout decides where it goes. Neither needs
a display.

**3. The policy layer does not change.**

`notification-policy.ts` is untouched. Every call site keeps its existing gates —
`notificationsAllowed`, `hiddenNotificationText`, `notificationSilent` and the sound —
and only the last step changes from `new Notification({...}).show()` to
`toasts.show({...})`. A click still lands in `activateNotification(accountKey, surface,
threadId)`, so window mode, thread opening and settings-panel closing behave exactly as
they do now.

`Notification.isSupported()` guards and the `timeoutType` / `requireInteraction`
plumbing go away with the toasts they guarded.

**4. Five cards, then one number.**

The stack holds at most five cards, newest at the bottom, growing upward from the
bottom-right corner. A sixth arrival removes all five and leaves a single summary card
reading "6 new notifications", which counts up for as long as they keep coming.

All kinds share the one stack and count toward the five: a download finishing while
four mails are up is the fifth card. The summary counts whatever it replaced, so its
wording is the generic "new notifications" rather than anything mail-specific, and it
always stays until dismissed regardless of any account's setting.

Dismissing the summary empties the stack. Clicking it opens the app — and the account,
when every collapsed toast came from the same one.

Height is a second trigger: if the measured stack does not fit the work area (a short
screen, or Rene zoom doubling everything), it collapses before reaching five.

**5. Staying is the default; the per-account switch turns it off.**

A toast stays until it is dismissed — by clicking the card, its close box, or the
**Dismiss all** control that appears above the stack once two or more are up. Nothing
expires on a timer and nothing is cleared by opening the app.

`AccountPref.notifyPersist` survives but its default inverts to on, read as
`!== false`. Off now means the opposite of what it meant: that account's mail toasts
fade after 6 seconds, with hover pausing the countdown. The label and description in
the Notifications section are rewritten to match, since the switch now reads as an
exception rather than an upgrade.

This is a visible behaviour change on upgrade — an existing prefs file has no
`notifyPersist`, so every account moves from "disappears" to "stays". That is the
point of the feature, so no migration writes the old default back.

Downloads, updates, account errors and the test toast always stay.

**6. The card.**

380 CSS pixels wide, the account's colour as a left edge and the avatar beside it, the
same identity markers the account picker uses. At rest: sender in medium weight, subject
under it. On hover the close box appears, and with it **Archive** and **Mark read**.

Those two buttons require a `messageId` and an OAuth token, which is to say they appear
on push-sourced mail toasts and not on ones relayed from the Gmail page, whose message
id is unknown until the subject is matched in the DOM. `markMessageRead` already exists
in `gmail-api.ts`; archiving is `messageModifyUrl` with `removeLabelIds: ['INBOX']`.

Toasts with no account behind them — update, download, account error — show a status
icon in place of the avatar and carry no action buttons. The download toast keeps its
existing click action (`open-file` / `show-in-folder` / `nothing`).

Chrome text (the buttons, the summary line, Dismiss all) is localised in the page from
`getStrings(locale, reneMode)` with both carried in the state payload, the way the
compose picker avoids a prefs round trip before its first frame. Text that main already
owns — update and download titles — keeps coming from `nativeLabels` in the payload.
Dark variants are inert in these window pages, as `compose-account/page.tsx` notes, so
the card renders light.

**7. Gmail's own notifications relay through main.**

The wrapper in `preload.ts` stops constructing a real `Notification`. It sends
`WEB_NOTIFY_SHOW { id, title, body }` to main and returns the same stub object it
already returns for suppressed notifications, with a working `close()`. Main creates the
toast, and on click sends `WEB_NOTIFY_CLICK { id }` back to that webContents, where the
existing `findThreadIdBySubject` → `NOTIFICATION_ACTIVATE` path runs unchanged.

`rerouteServiceWorkerNotifications` needs no change: it goes through
`window.Notification` and inherits the new behaviour.

`notificationOptionsFor` and `notificationTitleFor` are deleted rather than adapted.
They exist to build a `NotificationOptions` for a constructor that is no longer called,
and the privacy replacement they applied moves to main, which already does exactly that
for push mail in `notifyNewMail` — one place deciding it for both paths beats two. What
replaces them is one small function that packages the id, title and raw body for the
relay.

`NotifyState` shrinks to `{ show, silent }` with it. `persist` goes because nothing
needs `requireInteraction` any more and main knows the account anyway; the hidden texts
go because main now applies them. `silent` stays — it is not about notifications at all
but about `setAudioMuted` on the view, which is how the Gmail page is stopped from
playing its own ding.

**8. Failure and edges.**

If the toast window fails to load, that notification falls back to a system
`Notification`. A bug in our own window must not mean mail arrives silently.

The window follows the display the main window is on, repositions on
`display-metrics-changed`, and hides rather than closes when the stack empties so the
next card appears without a reload.

## Tests

`tests/toast-model.test.ts` — five cards accumulate, the sixth collapses the stack to a
summary of six, further arrivals increment it, dismiss removes one, dismiss all empties,
expiry applies only to non-persist toasts.

`tests/toast-layout.test.ts` — anchoring to the bottom-right of a work area with
margins, clamping to a work area too short for the stack, the zoom factor multiplied
into the measured size.

`tests/preload-notification-options.test.ts` is deleted with the function it covers, and
a smaller file takes its place asserting what the relay packages. The service-worker
reroute test is untouched: it goes through `window.Notification` and inherits whatever
that now does.

`tests/notification-policy.test.ts` changes in one place. Its five `notificationPersist`
cases assert the old default, so inverting that default has to be written as a failing
test first — five lines that say the opposite of what they say today.

## Out of scope

No setting for the corner or the display duration. No per-platform branching — the
window is an ordinary Electron window and behaves the same on macOS and Linux. No
grouping by account or by conversation; the collapse rule counts, it does not sort.
