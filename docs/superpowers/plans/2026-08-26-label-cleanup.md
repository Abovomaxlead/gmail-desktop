# Emptying a label from settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A settings section that empties a chosen label — and its sublabels, each tickable — in a chosen mailbox, by moving its messages to Gmail's trash.

**Architecture:** A pure module (`label-purge.ts`) owns the chunking and the count-then-purge handle, so the safety property is testable without Electron. A thin controller (`label-purge-controller.ts`) does the two Gmail-facing halves. Two IPC calls expose them, and a new settings section drives them. Everything Gmail-facing reuses primitives that already exist: `labelTreeMembers`, `fetchUserLabelMap`, `fetchMessageListPage`, `batchModifyMessages`.

**Tech Stack:** TypeScript, Electron main process, React (settings panel), vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-26-label-cleanup-design.md`

**One correction to that spec, found while writing this plan:** it asks for tests of the tree resolution, including that `test` must not match `latest`. That resolution is `labelTreeMembers` (`electron/mail/label-tree.ts:43`), which already does exactly this and already has its own tests in `tests/label-tree.test.ts`. Reuse it; do not reimplement it and do not duplicate its tests. Every other test bullet in the spec stands.

## Global Constraints

- **Written artifacts are English.** Comments, docblocks, commit messages. User-facing strings are Dutch, matching every other string in the settings panel.
- **Comment convention.** Banner sections (three lines, a row of 27 `=`, the Title-case name, another row of 27 `=`), fixed section order per file, empty sections stay. Docblocks are one-line description, blank `*`, then tags. Inline comments say *why*, never restate the line below. Roughly one comment line per ten of code.
- **`messages.batchDelete` must not appear in this feature at any point, under any flag.** The only removal is `batchModify` adding `TRASH`, which Gmail keeps for 30 days. This is a hard rule from the spec, not a default.
- **Labels are never removed.** Trashing messages does not touch a label, and nothing here may call `deleteLabel`.
- **System labels are unreachable by construction.** Build the label list from `fetchUserLabelMap`, which keeps only `type === 'user'` and drops this app's marker labels. Never from `fetchLabels` or a raw `labels.list`.
- **Never automatic.** Nothing in this feature may run without someone choosing it in that moment. No pref, no startup path, no post-copy prompt.
- **One mailbox at a time.** The count and the purge each name exactly one mailbox.
- **Verification commands:** `npm test`, `npx tsc --noEmit -p tsconfig.json`, `npx tsc --noEmit -p renderer/tsconfig.json`. Baseline at the start of this plan: 1932 tests green.
- **Do not run `npm run build`, `npm run build:renderer`, or `npm run dev`.** A production build poisons `renderer/.next` and makes the dev server 404 its own routes. This plan needs none of them.

---

## Task Overview

| Task | Files | Depends on |
|---|---|---|
| 1 | `electron/mail/label-purge.ts` (new), `tests/label-purge.test.ts` (new) | — |
| 2 | `electron/mail/label-purge-controller.ts` (new) | 1 |
| 3 | `electron/core/ipc.ts`, `electron/core/ipc-handlers.ts`, `electron/sidebar-preload.ts` | 2 |
| 4 | `renderer/app/settings/LabelCleanupSection.tsx` (new), `renderer/app/settings/nav.ts`, `renderer/app/SettingsPanel.tsx`, `renderer/app/strings.ts` | 3 |

Strictly sequential. Task 1 carries almost all of the testable logic; 2 to 4 are the wiring, and the section comes last so that every question about what the feature *does* is settled before anything renders it.

---

### Task 1: The chunking and the count-then-purge handle

**Files:**
- Create: `electron/mail/label-purge.ts`
- Test: `tests/label-purge.test.ts`

**Interfaces:**
- Consumes: nothing at runtime.
- Produces, all from `electron/mail/label-purge.ts`:
  - `export const PURGE_LIST_MAX = 50_000`
  - `export interface PurgeLabel { name: string; labelId: string; messages: number }`
  - `export interface PurgeCount { handle: string; email: string; label: string; labels: PurgeLabel[]; total: number; capped: boolean }`
  - `export interface PurgeOutcome { trashed: number; failed: number; error?: string }`
  - `export interface CountedLabel { name: string; labelId: string; ids: string[] }`
  - `export function chunkIds(ids: string[], size: number): string[][]`
  - `export interface PurgeStore { put(arg: { email: string; label: string; byLabel: CountedLabel[]; capped: boolean }): PurgeCount; take(handle: string, labels: string[]): { email: string; ids: string[] } | null }`
  - `export function createPurgeStore(newHandle: () => string): PurgeStore`

**Why the handle exists:** it makes what goes away identical to what the user was shown, rather than to whatever is under the label at the moment they click. Mail that arrives between the count and the click is not in the store, so it stays. And `take` consumes the handle, so one count buys exactly one purge — a second click has nothing to act on and a stale settings window cannot fire an old listing.

- [ ] **Step 1: Write the failing tests**

Create `tests/label-purge.test.ts`:

```ts
// The count-then-purge handle, and the chunking that carries it out. Pure, so none of this
// needs Electron or a network: the safety property this feature rests on is that a purge can
// only ever act on ids somebody was shown, and that is decided here.

