# Dragging a label tree into another mailbox

## The problem

Dragging a label onto the dropzone saves the mail under that label and copies it into the
labels ticked in the picker. Two things it does not do:

- **It leaves the sublabels behind.** Gmail's nesting is a naming convention, not a
  relation: `Klanten/Acme` is one flat label whose name happens to contain a slash.
  `labelFromHref` already reads it that way on purpose (`electron/mail/label-drop.ts:38`) —
  stopping at the first slash made a dragged subfolder fetch the folder above it. So a drag
  of `Klanten` collects only the mail carrying exactly `Klanten`, and everything filed one
  level down is silently not there.
- **It cannot put mail anywhere new.** The picker offers the labels a mailbox already has
  (`fetchLabels`, `electron/gmail/gmail-api.ts:292`). Nothing in the app creates a label a
  user would ever see; `createHiddenLabel` exists but is deliberately hidden and
  marker-named, for run bookkeeping only.

What this adds: dragging `Klanten` copies `Klanten` and every label under it into the target
mailbox, recreating the same shape, optionally underneath a label that is already there.

## What must not change

The flat drag. A dragged conversation, a dragged selection, and a label drag with the
structure option switched off must go on behaving exactly as they do now — the same mail,
the same labels, the same folder and file names, the same lines in `log.jsonl`, the same
preview strip. The structure copy is a second mode next to that one, never a replacement of
it.

Two more that hold in the new mode as well:

- **The marker.** Every insert keeps riding out with this run's marker label on it
  (`insertLabelIds`), so a cancel can still find back exactly what it inserted. Creating a
  destination label is never allowed to push the marker out of that first call.
- **The cap.** `MAX_THREADS` still bounds a drag, and is still reported when it bites. It
  now bounds the whole tree rather than one label, which means a tree can be truncated where
  a single label would not have been — that is what the report is for.

## Design

### The tree, as a name calculation

Everything about nesting is string work, and it belongs in one pure module,
`electron/mail/label-tree.ts`, so it can be tested without a mailbox:

```ts
labelTreeMembers(all: string[], dragged: string): string[]
```

The dragged label plus every label whose name starts with `dragged + '/'`, sorted so a
parent always precedes its children. Sorting by name does that already; the function commits
to it, because label creation depends on it.

```ts
destinationName(dragged: string, member: string, parent: string | null): string
```

The dragged label's own **leaf** name is the top of what lands. Dragging `Klanten/Acme`
copies a folder called `Acme`, not `Klanten/Acme` — the user dragged that folder, not the
one above it. So `base = dragged.split('/').pop()`, the member's path below the drag is
`member.slice(dragged.length)`, and the destination is those two joined, with `parent + '/'`
in front when a parent was chosen.

| dragged | member | parent | destination |
|---|---|---|---|
| `Klanten` | `Klanten` | — | `Klanten` |
| `Klanten` | `Klanten/Acme` | — | `Klanten/Acme` |
| `Klanten` | `Klanten/Acme/2025` | `Archief` | `Archief/Klanten/Acme/2025` |
| `Klanten/Acme` | `Klanten/Acme/2025` | `Archief` | `Archief/Acme/2025` |

```ts
planLabelTree(members, dragged, parent, existing: Map<string, string>)
  → { destinations: Map<string, string>; reuse: Map<string, string>; create: string[] }
```

Per member the destination name is looked up in what the mailbox already has. A name that is
already there is **reused, never recreated** — that is what "copy a label into an existing
label" means, and it is also what keeps the rollback safe (below). What is missing comes back
in `create`, parents first.

```ts
resolveMessageLabels(
  sourceLabels: string[],
  destinations: Map<string, string>,
  ids: Map<string, string>,
): string[]
```

The label ids one saved message goes out with, given the source labels it was found under.

### One message, possibly several labels

A Gmail thread can carry two labels of the same tree at once — it is in `Klanten` *and* in
`Klanten/Acme`. Collection therefore dedupes **per source label**, not across the tree, and a
saved message remembers a set:

```ts
interface SavedRef {
  file: string;
  messageId: string;
  subject: string;
  threadId: string;
  sourceLabels: string[];   // new; empty for a flat drag
}
```

Empty means "flat drag", and the copy falls back to the ticked labels exactly as today. When
it is filled, the message is still saved to disk once and still inserted once — with both
destination label ids on that single call, alongside the marker. Two labels are not two
copies.

This is the one real seam in the existing copy. Today a mailbox has one `labelIds` for the
whole drag (`electron/mail/mail-drop-controller.ts:1322`):

```ts
const labelIds = labelsStillNeeded(index, target.email, target.labelIds, messageId);
```

It becomes per file:

```ts
const wanted = labelsForFile(target, file);   // target.labelIds, or the resolved tree labels
const labelIds = labelsStillNeeded(index, target.email, wanted, messageId);
```

`labelsStillNeeded`, `duplicateChecks`, `newMessageCount` and the journal entry all keep
their shapes; they are handed a different array, not a different type.

### Creating the labels

Two additions to `electron/gmail/gmail-api.ts`:

- `fetchUserLabelMap(accessToken)` — one `labels.list`, returning name → id for the user's
  own labels. One request per mailbox for the whole tree, not one per label.
