# Emptying a label from settings

## The problem

Once a label has been copied into another mailbox, nothing can clear the original. Gmail's own
interface selects a page at a time, so a label of 2,719 conversations is twenty-eight passes of
"select all on this page, delete" — and the mailbox owner reported exactly that: *"per 100
verwijderen kan soms te lang duren"*.

The API makes it trivial. `messages.batchModify` takes **1,000 ids in one call for 50 quota
units**, so 2,719 messages is three calls and about 200 units including the listing. What is
missing is not capability but a place to ask for it.

This is the first of two pieces. This one is the **deliberate** tool: you name a mailbox and a
label, and it empties it, taking your word that you want that. The second piece, designed
separately, is the **safe** one: after a copy, clear only what the app can prove it put somewhere
else. They share a core and differ in what proof they demand. This spec covers the deliberate
tool only.

## What this changes about the app, and why that deserves saying

Until now this app could add mail and undo its own inserts. Every destructive path it has acts on
messages it created itself, found by a marker label it applied in the same call that created them
(`copy-run-types.ts`). Nothing in it has ever removed mail it did not make.

This does. It removes mail from the mailbox holding the originals, on the user's word alone. That
is a new class of power and the design is shaped around not firing it by accident, rather than
around convenience.

## What must not change

- **Nothing is ever permanently deleted.** `messages.batchModify` adding `TRASH` is the only
  removal this feature performs. Gmail keeps trashed mail for 30 days, so every action here is
  reversible by the user without this app's help. `messages.batchDelete` must not appear in this
  feature at any point, under any flag.
- **Labels survive.** Removing messages never removes a label. The mailbox owner asked for this
  explicitly: the label structure is what they keep.
- **System labels are not reachable.** `userLabelMap` (`gmail-api.ts:453`) already keeps only
  `type === 'user'` and drops this app's own marker labels. Building on it means "empty my inbox"
  is not an option the UI can offer, not merely one it declines.
- **Never automatic.** No setting, no post-copy prompt and no future convenience may make this
  run without someone choosing it in that moment. The mailbox owner's words: *"het moet wel een
  optie zijn geen verplichting"*.
- **One mailbox at a time.** Nobody needs to empty a label in three mailboxes at once, and
  offering it multiplies what one mistake costs.

## Design

### Where it lives

A new settings section, `label-cleanup`, in `SETTINGS_GROUPS`'s second group and directly after `advanced` (`renderer/app/settings/nav.ts:48`). Its own section rather than a group inside `AdvancedSection`,
for one reason: a button that trashes 2,719 messages must not sit on the same scroll as the
hardware-acceleration switch. A stray click has to be a stray click on the wrong *page*, not on
the wrong row.

The section asks for two things in order. First a mailbox, from what the app can already reach —
`labelsForCopyTargets` (`mail-drop-controller.ts:1248`) enumerates the accounts and delegated
mailboxes together with their labels, which is exactly the list this needs and already exists.
Then a label from that mailbox's user labels.

### The two-step contract

Two IPC calls, and the destructive one cannot be reached without the first.

**Count.** Given a mailbox and a label name, resolve the label and every label whose name begins
with `<label>/`, list the message ids under each, and answer with a count per label plus a
**handle**. The main process holds the ids behind that handle.

**Purge.** Takes the handle and the subset of labels the user left ticked. It acts on the ids it
already holds and asks Gmail nothing new about what is under the label.

The handle is the whole point. It makes "what goes" identical to "what you were shown", rather
than to "what is under the label at the moment you click". Mail arriving between the count and
the click stays. And an unknown or superseded handle is refused rather than re-derived, so a
stale settings window cannot act on a listing nobody looked at. One handle at a time: counting
again replaces it.

### What it acts on

The label and its sublabels, each with its own count and its own checkbox, all ticked by default.

This is not decoration. Gmail's nesting is a naming convention and not containment — `test` and
`test/test123` are two flat labels that happen to share a prefix, which is why `labelTreeMembers`
exists at all. A tool that silently included sublabels would delete more than its heading said; a
tool that silently excluded them would leave 99 messages behind and call the label empty. Showing
`test 2620` and `test/test123 99` as two ticked lines is the only version that cannot mislead.

The listing is bounded. `PURGE_LIST_MAX = 50_000` ids across the whole tree; past that the count
answers with what it has and says it was capped, the way every other cap in this app reports
itself. Fifty thousand is far past any real label and exists so a runaway page loop cannot
allocate without end.

### How it removes

`batchModifyMessages(token, ids, { addLabelIds: ['TRASH'] })` in chunks of `BATCH_MODIFY_LIMIT`
(1,000, Gmail's own limit). For 2,719 messages: seven list pages at 5 units and three modify calls
at 50, about 200 units in total. That is under a second of the pacing budget, so this feature
needs no progress bar and no concurrency of its own — a spinner and a result.

Chunks are sent one after another, not alongside each other. There is nothing to win: three calls
are three calls, and serial means the failure report below can say exactly how far it got.

### When it fails

Per chunk, and reported per chunk. If the second of three is refused, the first 1,000 are in the
trash and the third was never sent; the result says so in those terms — how many were trashed, how
many were not, and Gmail's own message for the refusal. No all-or-nothing wording, because Gmail
cannot give all-or-nothing and pretending otherwise would leave the user unsure which half to
check.

A mailbox whose token cannot be had fails before anything is sent, which is the one genuinely
clean failure available.

### What the user sees

Dutch, matching every other string in the settings panel, added to `renderer/app/strings.ts`.

The confirming button carries the number: *"Verplaats 2.719 berichten naar de prullenbak"*. The
count in the button is the guard — the same pattern the mail-drop stop dialog already uses, where
the consequence is written on the control rather than behind a second dialog. Beneath it, the
note that dialog also carries: trashed mail is recoverable from Gmail for 30 days.

No type-the-label-name confirmation. It is a personal tool in a settings panel behind a mailbox
choice, a label choice and a count; a fourth gate would train the user to click through gates
rather than read them.

## Tests

Unit, in the existing vitest suite, over a new `electron/mail/label-purge.ts`:

- **Tree resolution** — a label and its sublabels are found; a label whose name merely *contains*
  the name is not (`test` must not match `latest`); a label with no sublabels answers just
  itself; a name that is not in the map answers nothing.
- **Chunking** — an exact multiple, a short last chunk, a single id, and nothing at all.
- **The handle** — a counted set can be purged once; an unknown handle is refused; counting again
  replaces the previous handle and the old one is then refused. This is the safety property, so
  it gets the most cases.
- **The cap** — a listing past `PURGE_LIST_MAX` reports that it was capped rather than truncating
  in silence.
- **Ticked subset** — purging with a subset acts on that subset's ids only, and never on ids
  belonging to a label the user unticked.

What tests cannot reach: the IPC pair, the settings section, and Gmail itself. The gate for those
is one real run against `test` in `luca.manuel@abovomaxlead.nl`, which is also the cleanup the
mailbox owner is waiting on — 2,620 under `test` and 99 under `test/test123`, both already copied
into `support@`.

## Implementation order

`label-purge.ts` first and alone: the tree resolution, the chunking, the handle bookkeeping and
the cap are the whole of the logic worth testing, and none of it needs Electron or a network.

Then the two IPC calls and the token path, then the settings section. The section last means every
question about what the feature *does* is settled before anything renders it.