import { describe, it, expect } from 'vitest';
import {
  PURGE_LIST_MAX,
  chunkIds,
  createPurgeStore,
  type CountedLabel,
} from '../electron/mail/label-purge';

const ids = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `m${i + from}`);

/** A store whose handles are predictable, so a test can name one. */
const store = () => {
  let n = 0;
  return createPurgeStore(() => `h${++n}`);
};

const counted = (): CountedLabel[] => [
  { name: 'test', labelId: 'Label_1', ids: ids(3) },
  { name: 'test/test123', labelId: 'Label_2', ids: ids(2, 3) },
];

describe('chunkIds', () => {
  it('cuts an exact multiple into equal chunks', () => {
    expect(chunkIds(ids(6), 3).map((c) => c.length)).toEqual([3, 3]);
  });

  it('leaves the last chunk short rather than padding it', () => {
    expect(chunkIds(ids(7), 3).map((c) => c.length)).toEqual([3, 3, 1]);
  });

  it('answers one chunk for a single id', () => {
    expect(chunkIds(['m0'], 1000)).toEqual([['m0']]);
  });

  it('answers nothing at all for nothing at all', () => {
    expect(chunkIds([], 1000)).toEqual([]);
  });

  it('keeps every id exactly once, in order', () => {
    const all = ids(10);
    expect(chunkIds(all, 4).flat()).toEqual(all);
  });
});

describe('the purge store', () => {
  it('answers a count per label and a total', () => {
    const s = store();
    const count = s.put({ email: 'a@b.nl', label: 'test', byLabel: counted(), capped: false });
    expect(count.handle).toBe('h1');
    expect(count.email).toBe('a@b.nl');
    expect(count.label).toBe('test');
    expect(count.total).toBe(5);
    expect(count.labels).toEqual([
      { name: 'test', labelId: 'Label_1', messages: 3 },
      { name: 'test/test123', labelId: 'Label_2', messages: 2 },
    ]);
    expect(count.capped).toBe(false);
  });

  // The ids never leave the main process in the count. Only the counts do.
  it('does not put the ids in the count it answers', () => {
    const count = store().put({ email: 'a@b.nl', label: 'test', byLabel: counted(), capped: false });
    expect(JSON.stringify(count)).not.toContain('m0');
  });

  it('gives back the ids of the labels named, and only those', () => {
    const s = store();
    const { handle } = s.put({ email: 'a@b.nl', label: 'test', byLabel: counted(), capped: false });
    expect(s.take(handle, ['test'])).toEqual({ email: 'a@b.nl', ids: ['m0', 'm1', 'm2'] });
  });

  it('gives back both labels when both are named', () => {
    const s = store();
    const { handle } = s.put({ email: 'a@b.nl', label: 'test', byLabel: counted(), capped: false });
    expect(s.take(handle, ['test', 'test/test123'])?.ids).toHaveLength(5);
  });

  // The user unticked it, so its ids must not travel with the ones they left ticked.
  it('never returns ids of a label that was not named', () => {
    const s = store();
    const { handle } = s.put({ email: 'a@b.nl', label: 'test', byLabel: counted(), capped: false });
    expect(s.take(handle, ['test/test123'])).toEqual({ email: 'a@b.nl', ids: ['m3', 'm4'] });
  });

  it('ignores a label name it never counted', () => {
    const s = store();
    const { handle } = s.put({ email: 'a@b.nl', label: 'test', byLabel: counted(), capped: false });
    expect(s.take(handle, ['test', 'nooit-geteld'])?.ids).toHaveLength(3);
  });

  // One count buys one purge. A second click has nothing to act on.
  it('consumes the handle, so a second purge finds nothing', () => {
    const s = store();
    const { handle } = s.put({ email: 'a@b.nl', label: 'test', byLabel: counted(), capped: false });
    expect(s.take(handle, ['test'])).not.toBeNull();
    expect(s.take(handle, ['test'])).toBeNull();
  });

  it('refuses a handle it never issued', () => {
    const s = store();
    s.put({ email: 'a@b.nl', label: 'test', byLabel: counted(), capped: false });
    expect(s.take('h999', ['test'])).toBeNull();
  });

  // Counting again replaces what is held: a stale window cannot fire a listing nobody looked at.
  it('refuses the previous handle once a new count replaces it', () => {
    const s = store();
    const first = s.put({ email: 'a@b.nl', label: 'test', byLabel: counted(), capped: false });
    const second = s.put({ email: 'a@b.nl', label: 'test', byLabel: counted(), capped: false });
    expect(s.take(first.handle, ['test'])).toBeNull();
    expect(s.take(second.handle, ['test'])).not.toBeNull();
  });

  it('carries the capped flag through', () => {
    const count = store().put({ email: 'a@b.nl', label: 'test', byLabel: counted(), capped: true });
    expect(count.capped).toBe(true);
  });
});