- `createVisibleLabel(accessToken, name)` — the sibling of `createHiddenLabel` with
  `labelListVisibility: 'labelShow'` and `messageListVisibility: 'show'`. A 409 is resolved
  by looking the name up and using that id: unlike a marker, a real label with the wanted
  name is precisely what was wanted, so there is nothing to distrust and
  `resolveConflictedMarker` does not apply.

Per mailbox, before any file goes out, in this order: the marker label first (unchanged — an
insert must never be possible without one), then `fetchUserLabelMap`, then `planLabelTree`,
then the missing labels created parents first. Only then do the inserts start.

A create that fails takes its own subtree out of the copy: the mail that would have gone
there is not inserted, and the label is named in the outcome. Guessing a nearer ancestor
would file mail somewhere the user did not ask for, which is worse than a reported gap. The
common cause is Gmail refusing a name — too long, or nested deeper than it accepts — and the
message says so.

Quota is not a consideration: `labels.create` is 5 units (`electron/gmail/quota.ts:80`), so a
forty-label tree costs less than two message inserts.

### Rollback removes what the run created

The journal gains a fourth line type next to `header`, `insert` and `deciding`, written the
moment a create answers — the same crash-safety argument that already makes `markers` a
required header field:

```ts
interface CopyJournalLabelLine {
  type: 'label';
  runId: CopyRunId;
  email: string;
  labelId: string;
  name: string;
}
```

Only labels this run **created** are written. A label that was already there and got reused
is never recorded and never touched.

On `rollback`, after the marker sweep has trashed the inserted mail, every recorded label is
deleted with `deleteLabel`. On `keep`, and on an ordinary finish, they stay.

This deletes a created label even when something else has since been filed under it. That is
a deliberate choice, made with the risk stated: a label created ninety seconds ago and then
used by hand in that window loses its name off that mail. It is bounded by only ever touching
labels this run made itself, and a rollback is always something the user asked for by name.

### The picker

For a tree drag the picker opens with a mode switch per mailbox, defaulting to structure:

- **Structuur overnemen** (on) — one control instead of the checkbox list: where the tree
  lands. Either at the top of the label list, or under a label that already exists, chosen
  from the same searchable list the ticking uses today (`filterLabels`). Below it, the tree as
  it will be created, with the mail count per label, and existing names marked as reused.
- **Off** — today's screen, unchanged: tick labels, all of the collected mail goes into them
  flat.

So the structure is an option, never an obligation, and copying a whole tree *into* an
existing label is the same control as copying it to the top.

`CopyTarget` grows one optional field, and the two modes stay legible apart:

```ts
export interface CopyTarget {
  email: string;
  labelIds: string[];                       // flat mode; empty in tree mode
  tree?: { parentLabelId: string | null };  // tree mode; null parent means top level
}
```

The duplicate scan only asks about labels that exist: a label about to be created holds
nothing, so its checks are skipped rather than sent and answered "no". Reused destination
labels are scanned exactly as today.

### Collecting the tree

**The API path** (`collectLabelViaApi`) is where this is cheap and complete.
`fetchUserLabelMap` already gives every label name in the source mailbox, so the members are
a filter over names, and each member is listed with the existing `listLabelThreadIds`. Every
thread is remembered with the member it came from.

**The scrape path** — the fallback when the API cannot resolve the label — has no label list,
so the members come out of Gmail's own navigation. A new `SIDEBAR_LABEL_SCRAPE_JS` reads
every `#label/…` href in the nav through the same rule `labelFromHref` uses, and each member
is then paged with the loop that exists today.

The honest limit: the sidebar shows what Gmail has rendered, so a collapsed parent can hide
children, and nothing is expanded programmatically — clicking Gmail's own chevrons is exactly
the kind of thing that breaks on their next release. The mitigation is that the picker lists
the tree it found before anything is copied, so a missing subfolder is visible while it can
still be cancelled, and the count goes into the drop log. The API path is the normal one and
is complete.

An empty sublabel is still created. The structure the user sees in the source is the
structure they get.

## Tests

| Module | What is proved |
|---|---|
| `tests/label-tree.test.ts` | members and their order; the four destination cases in the table; reuse versus create; a message under two source labels resolving to two ids |
| `tests/gmail-api.test.ts` | the create body's visibility fields; 409 resolving to the existing id |
| `tests/copy-journal.test.ts` | a `label` line surviving a read-back; a run with no created labels reading back empty |
| `tests/copy-marker-sweep.test.ts` | rollback deleting created labels and leaving reused ones |
| `tests/label-drop.test.ts` | the sidebar scrape's parsing; the cap applying across the tree |
| `tests/mail-copy.test.ts` | per-file labels through `labelsStillNeeded` and `newMessageCount`; flat mode unchanged |

## Implementation order

Four pieces have no dependency on each other and can be built at the same time — they touch
disjoint files:

1. `electron/mail/label-tree.ts` — the whole name calculation, pure.
2. `electron/gmail/gmail-api.ts` — `fetchUserLabelMap` and `createVisibleLabel`.
3. `electron/mail/copy-journal.ts` — the `label` line, and the rollback that acts on it.
4. `electron/mail/label-drop.ts` — the sidebar scrape and the tree-wide cap.

The wiring then follows in one pass, because it depends on all four: `SavedRef.sourceLabels`
and per-member collection in `mail-drop-controller.ts`, the per-file labels at the insert,
label planning per mailbox before the marker's first use, `CopyTarget.tree` in
`mail-copy.ts`, and the picker in `renderer/app/maildrop/page.tsx`.
