# Notifications come from the page, the API answers the click

Date: 2026-08-12

## Why

A notification clicked in the stack opened the wrong conversation, or none.

The first thing the diagnosis turned up is that the relay was not involved, and never had
been on this machine. `pushConfig()` reads `relayUrl` and `pushTopic` out of the OAuth
config file (`main.ts:1422`), that file holds neither, and the environment variables are
empty — so `parsePushConfig` returns null and `startPush()` returned on its second line.
`notify.log` says the same from the other side: every mail line in it is `[notify] raise
web …`, the browser catch, and every policy line ends in `push=false`.

So both halves of the picture were wrong. The relay was not delivering notifications, and
turning it off would have changed nothing. And the click bug lives in the path that *was*
delivering them, where it has a cause of its own: Gmail's notification carries no thread
id — `tag` is the account address, `data` is null, established with live CDP
instrumentation in July — so `preload.ts` matched the subject against the rows the view
happened to be rendering and took the first hit. That is a guess twice over. A view
showing an open conversation renders no list, so nothing matches and the click settles for
the account. Two mails sharing a subject are indistinguishable, so the top row wins
whether or not it is the one that was clicked.

Gmail's own click handler is not an alternative: it was A/B tested live in July and does
nothing at all — no navigation, no focus, no `window.open`, even with user activation.

## Decisions

**1. The page raises the notifications; that is now the arrangement rather than the
accident.**

`RELAY_PUSH_ENABLED` is a single constant, `false`, and it holds the two halves of the
relay together: `startRelayPush()` is not called, and the sync's `notifyNewMail` loop is
not run. Everything else about the relay — the manager, the transport, the coverage, the
config parser and their tests — stays exactly where it is. The switch is written this way
because the two paths are mutually exclusive and must be turned over together: push
coverage is what mutes a view (`notification-policy.ts:47`), so an account the relay
delivers for is an account whose page stops notifying. One constant flips both.

**2. The click asks the Gmail API which mail it was.**

`openNotifiedThread` replaces the straight hand-back to the page. Three answers, in
descending order of how sure each one is:

1. The API. A handful of the newest inbox messages (`fetchRecentInboxIds`, eight), their
   sender and subject, matched against the text the notification drew. An exact thread id.
2. The source view, as before — the subject matched against whatever rows it renders.
3. The account, when there is neither.

Only a click pays for this, never an arrival, so mail nobody opens costs no requests. The
lookup runs under a 2.5 second deadline and a failure is not an error: it drops through to
the answer that used to be the only one.

Delegated mailboxes have no token of their own and fall out at the first line, which is
right — for those the page's DOM has always been the whole lookup.

**3. The matching rule is pure, tested, and identical to the page's.**

`electron/notify-match.ts` holds `subjectMatches` and `pickNotifiedMessage`. The rule is
the one `matchThreadsBySubject` already applied — exact, or a prefix when Gmail cut the
subject short and ended it in an ellipsis — kept deliberately identical, because the two
lookups are each other's fallback and a click that changed its mind about which mail it
meant depending on which one answered would be worse than either.

Whitespace is folded, since a subject that wrapped in the header arrives on one line.
Where several messages match, the sender decides; where that decides nothing either, the
newest wins, a notification being about mail that just arrived. A notification with an
empty subject pairs with mail that has no subject and with nothing else — matching
everything would hand back the newest mail in the inbox regardless of what was clicked.

**4. The API side keeps running, on its own trigger.**

Without the relay nothing called the sync, and the sync is what copies a verification code
and what keeps the history cursor moving. It now runs on the signal the relay used to
carry: every notification the page raises kicks off a sync for that account, and a
five-minute timer underneath catches the mail that notified nobody — quiet hours, an
account with notifications off, a category Gmail keeps to itself.

`apiSyncSince` is a second map beside `PushCoverage`, holding the moment the sync started
watching each mailbox, so that mail already in the inbox stays out of it. Kept apart from
coverage on purpose: coverage means "the relay delivers for this account", and writing
into it would tell every mail view to go quiet on behalf of a sync that raises no
notifications at all.

**5. The unread count stays with the page title.**

