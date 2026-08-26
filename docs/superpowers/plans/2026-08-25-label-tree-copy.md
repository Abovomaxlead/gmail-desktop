# Label Tree Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dragging a Gmail label copies that label and every label nested under it into another mailbox, recreating the same shape, optionally underneath a label that is already there.

**Architecture:** Gmail nesting is a naming convention (`Klanten/Acme` is one flat label), so the whole tree is a string calculation, isolated in a new pure module. Collection remembers which source label each thread came from; the copy resolves that per file into destination label ids, creating what is missing parents-first. Labels the run created are journalled, so a rollback can delete them again.

**Tech Stack:** TypeScript, Electron main process, Gmail REST API v1, Vitest, Next.js (renderer, `renderer/app/maildrop/page.tsx`).

**Spec:** `docs/superpowers/specs/2026-08-25-label-tree-copy-design.md`

## Global Constraints

- **Comments follow the repo convention.** Banner sections are exactly three lines: 27 `=`, the Title case name, 27 `=`. Two blank lines above a banner, one below. Section order in a TypeScript module: `Types`, `Constants`, `Exported functions`, `Helper functions`. An empty section stays in the file.
- **Comments and identifiers are English. User-facing strings are Dutch** — that is what the surrounding code does (`'Gmail gaf geen label terug'`, `'Alleen postvakken van het werkdomein kunnen worden gekozen'`).
- **Docblocks:** one-line description, third person, present tense, no trailing period; blank `*` line; then `@param` per argument in signature order and `@returns` last. No docblock where the name already says everything.
- **The flat drag must not change.** A dragged conversation, a dragged selection, and a label drag with the structure option off keep today's behaviour exactly — same mail, same labels, same file names, same `log.jsonl` lines. Every task that touches shared code proves this with a test that the old path still works.
- **The marker rides the first insert.** `insertLabelIds(labelIds, markerLabelId)` stays the only way a message goes out. Destination labels are added to `labelIds`, never applied in a follow-up `modify`.
- **`MAX_THREADS`** (`electron/mail/label-drop.ts:30`) bounds a whole drag, tree included. Read the constant, never its value.
- **Test runner:** `npx vitest run tests/<file>` for one file, `npm test` for all. Tests import from `../electron/...` and use `describe/it/expect` from `vitest`.
- **Commit style:** `feat(scope): lowercase summary`, English, per the recent history (`feat(settings): pick whether prereleases are offered`).

---

## Task Overview

Tasks 1–4 touch disjoint files and can be built at the same time. Tasks 5–8 wire them together and run in order, after all four are in.

| Task | File | Depends on |
|---|---|---|
| 1 | `electron/mail/label-tree.ts` (new) | — |
| 2 | `electron/gmail/gmail-api.ts` | — |
| 3 | `electron/mail/copy-run-types.ts`, `copy-journal.ts`, `copy-marker-run-sweep.ts` | — |
| 4 | `electron/mail/label-drop.ts` | — |
| 5 | `electron/mail/mail-copy.ts` | 1 |
| 6 | `electron/mail/mail-drop-controller.ts` (collection) | 1, 2, 4 |
| 7 | `electron/mail/mail-drop-controller.ts` (copy) | 1, 2, 3, 5, 6 |
| 8 | `renderer/app/maildrop/page.tsx`, `electron/core/ipc.ts` | 5, 7 |

---

### Task 1: The tree as a name calculation

A new pure module. No Electron, no network, no imports from the rest of the app — that is what makes it testable and what makes it safe to build in parallel with everything else.

**Files:**
- Create: `electron/mail/label-tree.ts`
- Test: `tests/label-tree.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface LabelTreePlan { destinations: Map<string, string>; reuse: Map<string, string>; create: string[] }`
  - `labelTreeMembers(all: string[], dragged: string): string[]`
  - `destinationName(dragged: string, member: string, parent: string | null): string`
  - `planLabelTree(members: string[], dragged: string, parent: string | null, existing: Map<string, string>): LabelTreePlan`
  - `resolveMessageLabels(sourceLabels: string[], destinations: Map<string, string>, ids: Map<string, string>): string[]`

Vocabulary used throughout: a **member** is a source label name (`Klanten/Acme`); a **destination** is the name it gets in the target mailbox (`Archief/Klanten/Acme`); `ids` maps a destination name to the target mailbox's label id.

- [ ] **Step 1: Write the failing tests**

Create `tests/label-tree.test.ts`:

