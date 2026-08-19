# Copying several mails at once

## The problem

Dragging ten mails out of Gmail and copying them into another mailbox takes minutes. Both
legs of that trip run one mail at a time.

Leg one, the drag to disk, is a `for … await` over the dragged rows in
`handleMailDrop`, and inside each row `collectThreadMessages` walks the messages of the
conversation the same way. Ten rows out of three-message conversations are about forty
requests strictly in sequence, and the `.eml` files are written synchronously on the main
thread afterwards, to a redirected network share.

Leg two, the copy into another mailbox, is a `for` over the target mailboxes with a second
`for` over the files inside it. Every `messages.insert` waits for the one before it, and
each file is read from the share again for every mailbox.

## What must not change

Which mail is saved, which labels it lands under, the folder and file names, the numbering,
the order of the lines in `log.jsonl`, and what the preview strip shows. This work changes
when things happen, never what happens.

That rules out two ideas that came up while measuring:

- **Fetching fewer messages per conversation.** A label drag fetches every message of a
  conversation and keeps only the newest, so three quarters of the traffic is thrown away.
  Choosing from metadata first would cut it, but it also changes which mail is saved when
  the newest one cannot be fetched. Out of scope.
- **One search per mailbox instead of one per message.** `rfc822msgid:a OR rfc822msgid:b`
  would answer the duplicate scan in a single request. If Gmail reads that query
  differently than expected it finds nothing, which is indistinguishable from "the mailbox
  does not have these mails" — the common case — and the app would silently copy a
  duplicate. Out of scope.

## Design

### Retries first

Everything below raises the number of requests in flight, which is what makes Gmail answer
429. Today `requestJson` has no retry: a refused request becomes an error line in
`log.jsonl` and that mail is quietly missing from the copy.

A new `electron/gmail/retry.ts` holds the decision as pure functions, in the style the rest
of the file already uses for testability:

- `retryAfterMs(header, now)` reads `Retry-After` as seconds or as an HTTP date.
- `retryWaitMs({ method, attempt, status, timedOut, retryAfter })` returns the wait in
  milliseconds, or `null` for "do not retry".
- `withRetry(run, opts, sleep)` runs the attempts. `sleep` is injected so a test does not
  wait.

The policy differs per method, and the difference is the whole point:

| | 429 | 5xx | time-out or network error |
|---|---|---|---|
| GET | retry | retry | retry once |
| POST (`messages.insert`) | retry | no | **never** |

A `messages.insert` that timed out may well have landed. Retrying it puts the mail in the
mailbox twice, which is worse than the error it is trying to paper over. A 429 is safe
because Gmail refused the upload outright.

Three attempts at most, 500 ms then 1500 ms with jitter, `Retry-After` honoured up to 30
seconds. `GmailHttpError` gains the header so the loop can read it.

### Leg one: the drag to disk

`collectThreadMessages` takes a concurrency limit and runs its reads through `mapLimit`.
`mapLimit` returns results in input order, so the messages of a conversation keep the order
Gmail handed them in, errors included — the property its existing test pins down.

`handleMailDrop` runs the dragged rows through `mapLimit` as well, then walks the ordered
results to fill `done`, `saved` and `lastDropSaved` exactly as the loop did.

Concurrency is bounded by the product of the two limits, because they nest: four rows times
three messages is twelve requests in flight. `messages.get` costs 5 quota units against a
ceiling of 250 per second per user, so the ceiling is 50 requests per second; twelve in
flight at a realistic round trip stays well under it.

The page route (`fetchThreadEmls`, for mailboxes without a token) stays sequential. It talks
to Gmail's web interface on session cookies, where there is no documented quota to stay
under and a burst of parallel requests risks tripping abuse detection.

### Leg one: writing

`writeThread` and `writeLabel` become async and write through `fs.promises`, four at a time,
so a write no longer blocks the main thread while other messages are still arriving.

The folder name needs more than an await. `uniqueDir` looks whether a folder exists and then
creates it; two mails landing in parallel with the same sender, subject and second choose
the same name between the look and the create, and two conversations end up in one folder.
It becomes a `mkdir` without `recursive`, walking `-2`, `-3` … on `EEXIST`. The create is
the claim, so there is no window to lose.

### Leg two: the copy

Target mailboxes stay sequential. The progress bar names the mailbox it is working on, and
that stays true only with one at a time; the mails are where the waiting is.

Within a mailbox the files are grouped by source thread and the groups run through
`mapLimit`, four at a time, sequentially inside a group. The group is the real dependency:
the first insert of a conversation returns the `threadId` the rest of that conversation is
attached to, and without it a copied conversation arrives as loose mails. A label drag saves
one mail per conversation, so in practice every group is one mail and everything runs
alongside everything else.