describe('the listing bound', () => {
  // Far past any real label, and there so a runaway page loop cannot allocate without end.
  it('is high enough never to bite in practice and low enough to bound memory', () => {
    expect(PURGE_LIST_MAX).toBe(50_000);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/label-purge.test.ts`
Expected: FAIL — `electron/mail/label-purge.ts` does not exist.

- [ ] **Step 3: Write the module**

Create `electron/mail/label-purge.ts`:

```ts
// What a label-emptying is allowed to act on, decided away from the network.
//
// This app has never removed mail it did not create. Every destructive path it has works from a
// marker label it applied in the same call that made the message. This feature removes mail from
// the mailbox holding the originals, on the user's word, so the one thing worth making
// structurally true is that it can only ever act on ids somebody was actually shown.
//
// That is what the handle below is. A count remembers its ids here and answers a handle; the
// purge takes the handle and nothing else. Mail arriving between the two is not in the store and
// therefore survives, an unknown handle is refused rather than re-derived, and `take` consumes
// what it hands out, so one count buys exactly one purge.
//
// The tree resolution is not here: `labelTreeMembers` in label-tree.ts already answers which
// labels belong to a dragged label, and Gmail's nesting being naming rather than containment is
// its problem to know about, not this file's.

//===========================
// Types
//===========================

/** One label of the tree, as the count reports it. Ids deliberately absent: the renderer is
 * told how many, never which. */
export interface PurgeLabel {
  name: string;
  labelId: string;
  messages: number;
}

/** What a count answers. The handle is the only way back to the ids behind it. */
export interface PurgeCount {
  handle: string;
  email: string;
  label: string;
  labels: PurgeLabel[];
  total: number;
  /** True when the listing stopped at PURGE_LIST_MAX, so the counts are a floor and not a total */
  capped: boolean;
}

export interface PurgeOutcome {
  trashed: number;
  failed: number;
  /** Gmail's own message for the chunk that stopped it, absent when nothing stopped it */
  error?: string;
}

/** One label's listing, as the controller collected it. */
export interface CountedLabel {
  name: string;
  labelId: string;
  ids: string[];
}

export interface PurgeStore {
  /**
   * Remembers a counted listing and answers the counts plus the handle that names it
   *
   * Replaces whatever was held before. One at a time on purpose: a second listing means the
   * user asked a new question, and the old answer must stop being actionable at that moment.
   */
  put(arg: { email: string; label: string; byLabel: CountedLabel[]; capped: boolean }): PurgeCount;
  /**
   * The ids behind a handle, for the labels named
   *
   * Consumes the handle: one count buys one purge. Answers null for a handle this store does not
   * currently hold, which covers a second click, a stale window and a handle from a listing that
   * has since been replaced.
   */
  take(handle: string, labels: string[]): { email: string; ids: string[] } | null;
}


//===========================
// Constants
//===========================

/** Where a listing stops. Far past any real label -- fifty thousand ids is a hundred list pages
 * -- and here so that a page loop that never terminates cannot allocate without end. When it
 * bites, the count says so rather than quietly reporting a smaller label than there is. */
export const PURGE_LIST_MAX = 50_000;


//===========================
// Exported functions
//===========================

/**
 * Cuts an id list into the calls it will be sent in
 *
 * @param ids
 * @param size Gmail's own per-call limit, passed in rather than read from here so the caller's
 *   constant stays the single source of it
 * @returns one chunk per call, the last one short rather than padded, and nothing for nothing
 */
export function chunkIds(ids: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let at = 0; at < ids.length; at += size) out.push(ids.slice(at, at + size));
  return out;
}

/**
 * A store holding the one listing that may currently be purged
 *
 * @param newHandle injected so a test can name a handle, and so nothing here reaches for a
 *   random source of its own
 * @returns the store
 */
export function createPurgeStore(newHandle: () => string): PurgeStore {
  let held: { handle: string; email: string; byLabel: CountedLabel[] } | null = null;

  return {
    put({ email, label, byLabel, capped }): PurgeCount {
      const handle = newHandle();
      held = { handle, email, byLabel };
      return {
        handle,
        email,
        label,
        labels: byLabel.map((l) => ({ name: l.name, labelId: l.labelId, messages: l.ids.length })),
        total: byLabel.reduce((sum, l) => sum + l.ids.length, 0),
        capped,
      };
    },
    take(handle, labels): { email: string; ids: string[] } | null {
      if (!held || held.handle !== handle) return null;
      const wanted = new Set(labels);
      const ids = held.byLabel.filter((l) => wanted.has(l.name)).flatMap((l) => l.ids);
      const { email } = held;
      // Consumed whether or not the caller named anything this store knows: the question has
      // been answered, and answering it twice is what a double click looks like.
      held = null;
      return { email, ids };
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/label-purge.test.ts`
Expected: PASS.

Then: `npm test` and `npx tsc --noEmit -p tsconfig.json`
Expected: PASS, exit 0. Nothing imports this module yet.

- [ ] **Step 5: Commit**

```bash
git add electron/mail/label-purge.ts tests/label-purge.test.ts
git commit -m "feat(settings): what a label-emptying may act on, decided off the network

This app has never removed mail it did not create; every destructive path
it has works from a marker it applied itself. Emptying a label removes
mail from the mailbox holding the originals, so the one thing worth
making structurally true is that it can only act on ids somebody was
shown.

That is the handle: a count remembers its ids and answers a handle, the
purge takes the handle and nothing else. Mail arriving between the two
survives, an unknown handle is refused rather than re-derived, and take
consumes what it hands out so one count buys one purge.

Nothing imports this yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Counting and purging against Gmail

**Files:**
- Create: `electron/mail/label-purge-controller.ts`

**Interfaces:**
- Consumes: everything Task 1 produces; `labelTreeMembers` from `./label-tree`; `withMailboxToken` from `../auth/mailbox-token`; `fetchUserLabelMap`, `fetchMessageListPage`, `batchModifyMessages`, `BATCH_MODIFY_LIMIT` from `../gmail/gmail-api`; `notifyLog` from `../notify/notify-log`.
- Produces:
  - `export async function countLabelForPurge(email: string, label: string): Promise<PurgeCount | { error: string }>`
  - `export async function purgeCountedLabel(handle: string, labels: string[]): Promise<PurgeOutcome>`

**Why this is its own file and not part of `mail-drop-controller.ts`:** that file is past 2,700 lines and owns the drag, the pull and the copy. This shares two primitives with it and no state, so putting it there would only make the larger file larger.

- [ ] **Step 1: Write the module**

Create `electron/mail/label-purge-controller.ts`:

```ts
// The two halves of emptying a label: count what is there, then trash exactly that.
//
// Split in two because the destructive half must not be reachable without the other. The count
// puts its ids in the store (label-purge.ts) and hands back only numbers; the purge takes the
// handle. Nothing here asks Gmail what is under a label at purge time, which is what keeps mail
// that arrived in the meantime out of it.
//
// Trash and never delete: batchModify adding TRASH is reversible from Gmail for thirty days.
// messages.batchDelete is not used here and must not be added -- there is no flag, no setting and
// no caller that should be able to reach a permanent removal through this file.

import { randomUUID } from 'node:crypto';
import { withMailboxToken } from '../auth/mailbox-token';
import {
  BATCH_MODIFY_LIMIT,
  batchModifyMessages,
  fetchMessageListPage,
  fetchUserLabelMap,
} from '../gmail/gmail-api';
import { notifyLog } from '../notify/notify-log';
import { labelTreeMembers } from './label-tree';
import {
  PURGE_LIST_MAX,
  chunkIds,
  createPurgeStore,
  type CountedLabel,
  type PurgeCount,
  type PurgeOutcome,
} from './label-purge';


//===========================
// Constants
//===========================

const store = createPurgeStore(() => randomUUID());


//===========================
// Exported functions
//===========================

/**
 * Counts what emptying a label would remove, and remembers it
 *
 * The label and every label nested under it, each with its own count, so the tree is visible
 * rather than implied -- Gmail's nesting is naming and not containment, so a tool that lumped
 * them would delete more than its heading said and one that dropped them would leave mail behind
 * and call the label empty.
 *
 * @param email the mailbox, which must be one this app can already reach
 * @param label the label the user picked, by name
 * @returns the counts and a handle, or the reason it could not count
 */
export async function countLabelForPurge(
  email: string,
  label: string,
): Promise<PurgeCount | { error: string }> {
  const withToken = await withMailboxToken(email);
  if (!withToken) return { error: `Geen toegang tot ${email}` };

  try {
    // fetchUserLabelMap and not a raw label listing: it keeps only the mailbox's own labels and
    // drops this app's markers, which is what makes a system label unofferable rather than
    // merely declined.
    const all = await withToken((token) => fetchUserLabelMap(token));
    const members = labelTreeMembers([...all.keys()], label);
    if (members.length === 0) return { error: `Label "${label}" bestaat niet in ${email}` };

    const byLabel: CountedLabel[] = [];
    let seen = 0;
    let capped = false;
    for (const name of members) {
      const labelId = all.get(name);
      if (!labelId) continue;
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const page = await withToken((token) => fetchMessageListPage(token, labelId, pageToken));
        for (const id of page.ids) {
          if (seen >= PURGE_LIST_MAX) {
            capped = true;
            break;
          }
          ids.push(id);
          seen += 1;
        }
        pageToken = capped ? undefined : page.nextPageToken;
      } while (pageToken);
      byLabel.push({ name, labelId, ids });
      if (capped) break;
    }

    const count = store.put({ email, label, byLabel, capped });
    notifyLog(
      `[opruimen] ${email} label "${label}": ${count.total} bericht(en) over ${count.labels.length} label(s)${capped ? ', afgekapt' : ''}`,
    );
    return count;
  } catch (e) {
    return { error: `Tellen mislukt: ${(e as Error).message}` };
  }
}

/**
 * Moves the counted messages of the named labels to the trash
 *
 * Chunk after chunk rather than alongside each other: three calls are three calls, and serial is
 * what lets the answer say how far it got when one is refused.
 *
 * @param handle from the count this purge belongs to
 * @param labels the labels the user left ticked, by name
 * @returns how many were trashed and how many were not
 */
export async function purgeCountedLabel(handle: string, labels: string[]): Promise<PurgeOutcome> {
  const taken = store.take(handle, labels);
  if (!taken) {
    return { trashed: 0, failed: 0, error: 'Deze telling is verlopen. Tel opnieuw voordat je opruimt.' };
  }
  const { email, ids } = taken;
  if (ids.length === 0) return { trashed: 0, failed: 0 };

  const withToken = await withMailboxToken(email);
  if (!withToken) return { trashed: 0, failed: ids.length, error: `Geen toegang tot ${email}` };

  let trashed = 0;
  const chunks = chunkIds(ids, BATCH_MODIFY_LIMIT);
  for (const [at, chunk] of chunks.entries()) {
    try {
      await withToken((token) => batchModifyMessages(token, chunk, { addLabelIds: ['TRASH'] }));
      trashed += chunk.length;
    } catch (e) {
      const failed = ids.length - trashed;
      notifyLog(
        `[opruimen] ${email}: blok ${at + 1} van ${chunks.length} geweigerd, ${trashed} weg, ${failed} niet: ${(e as Error).message}`,
      );
      return { trashed, failed, error: (e as Error).message };
    }
  }
  notifyLog(`[opruimen] ${email}: ${trashed} bericht(en) naar de prullenbak`);
  return { trashed, failed: 0 };
}
```

- [ ] **Step 2: Verify**

Run: `npm test`
Expected: PASS, unchanged. This file has no unit test of its own: it is the network-facing half, and every test in this suite exercises pure functions. Do not add a mocked-HTTP test to manufacture a green check — the gate is the live run named at the end of this plan.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0. If `fetchMessageListPage`'s third parameter or `BATCH_MODIFY_LIMIT`'s name differs from the plan, the type checker is right and the plan is stale — read `electron/gmail/gmail-api.ts` and follow the code.

- [ ] **Step 3: Commit**

```bash
git add electron/mail/label-purge-controller.ts
git commit -m "feat(settings): count a label's messages, then trash exactly those

Two halves, split so the destructive one cannot be reached without the
other: the count puts its ids in the store and hands back only numbers,
the purge takes the handle. Nothing asks Gmail what is under the label at
purge time, which is what keeps mail that arrived in the meantime out of
it.

Chunks go one after another so the answer can say how far it got when one
is refused. Trash only -- batchDelete is not imported here and must not
be.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The two IPC calls

**Files:**
- Modify: `electron/core/ipc.ts` — two channel names
- Modify: `electron/core/ipc-handlers.ts` — two handlers
- Modify: `electron/sidebar-preload.ts` — two methods on `window.desktop`

**Interfaces:**
- Consumes: `countLabelForPurge`, `purgeCountedLabel` from Task 2.
- Produces:
  - `IPC.LABEL_PURGE_COUNT = 'label:purge-count'` and `IPC.LABEL_PURGE_RUN = 'label:purge-run'`
  - `window.desktop.countLabelPurge(email, label)` and `window.desktop.runLabelPurge(handle, labels)`

- [ ] **Step 1: Add the channels**

In `electron/core/ipc.ts`, beside the other request/response channels:

```ts
  LABEL_PURGE_COUNT: 'label:purge-count',
  LABEL_PURGE_RUN: 'label:purge-run',
```

- [ ] **Step 2: Add the handlers**

In `electron/core/ipc-handlers.ts`, following the shape of the existing `ipcMain.handle` calls, and adding both names to the existing import block:

```ts
  ipcMain.handle(IPC.LABEL_PURGE_COUNT, (_e, arg: { email: string; label: string }) =>
    countLabelForPurge(arg.email, arg.label),
  );
  ipcMain.handle(IPC.LABEL_PURGE_RUN, (_e, arg: { handle: string; labels: string[] }) =>
    purgeCountedLabel(arg.handle, arg.labels),
  );
```

`handle` and not `on`: both answer something the renderer waits for, unlike `SET_ADVANCED` which is fire-and-forget.

- [ ] **Step 3: Expose them**

In `electron/sidebar-preload.ts`, beside `setAdvanced` (around line 90):

```ts
  countLabelPurge: (
    email: string,
    label: string,
  ): Promise<
    | {
        handle: string;
        email: string;
        label: string;
        labels: { name: string; labelId: string; messages: number }[];
        total: number;
        capped: boolean;
      }
    | { error: string }
  > => ipcRenderer.invoke(IPC.LABEL_PURGE_COUNT, { email, label }),
  runLabelPurge: (
    handle: string,
    labels: string[],
  ): Promise<{ trashed: number; failed: number; error?: string }> =>
    ipcRenderer.invoke(IPC.LABEL_PURGE_RUN, { handle, labels }),
```

The shapes are written out rather than imported, the way every other method in this file does it: the preload is a boundary and the renderer cannot import from `electron/`.

- [ ] **Step 4: Verify**

Run: `npm test`, then both tsc projects.
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add electron/core/ipc.ts electron/core/ipc-handlers.ts electron/sidebar-preload.ts
git commit -m "feat(settings): expose counting and purging a label to the renderer

Two invoke channels rather than sends: both answer something the panel
waits for. The shapes are written out in the preload the way every other
method there does it, since the renderer cannot import from electron/.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The settings section

**Files:**
- Create: `renderer/app/settings/LabelCleanupSection.tsx`
- Modify: `renderer/app/settings/nav.ts` — the section id
- Modify: `renderer/app/SettingsPanel.tsx` — the two switches over the section id
- Modify: `renderer/app/strings.ts` — the strings, in both language blocks

**Interfaces:**
- Consumes: `window.desktop.countLabelPurge` and `window.desktop.runLabelPurge` from Task 3; `window.desktop.getLabels()`, which already exists (`electron/sidebar-preload.ts:128`) and answers `{ accounts: AccountLabels[] }` from `labelsForCopyTargets`. Do not add a second channel for it.
- Produces: `SettingsSection` gains `'label-cleanup'`.

- [ ] **Step 1: Add the section id**

In `renderer/app/settings/nav.ts`, add `| 'label-cleanup'` to `SettingsSection` and put `'label-cleanup'` in `SETTINGS_GROUPS`'s second group, directly after `'advanced'`.

- [ ] **Step 2: Add the strings**

In `renderer/app/strings.ts`, add to the `UiStrings` interface and then to **both** the English and the Dutch object — the file carries a complete set per language and a missing key fails the type check:

```ts
  navLabelCleanup: string;
  labelCleanupIntro: string;
  labelCleanupMailbox: string;
  labelCleanupLabel: string;
  labelCleanupCount: string;
  labelCleanupCounting: string;
  labelCleanupNothing: string;
  labelCleanupCapped: string;
  labelCleanupTrashNote: string;
```

English values:

```ts
  navLabelCleanup: 'Clear a label',
  labelCleanupIntro: 'Moves every message under a label to the trash. The label itself stays.',
  labelCleanupMailbox: 'Mailbox',
  labelCleanupLabel: 'Label',
  labelCleanupCount: 'Count what is in it',
  labelCleanupCounting: 'Counting…',
  labelCleanupNothing: 'Nothing under this label.',
  labelCleanupCapped: 'Stopped counting at 50,000; there are more.',
  labelCleanupTrashNote: 'The trash is not final: Gmail keeps it for another 30 days.',
```

Dutch values:

```ts
  navLabelCleanup: 'Label leegmaken',
  labelCleanupIntro: 'Verplaatst alle berichten onder een label naar de prullenbak. Het label zelf blijft bestaan.',
  labelCleanupMailbox: 'Postvak',
  labelCleanupLabel: 'Label',
  labelCleanupCount: 'Tel wat erin zit',
  labelCleanupCounting: 'Aan het tellen…',
  labelCleanupNothing: 'Er staat niets onder dit label.',
  labelCleanupCapped: 'Gestopt met tellen bij 50.000; er zijn er meer.',
  labelCleanupTrashNote: 'De prullenbak is niet definitief: Gmail bewaart het daar nog 30 dagen.',
```

The confirming button's text is built in the component, not a string here, because it carries the number: `` `Verplaats ${total.toLocaleString('nl-NL')} berichten naar de prullenbak` ``. That number on the control is the guard — the same thing the mail-drop stop dialog does — so it must not become a fixed string.

- [ ] **Step 3: Write the section**

Create `renderer/app/settings/LabelCleanupSection.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { HINT } from './tokens';

interface PurgeLabel {
  name: string;
  labelId: string;
  messages: number;
}

interface Counted {
  handle: string;
  email: string;
  label: string;
  labels: PurgeLabel[];
  total: number;
  capped: boolean;
}

interface Mailbox {
  email: string;
  labels: { id: string; name: string }[];
}

/**
 * Empties a label in one mailbox, in two deliberate steps
 *
 * Count first, then purge what was counted. The second step sends only the handle the count
 * answered, so what goes away is what was on screen rather than whatever is under the label by
 * the time the button is pressed.
 */
export function LabelCleanupSection({ S }: { S: UiStrings }) {
  const [boxes, setBoxes] = useState<Mailbox[]>([]);
  const [email, setEmail] = useState('');
  const [label, setLabel] = useState('');
  const [counted, setCounted] = useState<Counted | null>(null);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<'' | 'counting' | 'purging'>('');
  const [said, setSaid] = useState('');

  useEffect(() => {
    void (window.desktop as unknown as {
      labelsForCopyTargets?: () => Promise<{ accounts: Mailbox[] }>;
    })
      .labelsForCopyTargets?.()
      .then((r) => setBoxes(r?.accounts ?? []))
      .catch(() => setBoxes([]));
  }, []);

  // Any change of mailbox or label makes the count stale, and a stale count must not be
  // purgeable: dropping it here is what keeps the button honest about what it would remove.
  const forget = () => {
    setCounted(null);
    setSaid('');
  };

  const count = async () => {
    setBusy('counting');
    setSaid('');
    const answer = await (window.desktop as unknown as {
      countLabelPurge: (e: string, l: string) => Promise<Counted | { error: string }>;
    }).countLabelPurge(email, label);
    setBusy('');
    if ('error' in answer) {
      setSaid(answer.error);
      return;
    }
    setCounted(answer);
    setTicked(Object.fromEntries(answer.labels.map((l) => [l.name, true])));
  };

  const purge = async () => {
    if (!counted) return;
    setBusy('purging');
    const names = counted.labels.filter((l) => ticked[l.name]).map((l) => l.name);
    const outcome = await (window.desktop as unknown as {
      runLabelPurge: (h: string, l: string[]) => Promise<{ trashed: number; failed: number; error?: string }>;
    }).runLabelPurge(counted.handle, names);
    setBusy('');
    setCounted(null);
    setSaid(
      outcome.error
        ? `${outcome.trashed} verplaatst, ${outcome.failed} niet: ${outcome.error}`
        : `${outcome.trashed} bericht(en) naar de prullenbak.`,
    );
  };

  const chosen = counted?.labels.filter((l) => ticked[l.name]) ?? [];
  const total = chosen.reduce((sum, l) => sum + l.messages, 0);

  return (
    <Section title={S.navLabelCleanup}>
      <SettingsGroup>
        <p className={`max-w-[60ch] ${HINT}`}>{S.labelCleanupIntro}</p>

        <label className="mt-3 block text-sm">
          {S.labelCleanupMailbox}
          <select
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setLabel('');
              forget();
            }}
            className="mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-neutral-900"
          >
            <option value="">—</option>
            {boxes.map((b) => (
              <option key={b.email} value={b.email}>
                {b.email}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-3 block text-sm">
          {S.labelCleanupLabel}
          <select
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              forget();
            }}
            disabled={!email}
            className="mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm disabled:opacity-50 dark:border-white/15 dark:bg-neutral-900"
          >
            <option value="">—</option>
            {(boxes.find((b) => b.email === email)?.labels ?? []).map((l) => (
              <option key={l.id} value={l.name}>
                {l.name}
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={() => void count()}
          disabled={!email || !label || busy !== ''}
          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {busy === 'counting' ? S.labelCleanupCounting : S.labelCleanupCount}
        </button>
      </SettingsGroup>

      {counted && (
        <SettingsGroup>
          {counted.total === 0 ? (
            <p className={HINT}>{S.labelCleanupNothing}</p>
          ) : (
            <>
              {/* One line per label of the tree, because Gmail's nesting is naming and not
                  containment: lumping them would remove more than the heading says, and
                  dropping them would leave mail behind and call the label empty. */}
              <ul className="flex flex-col gap-1">
                {counted.labels.map((l) => (
                  <li key={l.name} className="text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={ticked[l.name] ?? false}
                        onChange={(e) => setTicked({ ...ticked, [l.name]: e.target.checked })}
                      />
                      <span className="font-medium">{l.name}</span>
                      <span className={HINT}>
                        {l.messages.toLocaleString('nl-NL')} bericht(en)
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {counted.capped && <p className={`mt-2 ${HINT}`}>{S.labelCleanupCapped}</p>}
              <button
                onClick={() => void purge()}
                disabled={total === 0 || busy !== ''}
                className="mt-4 rounded-lg px-4 py-2 text-left text-sm font-medium text-amber-700 transition hover:bg-amber-500/10 disabled:opacity-50 dark:text-amber-500"
              >
                Verplaats {total.toLocaleString('nl-NL')} berichten naar de prullenbak
              </button>
              <p className={`mt-2 ${HINT}`}>{S.labelCleanupTrashNote}</p>
            </>
          )}
        </SettingsGroup>
      )}

      {said && <SettingsGroup><p className="text-sm">{said}</p></SettingsGroup>}
    </Section>
  );
}
```

- [ ] **Step 4: Render it**

In `renderer/app/SettingsPanel.tsx` there are two switches over the section id — one returning the component (around line 151) and one returning the section title (around line 225, where `case 'advanced': return S.navAdvanced;` sits). Add to the first `case 'label-cleanup': return <LabelCleanupSection S={S} />;` and to the second `case 'label-cleanup': return S.navLabelCleanup;`. Import the component beside the other section imports.

- [ ] **Step 5: Verify**

Run: `npm test`, then `npx tsc --noEmit -p tsconfig.json`, then `npx tsc --noEmit -p renderer/tsconfig.json`.
Expected: PASS and exit 0 twice. `tests/settings-nav.test.ts` asserts over the section list — if it counts sections or checks the groups, it will need the new id and that is a real change to make, not a failure to work around.

Then check for a `labelsForCopyTargets` on the preload: the section calls it, and if `window.desktop` does not expose it the dropdown will simply be empty. If it is missing, expose it the same way Task 3 exposed its two, using the existing `IPC.MAIL_DROP_LABELS_GET`-style channel if one exists — read `electron/core/ipc.ts` for the channel the maildrop picker already uses.

- [ ] **Step 6: Commit**

```bash
git add renderer/app/settings/LabelCleanupSection.tsx renderer/app/settings/nav.ts renderer/app/SettingsPanel.tsx renderer/app/strings.ts
git commit -m "feat(settings): a section for emptying a label

Its own section rather than a group inside Advanced: a button that
trashes thousands of messages must not sit on the same scroll as the
hardware-acceleration switch.

Count first, then purge what was counted, sending only the handle -- so
what goes away is what was on screen. Changing mailbox or label drops the
count, because a stale one must not be purgeable. One tickable line per
label of the tree, since Gmail's nesting is naming and not containment,
and the number rides on the button itself as the guard.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## After the plan

The gate is one live run, and it is also the cleanup the mailbox owner is waiting on: `test` in `luca.manuel@abovomaxlead.nl`, 2,620 under `test` and 99 under `test/test123`, both already copied into `support@`.

What that run should show:

- Both labels listed with those two numbers. If only `test` appears with 2,620, the tree resolution is not being reached and the 99 would be left behind.
- `[opruimen]` lines in `notify.log` for the count and for the result.
- Three `batchModify` calls' worth of work, finishing in seconds rather than minutes — if it takes minutes, something is trashing one message per call.
- The two labels still present in Gmail afterwards, empty.
- The mail in Gmail's own trash, recoverable.

Then press the purge button a second time on the same count: it must refuse with the expired-count message rather than doing anything. That is the handle's whole purpose and it is worth one deliberate try.