```ts
// Recreating a dragged label's nesting in another mailbox: which labels belong to the tree,
// what they are called there, and which of them have to be made.

import { describe, it, expect } from 'vitest';
import {
  labelTreeMembers,
  destinationName,
  planLabelTree,
  resolveMessageLabels,
} from '../electron/mail/label-tree';

describe('labelTreeMembers', () => {
  const all = ['Klanten', 'Klanten/Acme', 'Klanten/Acme/2025', 'Klantenservice', 'Archief'];

  it('takes the label itself and everything under it', () => {
    expect(labelTreeMembers(all, 'Klanten')).toEqual([
      'Klanten',
      'Klanten/Acme',
      'Klanten/Acme/2025',
    ]);
  });

  it('does not take a label that merely starts with the same letters', () => {
    expect(labelTreeMembers(all, 'Klanten')).not.toContain('Klantenservice');
  });

  it('starts at a sublabel when a sublabel was dragged', () => {
    expect(labelTreeMembers(all, 'Klanten/Acme')).toEqual(['Klanten/Acme', 'Klanten/Acme/2025']);
  });

  it('returns parents before their children', () => {
    const shuffled = ['Klanten/Acme/2025', 'Klanten', 'Klanten/Acme'];
    expect(labelTreeMembers(shuffled, 'Klanten')).toEqual([
      'Klanten',
      'Klanten/Acme',
      'Klanten/Acme/2025',
    ]);
  });

  it('is empty when the dragged label is not in the list', () => {
    expect(labelTreeMembers(all, 'Weg')).toEqual([]);
  });
});

describe('destinationName', () => {
  it('keeps the name when nothing is chosen to put it under', () => {
    expect(destinationName('Klanten', 'Klanten', null)).toBe('Klanten');
    expect(destinationName('Klanten', 'Klanten/Acme', null)).toBe('Klanten/Acme');
  });

  it('puts the tree under the chosen label', () => {
    expect(destinationName('Klanten', 'Klanten/Acme/2025', 'Archief')).toBe(
      'Archief/Klanten/Acme/2025',
    );
  });

  it('takes only the leaf name when a sublabel was dragged', () => {
    expect(destinationName('Klanten/Acme', 'Klanten/Acme', 'Archief')).toBe('Archief/Acme');
    expect(destinationName('Klanten/Acme', 'Klanten/Acme/2025', 'Archief')).toBe(
      'Archief/Acme/2025',
    );
    expect(destinationName('Klanten/Acme', 'Klanten/Acme/2025', null)).toBe('Acme/2025');
  });
});

describe('planLabelTree', () => {
  const members = ['Klanten', 'Klanten/Acme'];

  it('maps every member to the name it gets in the target', () => {
    const plan = planLabelTree(members, 'Klanten', 'Archief', new Map());
    expect(plan.destinations.get('Klanten')).toBe('Archief/Klanten');
    expect(plan.destinations.get('Klanten/Acme')).toBe('Archief/Klanten/Acme');
  });

  it('reuses a label that is already there instead of creating it', () => {
    const existing = new Map([['Klanten', 'Label_9']]);
    const plan = planLabelTree(members, 'Klanten', null, existing);
    expect(plan.reuse.get('Klanten')).toBe('Label_9');
    expect(plan.create).toEqual(['Klanten/Acme']);
  });

  it('lists what has to be made, parents first', () => {
    const deep = ['Klanten', 'Klanten/Acme', 'Klanten/Acme/2025'];
    const plan = planLabelTree(deep, 'Klanten', null, new Map());
    expect(plan.create).toEqual(['Klanten', 'Klanten/Acme', 'Klanten/Acme/2025']);
  });

  it('fills in an ancestor no member of its own occupies', () => {
    // Gmail lets Klanten/Acme/2025 exist without Klanten/Acme, so the copy has to make it
    const gappy = ['Klanten', 'Klanten/Acme/2025'];
    const plan = planLabelTree(gappy, 'Klanten', null, new Map());
    expect(plan.create).toEqual(['Klanten', 'Klanten/Acme', 'Klanten/Acme/2025']);
  });

  it('never creates the chosen parent itself', () => {
    const plan = planLabelTree(members, 'Klanten', 'Archief', new Map([['Archief', 'Label_1']]));
    expect(plan.create).not.toContain('Archief');
  });
});

describe('resolveMessageLabels', () => {
  const destinations = new Map([
    ['Klanten', 'Archief/Klanten'],
    ['Klanten/Acme', 'Archief/Klanten/Acme'],
  ]);
  const ids = new Map([
    ['Archief/Klanten', 'Label_1'],
    ['Archief/Klanten/Acme', 'Label_2'],
  ]);

  it('gives one message under two source labels both label ids', () => {
    expect(resolveMessageLabels(['Klanten', 'Klanten/Acme'], destinations, ids)).toEqual([
      'Label_1',
      'Label_2',
    ]);
  });

  it('skips a label whose creation failed rather than guessing a nearer one', () => {
    const partial = new Map([['Archief/Klanten', 'Label_1']]);
    expect(resolveMessageLabels(['Klanten', 'Klanten/Acme'], destinations, partial)).toEqual([
      'Label_1',
    ]);
  });

  it('never repeats an id', () => {
    const same = new Map([
      ['Klanten', 'Archief/Klanten'],
      ['Klanten/Acme', 'Archief/Klanten'],
    ]);
    expect(resolveMessageLabels(['Klanten', 'Klanten/Acme'], same, ids)).toEqual(['Label_1']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/label-tree.test.ts`
Expected: FAIL — `Failed to resolve import "../electron/mail/label-tree"`.

- [ ] **Step 3: Write the module**

Create `electron/mail/label-tree.ts`:

```ts
// Recreating a dragged label's nesting in another mailbox.
//
// Gmail's nesting is a naming convention and nothing more: `Klanten/Acme` is one flat label
// whose name contains a slash, not a child of `Klanten`. So a tree is a set of names, and
// every question about it -- what belongs to it, what it is called in the target, what has to
// be made there -- is string work. Kept pure and apart from the network for exactly that
// reason: it is the part that can be proved.

//===========================
// Types
//===========================

/** What one mailbox has to do to take a tree, worked out before anything is created */
export interface LabelTreePlan {
  /** Per source label the name it gets in the target mailbox */
  destinations: Map<string, string>;
  /** Per destination name the id of the label already carrying it */
  reuse: Map<string, string>;
  /** Destination names still to create, parents before their children */
  create: string[];
}


//===========================
// Constants
//===========================


//===========================
// Exported functions
//===========================

/**
 * The labels a dragged label takes with it
 *
 * A name that merely starts with the same letters is not a child -- `Klantenservice` is not
 * under `Klanten` -- so the separator is part of what is matched.
 *
 * @param all every label name in the source mailbox
 * @param dragged
 * @returns the dragged label and its descendants, parents before children
 */
export function labelTreeMembers(all: string[], dragged: string): string[] {
  const members = all.filter((n) => n === dragged || n.startsWith(`${dragged}/`));
  return sortParentsFirst(members);
}

/**
 * What one member of the tree is called in the target mailbox
 *
 * The dragged label's own leaf name is the top of what lands: dragging `Klanten/Acme` copies
 * a folder called `Acme`, because that is the folder the user picked up, not the one above it.
 *
 * @param dragged
 * @param member
 * @param parent the label the tree is put under, or null for the top of the list
 * @returns the destination name
 */
export function destinationName(dragged: string, member: string, parent: string | null): string {
  const base = dragged.split('/').pop() ?? dragged;
  const below = member.slice(dragged.length);
  const relative = `${base}${below}`;
  return parent ? `${parent}/${relative}` : relative;
}

/**
 * Works out what one mailbox has to do to take the tree
 *
 * A destination name the mailbox already has is reused and never recreated -- that is what
 * copying a tree into an existing label means, and it is what keeps a rollback from deleting
 * a label the user made themselves.
 *
 * @param members from labelTreeMembers
 * @param dragged
 * @param parent the label the tree is put under, or null
 * @param existing the target mailbox's own labels, name to id
 * @returns the plan
 */
export function planLabelTree(
  members: string[],
  dragged: string,
  parent: string | null,
  existing: Map<string, string>,
): LabelTreePlan {
  const destinations = new Map<string, string>();
  const reuse = new Map<string, string>();
  const wanted = new Set<string>();

  for (const member of members) {
    const name = destinationName(dragged, member, parent);
    destinations.set(member, name);
    for (const step of ancestryOf(name, parent)) wanted.add(step);
  }

  const create: string[] = [];
  for (const name of sortParentsFirst([...wanted])) {
    const already = existing.get(name);
    if (already) reuse.set(name, already);
    else create.push(name);
  }
  return { destinations, reuse, create };
}

/**
 * The label ids one saved message goes out with
 *
 * A member whose label is not in `ids` -- its creation failed -- is left out rather than
 * folded into its nearest ancestor: filing mail somewhere the user did not ask for is worse
 * than a gap the outcome names.
 *
 * @param sourceLabels the tree members this message was found under
 * @param destinations from the plan
 * @param ids every destination name that exists in the target now, name to id
 * @returns the ids, each at most once, in the order the members came in
 */
export function resolveMessageLabels(
  sourceLabels: string[],
  destinations: Map<string, string>,
  ids: Map<string, string>,
): string[] {
  const out: string[] = [];
  for (const member of sourceLabels) {
    const name = destinations.get(member);
    const id = name ? ids.get(name) : undefined;
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}


//===========================
// Helper functions
//===========================

/**
 * Orders names so a label always comes after the label it nests under
 *
 * Depth first, then the name, because creating `A/B` before `A` exists leaves Gmail showing a
 * parent nobody made.
 *
 * @param names
 * @returns a new array
 * @private
 */
function sortParentsFirst(names: string[]): string[] {
  return [...names].sort(
    (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b, 'nl'),
  );
}

/**
 * A destination name and every step above it that the copy is responsible for
 *
 * Stops at the chosen parent: that label was picked from the mailbox's own list, so it exists
 * and is not this run's to make.
 *
 * @param name
 * @param parent
 * @returns the steps, shallowest first
 * @private
 */
function ancestryOf(name: string, parent: string | null): string[] {
  const parts = name.split('/');
  const skip = parent ? parent.split('/').length : 0;
  const out: string[] = [];
  for (let i = skip + 1; i <= parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/label-tree.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/mail/label-tree.ts tests/label-tree.test.ts
git commit -m "feat(maildrop): work out a dragged label's tree and where it lands"
```

---

### Task 2: Reading and creating real labels

**Files:**
- Modify: `electron/gmail/gmail-api.ts` — add to the existing `Labels` section, next to `createHiddenLabel` (around line 400–440)
- Test: `tests/gmail-api.test.ts` (append)

**Interfaces:**
- Consumes: nothing from other tasks. Uses this file's own `LABELS_URL`, `requestJson`, `parseAllLabels`, `parseCreatedLabel`, `fetchLabel`, `isMarkerLabelName`, `GmailHttpError`.
- Produces:
  - `visibleLabelCreateBody(name: string): string`
  - `fetchUserLabelMap(accessToken: string): Promise<Map<string, string>>`
  - `createVisibleLabel(accessToken: string, name: string): Promise<{ id: string; name: string }>`

Read `createHiddenLabel` and `labelCreateBody` first — this is their visible sibling and must sit beside them.

- [ ] **Step 1: Write the failing tests**

Append to `tests/gmail-api.test.ts` (add the three names to the existing import from `../electron/gmail/gmail-api`):

```ts
describe('visibleLabelCreateBody', () => {
  it('asks for a label the user can actually see', () => {
    expect(JSON.parse(visibleLabelCreateBody('Klanten/Acme'))).toEqual({
      name: 'Klanten/Acme',
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    });
  });

  it('differs from the hidden marker body', () => {
    expect(visibleLabelCreateBody('X')).not.toBe(labelCreateBody('X'));
  });
});

describe('userLabelMap', () => {
  it('keeps only the user own labels, not the system ones', () => {
    const map = userLabelMap([
      { id: 'Label_1', name: 'Klanten', type: 'user', labelListVisibility: '' },
      { id: 'INBOX', name: 'INBOX', type: 'system', labelListVisibility: '' },
    ]);
    expect([...map]).toEqual([['Klanten', 'Label_1']]);
  });

  it('drops this app own run markers', () => {
    const marker = { id: 'Label_9', name: markerLabelName('run-1'), type: 'user', labelListVisibility: '' };
    expect(userLabelMap([marker]).size).toBe(0);
  });
});
```

`userLabelMap` is the pure half of `fetchUserLabelMap`, split out so the test needs no network — the same split `parseLabels`/`fetchLabels` already uses in this file. If `markerLabelName` is not exported yet, export it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/gmail-api.test.ts`
Expected: FAIL — `visibleLabelCreateBody is not a function`.

- [ ] **Step 3: Write the implementation**

Add to the `Labels` section of `electron/gmail/gmail-api.ts`:

```ts
export function visibleLabelCreateBody(name: string): string {
  return JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' });
}

/**
 * The user's own labels, name to id
 *
 * Markers are left out: they are this app's bookkeeping, and a tree must never be planned to
 * land in one.
 *
 * @param raw from parseAllLabels
 * @returns name to id
 */
export function userLabelMap(raw: RawLabel[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of raw) {
    if (l.type !== 'user' || isMarkerLabelName(l.name)) continue;
    out.set(l.name, l.id);
  }
  return out;
}

/**
 * Every label a mailbox has, in one request
 *
 * One listing per mailbox rather than one lookup per label: a tree of forty would otherwise be
 * forty round trips to learn what forty names already are.
 *
 * @param accessToken
 * @returns name to id
 */