Each worker reads its own file and lets the buffer go after the insert, which keeps peak
memory at four mails instead of all of them — a label drag of two hundred mails with
attachments would not fit otherwise. That means a file is still read once per target
mailbox; a local read is nothing against an upload, and the alternative was either all
files in memory at once or a progress bar that jumps between mailboxes.

Two things need care under parallelism:

- **The token refresh on 401.** Several workers can hit 401 at the same moment and each
  start a `forceRefresh`. The refresh is deduplicated behind one in-flight promise per
  mailbox, so the second worker waits for the first refresh instead of starting another.
- **The order of the log lines.** Records are collected per file index and assembled
  afterwards, so `log.jsonl` reads the same as when the inserts ran in a row.

### The duplicate scan

`existingForCopyTargets` runs when the picker opens and asks, per mailbox per mail, which
labels already hold it. `findDuplicates` then runs when Kopieer is pressed and asks, per
mailbox per **label** per mail, whether that label holds it. The second question is already
answered by the first: a label holds the mail exactly when it is in the set the first scan
returned.

The picker scan keeps its answer per mailbox and message id, keyed on the drag serial.
`findDuplicates` uses it when the stored scan covers every mailbox and every message of the
copy, and only asks Gmail for what is missing. The common case costs no requests at all.

One detail makes the reuse exact rather than nearly exact. The picker scan takes the first
search hit and reads its labels; the per-label check asks whether *any* message with that
`Message-ID` carries the label. A mailbox holding the same `Message-ID` twice would answer
those two questions differently, so the picker scan unions the labels of every hit instead
of only the first. That is one extra request only when a mailbox really has the mail more
than once.

## Numbers

Ten dragged mails from three-message conversations, copied into one mailbox:

| | now | after |
|---|---|---|
| fetching | ~40 requests in sequence | ~40 requests, 12 in flight |
| writing | synchronous, blocks the main thread | 4 in flight, off the critical path |
| scan at Kopieer | ~20 requests | 0 |
| inserting | 10 in sequence | 10, 4 in flight |

The floor is Gmail's own: there is no server-side copy between accounts, so the bytes go up
once per target mailbox. Parallelism hides latency, not bandwidth. The quota ceilings are
50 `messages.get` and 10 `messages.insert` per second per user, both far above what one drag
needs.

## Implementation order

1. `retry.ts` plus `requestJson` wired through it, with `tests/gmail-retry.test.ts`.
2. `collectThreadMessages` and `handleMailDrop` through `mapLimit`.
3. `writeThread` and `writeLabel` async, with the `EEXIST` folder claim.
4. `copyToMailboxes`: groups through `mapLimit`, deduplicated refresh, records by index.
5. The picker scan kept and reused by `findDuplicates`.

Each step keeps the existing tests in `tests/gmail-api.test.ts`, `tests/mail-archive.test.ts`,
`tests/mail-copy.test.ts` and `tests/concurrency.test.ts` green, and adds tests for the
concurrency, the folder claim, the retry policy and the reused scan.

## Measured afterwards: the next step is fewer fetches, not more parallelism

Read from `%APPDATA%/gmail-desktop/notify.log` on 2026-08-19, 16:21:29 → 16:22:16:

```
[drag] 100 rij(en) vanaf thread=1928f1f2d092278b
17ed30a1e22a128a: 22 berichten, alleen het gesleepte bewaard    (22 rows, one per row)
```

A drag of a hundred rows covered about sixteen distinct conversations, and `saveOneThread`
fetches the whole conversation for each row it is given. The thread of 22 messages was dragged
as 22 rows and cost 22 × 22 = 484 `messages.get` calls to save 22 mails. Over the drag that is
roughly 742 fetches where 79 would do, and it is what the 47 seconds were spent on.

The quota was never the limit: about 16 requests a second against a ceiling of 50, some 80 of
the 250 units a second, and not one 429 in the log. Turning the concurrency up would not have
helped.

The fix is a cache per drag: memoise `threadMessagesViaApi(account, threadId)` in a
`Map<string, Promise<ApiThreadResult>>` created in `handleMailDrop`, so rows of one conversation
await the same fetch. Behaviour is unchanged — every row still picks its own message with
`draggedMessage(all, ref)` on `legacyId` — and caching the parsed messages as well takes 484
redundant `parseHeaders` calls off the main thread. Only the API route can be shared this way;
the page route keys on the row's own `permMsgId`.