`reportApiUnread` is still gated on coverage, so with the relay off the API's count is
discarded and `parseUnreadCount` on the page title owns the badge, as it did. This is not
an omission: the title is Gmail's own count and it is instant, where a polled count would
trail a read mail by up to five minutes.

**6. The pop-out waits for the page, not for the hash it wrote itself.**

The first click after all of the above found the right mail and still opened the wrong one,
and the log is the whole story:

```
[notify] click 3:ax91fu53-2: the api says thread=19ff4adbbe6bd372
[notify] activate u0 surface=mail thread=19ff4adbbe6bd372 subject="sdfsdfsdfsdf" mode=window
[notify] u0 pop-out clicked=true window=true      <- 81 ms later
```

Eighty-one milliseconds is not enough for Gmail to fetch and render a conversation, and it
did not: the window that opened held a mail from two days earlier. With
`notificationOpen: 'window'` the click goes through `popOutThread`, which sets the mail
view's hash to the thread and then clicks Gmail's own pop-out button. Its guard against
clicking too early was `location.hash !== wantedHash` — and the app writes that hash
itself, so it reads back as the target the instant it is set, while the previous
conversation is still on screen with its own pop-out button under the same selector. The
guard tested the app's own intention rather than Gmail's state, so it always passed.

The title is what actually changes when Gmail arrives, so that is what is asked now.
`clickPopoutButton` probes the view — hash, title, is the button there — decides in
TypeScript rather than inside a string in Google's page, and clicks only once
`titleShowsSubject` says the conversation on screen is the one the notification was about.
The subject travels down from `activateNotification` for it. When no subject is known the
weaker test is used: the title has to have changed from what it was before the navigation.

Failing to be sure is not failing. The button is left alone, `popOutThread` returns false,
and the caller opens `openFullThreadWindow` on the thread id — a plainer window on the
right mail, which beats Gmail's own on the wrong one. The last probe is logged on the way
out, so the next surprise arrives with its title attached.

That log line paid for itself immediately. The hash check was left in beside the title one,
on the grounds that it cost nothing, and the next click gave up with this:

```
pop-out gave up, last seen {"hash":"#inbox/FMfcgzQhVrDqdSFCTfmJlfHgxhKCQwXv",
                            "title":"sdfsdfsdf - luca.manuel@… - Mail van Abovomaxlead",
                            "hasButton":true}
```

The title was right; the hash was not the one we wrote. Gmail replaces the legacy id it is
navigated with by its own permalink id once it arrives, so `#inbox/19ff4d23f66d4d3c` becomes
`#inbox/FMfcgz…`. The hash is therefore useless in both directions — equal to the target
while the page has not moved, and never equal to it once the page has — and it now decides
nothing. It is still read and still logged, because a value that has been wrong twice in
opposite ways is worth keeping in view.

## Tests

`tests/notify-match.test.ts` — exact and ellipsised subjects, both kinds of ellipsis, a
longer subject that was never cut, folded whitespace, a bare ellipsis matching nothing, the
subjectless pairing, the sender as tiebreak, the newest as tiebreak after that, and the
display name rather than the address Gmail never shows.

`tests/notify-match.test.ts` also covers `titleShowsSubject`: the conversation Gmail says it
is showing, the inbox where none is open, the one that was open before, a reply whose "Re:"
the title does not carry, a subject cut short, and "Kennissessies" against a title reading
"Kennissessies september" — the bare-prefix trap.

`tests/popout-thread.test.ts` and `tests/notify-delivery.test.ts` gain the case that was
missing: the button is present and the hash is right from the first try, and the click must
still wait. The fake in `notify-delivery` held the hash back along with the conversation, as
if the two moved together, which is why it passed while the app shipped the bug; it now
lands the hash at once and lets the title follow.

The relay's own tests are untouched, which is the point of leaving its code alone.

## Out of scope

Archive and Mark read on a card from the page: those need a message id at the moment the
card is raised, and this resolves one at the moment it is clicked. Bringing them back means
enriching the card from the sync that the notification now triggers — a later change, and
one that only pays off if the click fix proves out first.