export async function fetchUserLabelMap(accessToken: string): Promise<Map<string, string>> {
  return userLabelMap(parseAllLabels(await requestJson(LABELS_URL, accessToken)));
}

/**
 * Creates one label the user can see, or finds the one already carrying the name
 *
 * Unlike a marker, a real label with the wanted name is precisely what was wanted, so a 409 is
 * resolved by using it -- there is nothing here to distrust and resolveConflictedMarker does
 * not apply.
 *
 * @param accessToken
 * @param name the full nested name, `Archief/Klanten/Acme`
 * @returns the label's id and name
 * @throws whatever the create failed with, when a 409 cannot be resolved either
 */
export async function createVisibleLabel(
  accessToken: string,
  name: string,
): Promise<{ id: string; name: string }> {
  try {
    const json = await requestJson(LABELS_URL, accessToken, {
      method: 'POST',
      contentType: 'application/json',
      body: Buffer.from(visibleLabelCreateBody(name), 'utf8'),
    });
    const created = parseCreatedLabel(json);
    if (!created) throw new Error('Gmail gaf geen label terug');
    return created;
  } catch (e) {
    if (!(e instanceof GmailHttpError) || e.status !== 409) throw e;
    const existing = await fetchLabel(accessToken, name);
    if (!existing) throw new Error(`label '${name}' bestaat al, maar kon niet worden opgezocht`);
    return { id: existing.id, name: existing.name };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/gmail-api.test.ts`
Expected: PASS, including every test that was already in the file.

- [ ] **Step 5: Commit**

```bash
git add electron/gmail/gmail-api.ts tests/gmail-api.test.ts
git commit -m "feat(gmail): read a mailbox's labels in one call and create visible ones"
```

---

### Task 3: Journalling created labels, and undoing them

The rollback deletes every label the run created, even one that has since been used. That is a deliberate decision taken with the risk stated: it is bounded by only ever touching labels the run made itself, and a rollback is always something the user asked for. A reused label is never recorded and never deleted — that is the whole safety margin, so the test for it is not optional.

**Files:**
- Modify: `electron/mail/copy-run-types.ts` — add `CreatedLabel` next to `MarkerLabel`
- Modify: `electron/mail/copy-journal.ts` — the `label` line, its append, its read-back
- Modify: `electron/mail/copy-marker-run-sweep.ts` — `deleteCreatedLabels`
- Test: `tests/copy-journal.test.ts`, `tests/sweep-run-markers.test.ts` (append to both)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `interface CreatedLabel { email: string; labelId: string; name: string }` from `copy-run-types.ts`
  - `appendCopyJournalLabel(root: string, runId: CopyRunId, label: CreatedLabel): void`
  - `recordCopyJournalLabel(root, runId, label, append?): string | null`
  - `CopyJournalRead.created: CreatedLabel[]`
  - `deleteCreatedLabels(created: CreatedLabel[], deps: SweepRunDeps): Promise<string[]>` — returns the names it could not delete

- [ ] **Step 1: Write the failing tests**

Append to `tests/copy-journal.test.ts`:

```ts
describe('created labels in the journal', () => {
  it('reads a label line back off disk', () => {
    const raw = [
      JSON.stringify({ type: 'header', runId: 'r1', startedAt: 1, targets: ['a@b.nl'], markers: [] }),
      JSON.stringify({ type: 'label', runId: 'r1', email: 'a@b.nl', labelId: 'Label_1', name: 'Archief/Klanten' }),
    ].join('\n');
    expect(parseCopyJournal(raw)?.created).toEqual([
      { email: 'a@b.nl', labelId: 'Label_1', name: 'Archief/Klanten' },
    ]);
  });

  it('reads a run that created nothing back as an empty list', () => {
    const raw = JSON.stringify({ type: 'header', runId: 'r1', startedAt: 1, targets: [], markers: [] });
    expect(parseCopyJournal(raw)?.created).toEqual([]);
  });

  it('hands a failed write back instead of throwing it away', () => {
    const boom = () => {
      throw new Error('share weg');
    };
    expect(
      recordCopyJournalLabel('/root', 'r1', { email: 'a@b.nl', labelId: 'L', name: 'X' }, boom),
    ).toBe('share weg');
  });
});
```

Append to `tests/sweep-run-markers.test.ts`:

```ts
describe('deleteCreatedLabels', () => {
  const deps = (deleted: string[], fail?: string) => ({
    token: async () => ({ ok: true as const, token: 't' }),
    list: async () => ({ ids: [], done: true }),
    modify: async () => {},
    deleteLabel: async (_token: string, labelId: string) => {
      if (labelId === fail) throw new Error('nee');
      deleted.push(labelId);
    },
  });

  it('deletes every label the run made', async () => {
    const deleted: string[] = [];
    const left = await deleteCreatedLabels(
      [
        { email: 'a@b.nl', labelId: 'Label_1', name: 'Archief/Klanten' },
        { email: 'a@b.nl', labelId: 'Label_2', name: 'Archief/Klanten/Acme' },
      ],
      deps(deleted) as any,
    );
    expect(deleted).toEqual(['Label_2', 'Label_1']);
    expect(left).toEqual([]);
  });

  it('names what it could not delete rather than failing the rollback', async () => {
    const deleted: string[] = [];
    const left = await deleteCreatedLabels(
      [{ email: 'a@b.nl', labelId: 'Label_1', name: 'Archief/Klanten' }],
      deps(deleted, 'Label_1') as any,
    );
    expect(left).toEqual(['Archief/Klanten']);
  });

  it('does nothing when the run created nothing', async () => {
    const deleted: string[] = [];
    expect(await deleteCreatedLabels([], deps(deleted) as any)).toEqual([]);
    expect(deleted).toEqual([]);
  });
});
```

The first test asserts children go before parents: deleting `Archief/Klanten` first would leave Gmail showing a parent whose child is still there.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/copy-journal.test.ts tests/sweep-run-markers.test.ts`
Expected: FAIL — `recordCopyJournalLabel is not a function`, `deleteCreatedLabels is not a function`.

- [ ] **Step 3: Write the implementation**

In `electron/mail/copy-run-types.ts`, after `MarkerLabel`:

```ts
/** One label this run created in a target mailbox, recorded the moment the create answered.
 * Only labels the run made itself: one that was already there and got reused is never in
 * here, which is what keeps a rollback from deleting a label the user made. */
export interface CreatedLabel {
  email: string;
  labelId: string;
  name: string;
}
```

In `electron/mail/copy-journal.ts` — import `CreatedLabel`, add the line type to the union, and follow the shape `appendCopyJournalEntry`/`recordCopyJournalEntry` already set:

```ts
interface CopyJournalLabelLine extends CreatedLabel {
  type: 'label';
  runId: CopyRunId;
}
```

Add `| CopyJournalLabelLine` to `CopyJournalLine`, add `created: CreatedLabel[]` to `CopyJournalRead` with the docblock line *"Every label this run created, so a rollback can take them away again"*, and in `parseCopyJournal` collect it beside `entries`:

```ts
const created: CreatedLabel[] = [];
// ...inside the loop, beside the 'insert' branch:
else if (type === 'label') {
  const { type: _discriminator, runId: _runId, ...label } = parsed as CopyJournalLabelLine;
  created.push(label);
}
```

and return `created` in the object. Then the two writers:

```ts
/**
 * Records one label this run created, the moment the create answered
 *
 * @param root the drop folder
 * @param runId
 * @param label
 */
export function appendCopyJournalLabel(
  root: string,
  runId: CopyRunId,
  label: CreatedLabel,
): void {
  writeLine(root, runId, { type: 'label', runId, ...label });
}

/**
 * Records a created label, tolerating a failure to do so
 *
 * The same choice recordCopyJournalEntry makes: the label already exists in Gmail, so a line
 * this app cannot write locally must not undo that. What is lost is narrow -- this one label
 * cannot be taken away again by a later rollback.
 *
 * @param root the drop folder
 * @param runId
 * @param label
 * @param append injectable, so a test can make the write fail without touching a disk
 * @returns null on success, or the write's own failure message, for the caller to log
 */
export function recordCopyJournalLabel(
  root: string,
  runId: CopyRunId,
  label: CreatedLabel,
  append: typeof appendCopyJournalLabel = appendCopyJournalLabel,
): string | null {
  return attemptWrite(() => append(root, runId, label));
}
```

In `electron/mail/copy-marker-run-sweep.ts`, after `sweepRunMarkers`:

```ts
/**
 * Deletes the labels one run created, once its mail has been trashed
 *
 * Only ever the labels the run made itself -- a reused label is not in this list at all. A
 * label that has since been used by hand goes too: the user asked for the run to be undone,
 * and leaving half of it behind is the worse answer. Children before parents, so Gmail is
 * never left showing a parent whose child outlived it.
 *
 * @param created from the run's journal
 * @param deps
 * @returns the names it could not delete, for the outcome to report
 */
export async function deleteCreatedLabels(
  created: CreatedLabel[],
  deps: SweepRunDeps,
): Promise<string[]> {
  const deepestFirst = [...created].sort(
    (a, b) => b.name.split('/').length - a.name.split('/').length,
  );
  const failed: string[] = [];
  const tokens = new Map<string, string>();
  for (const label of deepestFirst) {
    let token = tokens.get(label.email);
    if (!token) {
      const got = await deps.token(label.email);
      if (!got.ok) {
        failed.push(label.name);
        continue;
      }
      token = got.token;
      tokens.set(label.email, token);
    }
    try {
      await deps.deleteLabel(token, label.labelId);
    } catch {
      failed.push(label.name);
    }
  }
  return failed;
}
```

Sequential on purpose: a parent must not be deleted while a child of it is still in flight.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/copy-journal.test.ts tests/sweep-run-markers.test.ts`
Expected: PASS, existing tests included.

- [ ] **Step 5: Commit**

```bash
git add electron/mail/copy-run-types.ts electron/mail/copy-journal.ts electron/mail/copy-marker-run-sweep.ts tests/copy-journal.test.ts tests/sweep-run-markers.test.ts
git commit -m "feat(maildrop): journal created labels so a rollback can remove them"
```

---

### Task 4: Collecting a tree from the page

Two things the source side needs and does not have: the sublabels when there is no API to ask, and an accumulator that remembers which label each thread came from.

**Files:**
- Modify: `electron/mail/label-drop.ts`
- Test: `tests/label-drop.test.ts` (append)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `interface TreeThread { threadId: string; subject: string; labels: string[] }`
  - `labelNamesFromHrefs(hrefs: string[]): string[]`
  - `mergeTreeThreads(acc: TreeThread[], member: string, page: LabelThread[]): { added: number; total: number }`
  - `SIDEBAR_LABEL_SCRAPE_JS: string`

`mergeThreads` and `LabelThread` stay exactly as they are — the flat drag keeps using them.

- [ ] **Step 1: Write the failing tests**

Append to `tests/label-drop.test.ts`:

```ts
describe('labelNamesFromHrefs', () => {
  it('reads every label out of the navigation', () => {
    expect(
      labelNamesFromHrefs([
        'https://mail.google.com/mail/u/0/#label/Klanten',
        'https://mail.google.com/mail/u/0/#label/Klanten%2FAcme',
        'https://mail.google.com/mail/u/0/#inbox',
      ]),
    ).toEqual(['Klanten', 'Klanten/Acme']);
  });

  it('names a label once however often it is linked', () => {
    expect(labelNamesFromHrefs(['#label/Klanten', '#label/Klanten/p2'])).toEqual(['Klanten']);
  });
});

describe('mergeTreeThreads', () => {
  it('remembers which label a thread came from', () => {
    const acc: TreeThread[] = [];
    mergeTreeThreads(acc, 'Klanten', [{ threadId: 't1', subject: 'Een' }]);
    expect(acc).toEqual([{ threadId: 't1', subject: 'Een', labels: ['Klanten'] }]);
  });

  it('adds the second label to a thread that is in both', () => {
    const acc: TreeThread[] = [];
    mergeTreeThreads(acc, 'Klanten', [{ threadId: 't1', subject: 'Een' }]);
    const second = mergeTreeThreads(acc, 'Klanten/Acme', [{ threadId: 't1', subject: 'Een' }]);
    expect(acc).toHaveLength(1);
    expect(acc[0].labels).toEqual(['Klanten', 'Klanten/Acme']);
    expect(second.added).toBe(0);
  });

  it('does not repeat a label when a page is read twice', () => {
    const acc: TreeThread[] = [];
    mergeTreeThreads(acc, 'Klanten', [{ threadId: 't1', subject: 'Een' }]);
    mergeTreeThreads(acc, 'Klanten', [{ threadId: 't1', subject: 'Een' }]);
    expect(acc[0].labels).toEqual(['Klanten']);
  });

  it('caps the whole tree, not each label', () => {
    const acc: TreeThread[] = [];
    const page = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({ threadId: `t${from + i}`, subject: 's' }));
    mergeTreeThreads(acc, 'A', page(0, MAX_THREADS));
    const over = mergeTreeThreads(acc, 'B', page(MAX_THREADS, 5));
    expect(over.added).toBe(0);
    expect(over.total).toBe(MAX_THREADS);
  });

  it('still lets a thread already in the accumulator gain a label at the cap', () => {
    const acc: TreeThread[] = [];
    const page = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({ threadId: `t${from + i}`, subject: 's' }));
    mergeTreeThreads(acc, 'A', page(0, MAX_THREADS));
    mergeTreeThreads(acc, 'B', [{ threadId: 't0', subject: 's' }]);
    expect(acc[0].labels).toEqual(['A', 'B']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/label-drop.test.ts`
Expected: FAIL — `labelNamesFromHrefs is not a function`.

- [ ] **Step 3: Write the implementation**

Add to the `Types` section of `electron/mail/label-drop.ts`:

```ts
/** One thread of a dragged tree, with the labels of that tree it turned up under. A thread in
 * both `Klanten` and `Klanten/Acme` is one thread with two labels, never two threads: it is
 * saved once and inserted once, carrying both destination labels. */
export interface TreeThread {
  threadId: string;
  subject: string;
  labels: string[];
}
```

Add to the `Exported functions` section:

```ts
/**
 * Every label named in a list of links
 *
 * The navigation links a label more than once -- the row, the paged views -- so a name counts
 * once however often it appears.
 *
 * @param hrefs
 * @returns the label names, in the order first seen
 */
export function labelNamesFromHrefs(hrefs: string[]): string[] {
  const out: string[] = [];
  for (const href of hrefs) {
    const name = labelFromHref(href);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Adds one label's scraped page to the tree collected so far
 *
 * The cap counts threads, not entries: a thread already collected under another label of the
 * tree gains that label even at the cap, since it costs nothing new to save.
 *
 * @param acc mutated in place
 * @param member the tree label this page was read from
 * @param page
 * @returns how many threads were new, and the running total
 */
export function mergeTreeThreads(
  acc: TreeThread[],
  member: string,
  page: LabelThread[],
): { added: number; total: number } {
  const byId = new Map(acc.map((t) => [t.threadId, t]));
  let added = 0;
  for (const t of page) {
    if (!t.threadId) continue;
    const known = byId.get(t.threadId);
    if (known) {
      if (!known.labels.includes(member)) known.labels.push(member);
      continue;
    }
    if (acc.length >= MAX_THREADS) continue;
    const fresh: TreeThread = { threadId: t.threadId, subject: t.subject, labels: [member] };
    acc.push(fresh);
    byId.set(t.threadId, fresh);
    added += 1;
  }
  return { added, total: acc.length };
}
```

And beside `LABEL_SCRAPE_JS`:

```ts
// Gmail's own navigation is the only list of sublabels there is without the API. Nothing is
// expanded to read it -- clicking Gmail's chevrons is exactly what breaks on their next
// release -- so a collapsed parent can hide children. What was found is shown in the picker
// before anything is copied, which is where a missing subfolder has to be visible.
export const SIDEBAR_LABEL_SCRAPE_JS = `(() => {
  var out = [];
  var els = document.querySelectorAll('a[href*="#label/"]');
  for (var i = 0; i < els.length; i++) out.push(els[i].getAttribute('href') || '');
  return out;
})()`;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/label-drop.test.ts`
Expected: PASS, existing tests included.

- [ ] **Step 5: Commit**

```bash
git add electron/mail/label-drop.ts tests/label-drop.test.ts
git commit -m "feat(maildrop): read sublabels from the navigation and collect a tree"
```

---

### Task 5: Per-file labels in the copy

**Files:**
- Modify: `electron/mail/mail-copy.ts` — `CopyTarget`, and the three functions that read `target.labelIds`
- Test: `tests/mail-copy.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's `LabelTreePlan` (type only).
- Produces:
  - `CopyTarget` with `tree?: { parentLabelId: string | null }`
  - `type ResolvedTreeLabels = Map<string, Map<string, string[]>>`
  - `labelsForMessage(target: CopyTarget, messageId: string, resolved: ResolvedTreeLabels): string[]`
  - `duplicateChecks(targets, files, resolved?: ResolvedTreeLabels): DuplicateHit[]`
  - `newMessageCount(index, targets, messageIds, resolved?: ResolvedTreeLabels): number`

`resolved` maps a mailbox address to that mailbox's label ids per Message-ID. Task 7 builds it; here it is only read, which is what keeps this file free of the network.

**Built differently from the sketch below, on purpose.** There is no `CopyFile`: `resolved` is keyed by Message-ID, so nothing in this file ever needs a file's `sourceLabels` — those are read in Task 7, where `resolved` is built. And `resolved` is an optional trailing parameter, so every flat call site keeps its present shape instead of being edited to pass an empty map. The name in the code is `labelsForMessage`; read `labelsForFile` below as that.

- [ ] **Step 1: Write the failing tests**

Append to `tests/mail-copy.test.ts`:

```ts
describe('labelsForFile', () => {
  const file = { messageId: '<a@b>', subject: 'Een', sourceLabels: ['Klanten'] };

  it('uses the ticked labels for a flat drag', () => {
    const target = { email: 'a@b.nl', labelIds: ['Label_1', 'Label_2'] };
    expect(labelsForFile(target, file, new Map())).toEqual(['Label_1', 'Label_2']);
  });

  it('uses the resolved tree labels for a tree drag', () => {
    const target = { email: 'a@b.nl', labelIds: [], tree: { parentLabelId: null } };
    const resolved = new Map([['a@b.nl', new Map([['<a@b>', ['Label_7']]])]]);
    expect(labelsForFile(target, file, resolved as any)).toEqual(['Label_7']);
  });

  it('gives a file whose labels all failed to be created nothing', () => {
    const target = { email: 'a@b.nl', labelIds: [], tree: { parentLabelId: null } };
    expect(labelsForFile(target, file, new Map())).toEqual([]);
  });
});

describe('duplicateChecks with a tree', () => {
  it('asks nothing about a file with no labels to land in', () => {
    const target = { email: 'a@b.nl', labelIds: [], tree: { parentLabelId: null } };
    const files = [{ messageId: '<a@b>', subject: 'Een', sourceLabels: ['Klanten'] }];
    expect(duplicateChecks([target], files, new Map())).toEqual([]);
  });

  it('is unchanged for a flat drag', () => {
    const target = { email: 'a@b.nl', labelIds: ['Label_1'] };
    const files = [{ messageId: '<a@b>', subject: 'Een', sourceLabels: [] }];
    expect(duplicateChecks([target], files, new Map())).toEqual([
      { email: 'a@b.nl', labelId: 'Label_1', messageId: '<a@b>', subject: 'Een' },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/mail-copy.test.ts`
Expected: FAIL — `labelsForFile is not a function`.

- [ ] **Step 3: Write the implementation**

In `electron/mail/mail-copy.ts`:

```ts
export interface CopyTarget {
  email: string;
  /** The labels ticked in the picker. Empty in tree mode, where the labels are per file. */
  labelIds: string[];
  /** Set when this mailbox takes the dragged label's whole tree. `parentLabelId` is the label
   * the tree is put under, or null for the top of the list. */
  tree?: { parentLabelId: string | null };
}

/** One saved message as the copy sees it: enough to match a duplicate on, plus the tree labels
 * it was found under. `sourceLabels` is empty for every drag that is not a tree drag. */
export interface CopyFile {
  messageId: string;
  subject: string;
  sourceLabels: string[];
}

/** Per mailbox, per message id, the label ids that mailbox resolved the tree to. Built once a
 * mailbox's labels exist (mail-drop-controller.ts) and only read here, so this file stays free
 * of the network. */
export type ResolvedTreeLabels = Map<string, Map<string, string[]>>;
```

Then, with a docblock in the file's own style:

```ts
export function labelsForFile(
  target: CopyTarget,
  file: CopyFile,
  resolved: ResolvedTreeLabels,
): string[] {
  if (!target.tree) return target.labelIds;
  return resolved.get(target.email)?.get(file.messageId) ?? [];
}
```

Change `duplicateChecks` and `newMessageCount` to take `files: CopyFile[]` and `resolved`, and to loop over `labelsForFile(target, file, resolved)` instead of `target.labelIds`. Their bodies otherwise stay as they are — a flat target's `labelsForFile` is `target.labelIds`, so the old behaviour falls out unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/mail-copy.test.ts`
Expected: PASS. Then `npm test` — every caller of the two changed signatures must still compile; fix call sites in `mail-drop-controller.ts` by passing an empty `new Map()` for now (Task 7 fills it).

- [ ] **Step 5: Commit**

```bash
git add electron/mail/mail-copy.ts tests/mail-copy.test.ts electron/mail/mail-drop-controller.ts
git commit -m "feat(maildrop): resolve a copy's labels per file rather than per mailbox"
```

---

### Task 6: Collecting the tree at drop time

**Files:**
- Modify: `electron/mail/mail-drop-controller.ts` — `SavedRef` (line 159), `collectLabelThreads` (line 572), `collectLabelViaApi` (line 625), `saveLabel` (line 682)
- Test: manual, plus `npm test` staying green

**Interfaces:**
- Consumes: Task 1 `labelTreeMembers`; Task 2 `fetchUserLabelMap`; Task 4 `TreeThread`, `mergeTreeThreads`, `labelNamesFromHrefs`, `SIDEBAR_LABEL_SCRAPE_JS`.
- Produces: `SavedRef.sourceLabels: string[]`, filled for a tree drag and `[]` for every other drag.

- [ ] **Step 1: Add the field**

`SavedRef` gains `sourceLabels: string[]`, with the comment *"The tree labels this message was found under; empty for a drag that is not a tree drag"*. Fill it with `[]` at every existing construction site so the flat drag is provably untouched.

- [ ] **Step 2: Collect the members**

In `collectLabelViaApi`, before listing threads:

```ts
const names = [...(await withToken((token) => fetchUserLabelMap(token))).keys()];
const members = labelTreeMembers(names, label);
```

Then list each member with the existing `listLabelThreadIds` and fold the result in with `mergeTreeThreads`, so `collectLabelViaApi` answers `TreeThread[]` instead of thread ids. Stop as soon as `total >= MAX_THREADS` and report `capped` exactly as it does today.

In `collectLabelThreads` (the scrape path), run `SIDEBAR_LABEL_SCRAPE_JS` in the hidden view once, put the result through `labelNamesFromHrefs` and `labelTreeMembers`, then run today's paging loop per member, merging with `mergeTreeThreads`. The `scrapeSettled` handshake and the not-settled log line stay exactly as they are, per member.

- [ ] **Step 3: Carry the labels to the saved refs**

`saveLabel` writes each thread's `.eml` files as it does now and sets `sourceLabels: thread.labels` on the refs it produces. File names, numbering and the preview strip do not change.

- [ ] **Step 4: Log what was found**

One line, in the existing `notifyLog` style:

```ts
notifyLog(`[maildrop] label "${label}": ${members.length} label(s), ${threads.length} gesprek(ken)`);
```

- [ ] **Step 5: Verify**

Run: `npm test` — expected PASS.
Then run the app and drag a label with sublabels; the log line must name more than one label, and the preview strip must show conversations from the sublabels.

- [ ] **Step 6: Commit**

```bash
git add electron/mail/mail-drop-controller.ts
git commit -m "feat(maildrop): collect a dragged label's sublabels too"
```

---

### Task 7: Creating the labels and copying into them

**Files:**
- Modify: `electron/mail/mail-drop-controller.ts` — the marker/copy start (around line 1680), the insert (line 1322), the rollback path
- Test: manual, plus `npm test` staying green

**Interfaces:**
- Consumes: Tasks 1, 2, 3, 5, 6.
- Produces: nothing new; this is the wiring.

- [ ] **Step 1: Plan and create, per mailbox**

Inside the existing per-mailbox step that creates the marker, after the marker and before any insert:

```ts
const existing = await withToken((t) => fetchUserLabelMap(t));
const parentName = target.tree?.parentLabelId
  ? nameOf(existing, target.tree.parentLabelId)
  : null;
const plan = planLabelTree(members, draggedLabel, parentName, existing);
const ids = new Map(plan.reuse);
for (const name of plan.create) {
  try {
    const made = await withToken((t) => createVisibleLabel(t, name));
    ids.set(name, made.id);
    const warn = recordCopyJournalLabel(root, runId, {
      email: target.email,
      labelId: made.id,
      name,
    });
    if (warn) warnings.push(warn);
  } catch (e) {
    failedLabels.push(`${name}: ${(e as Error).message}`);
  }
}
```

Parents first is `plan.create`'s own order — do not re-sort it.

- [ ] **Step 2: Resolve per file**

Build the `ResolvedTreeLabels` entry for this mailbox from the saved refs:

```ts
const perFile = new Map(
  files.map((f) => [f.messageId, resolveMessageLabels(f.sourceLabels, plan.destinations, ids)]),
);
resolved.set(target.email, perFile);
```

- [ ] **Step 3: Use it at the insert**

At `mail-drop-controller.ts:1322`:

```ts
const wanted = labelsForMessage(target, file.messageId, resolved);
const labelIds = labelsStillNeeded(index, target.email, wanted, messageId);
```

A file with no labels is skipped, counted as skipped, not as an error — the failed label is already reported by name. `insertLabelIds(labelIds, arg.markerLabelId)` is untouched.

- [ ] **Step 4: Report the failed labels**

Fold `failedLabels` into the mailbox's `CopyAccountResult.error` through the existing `withWarnings` mechanism, so a create that Gmail refused is named in the outcome instead of showing up as missing mail.

- [ ] **Step 5: Delete created labels on rollback**

Where `sweepRunMarkers(runId, markers, 'trash', deps)` is called, follow it with:

```ts
const leftBehind = await deleteCreatedLabels(journal.created, deps);
```

and put `leftBehind` into the rollback's own report. `'strip'` — a clean finish or a stop-and-keep — must not call it.

- [ ] **Step 6: Verify**

Run: `npm test` — expected PASS.
Then, against a real mailbox: drag a label tree, copy it, check the target has the same shape; cancel a second copy and roll it back, and check the created labels are gone while a label that already existed is still there.

- [ ] **Step 7: Commit**

```bash
git add electron/mail/mail-drop-controller.ts
git commit -m "feat(maildrop): recreate a dragged label's structure in the target mailbox"
```

---

### Task 8: The picker

**Files:**
- Modify: `renderer/app/maildrop/page.tsx`
- Modify: `electron/core/ipc.ts` — the drop preview payload gains the tree
- Test: manual

**Interfaces:**
- Consumes: Task 5's `CopyTarget.tree`.
- Produces: a picker that sends `tree` for a tree drag.

- [ ] **Step 1: Send the tree to the picker**

The preview payload gains `tree?: { dragged: string; members: Array<{ name: string; threads: number }> }`, filled by Task 6's collection. A drag that is not a label drag leaves it out, and the picker then draws exactly what it draws today.

- [ ] **Step 2: The mode switch**

Per mailbox, when `tree` is present, a switch labelled `Structuur overnemen`, on by default.

- [ ] **Step 3: Where it lands**

With the switch on, the checkbox list is replaced by: a choice between `Bovenin` and `Onder een label`, the latter using the existing searchable list (`filterLabels`) to pick one — that one control is both "copy to the top" and "copy into an existing label". Below it the tree as it will be created, `members` with their counts, and a name the mailbox already has marked `bestaat al`.

- [ ] **Step 4: What gets sent**

Switch on → `{ email, labelIds: [], tree: { parentLabelId } }`, with `parentLabelId` null for `Bovenin`. Switch off → `{ email, labelIds }` exactly as today. `pickedCount` counts a tree mailbox as one.

- [ ] **Step 5: Duplicates**

`countExisting` is only asked about labels that exist. A label about to be created shows no count at all rather than a zero — the two mean different things and the picker already draws that difference.

- [ ] **Step 6: Verify**

Run: `npm test` — expected PASS.
Then run the app: drag a tree, check the switch is on and the tree is listed; switch it off and confirm the old ticking screen is back, unchanged; copy both ways.

- [ ] **Step 7: Commit**

```bash
git add renderer/app/maildrop/page.tsx electron/core/ipc.ts
git commit -m "feat(maildrop): choose where a dragged label's structure lands"
```

---

## Done when

- Dragging `Klanten` with `Klanten/Acme` and `Klanten/Acme/2025` into another mailbox creates all three there, with the mail under the right one.
- Choosing `Archief` puts them under `Archief`; choosing `Bovenin` puts them at the top.
- A destination label that already exists is used, not duplicated.
- A conversation in two labels of the tree is copied once and carries both.
- An empty sublabel is created.
- Rolling that copy back trashes the mail and deletes the labels the run created, leaving reused ones alone.
- Switching the structure option off gives exactly today's drag.
- `npm test` passes.
