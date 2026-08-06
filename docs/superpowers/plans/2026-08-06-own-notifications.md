# Own Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every Windows toast the app raises with one always-on-top window we draw ourselves — five stacked cards, then a counting summary, staying until dismissed, with archive and mark-read on hover.

**Architecture:** A pure reducer (`toast-model`) decides what the stack contains and a pure layout module (`toast-layout`) decides where the window goes; neither imports Electron, so both are unit-tested. A `ToastWindow` class owns one lazily created frameless, transparent, non-focusable `BrowserWindow` — modelled on the existing `OverlayView` — and a `ToastController` holds the stack, pushes it to that window, and routes clicks back into main's existing handlers. The card itself is a Next static-export route (`renderer/app/toasts/page.tsx`), exactly as `compose-account`, `reconnect` and `maildrop` already are.

**Tech Stack:** Electron 3x (`BrowserWindow`, `screen`), TypeScript strict, Next.js 15 static export + Tailwind for the page, vitest for tests, esbuild for the main bundle.

## Global Constraints

- **All committed text is English** — code comments, doc comments, commit messages, this plan's code. The one exception is `CHANGELOG.md`, which is user-facing Dutch release copy and stays Dutch (Task 10).
- **UI strings live in three sets** in `renderer/app/strings.ts`: `STRINGS_NORMAL` (en), `STRINGS_NL` (nl), `STRINGS_RENE` (simple Dutch). `tests/strings-sets.test.ts` fails if the three sets do not carry identical keys, if any value is empty, or if a Dutch value equals its English one without being in the `SAME_IN_BOTH` allowlist. Every new key needs all three.
- **Card width is 380 CSS pixels**, margin from the screen edge is **16 px**, max cards before collapsing is **5**, auto-hide lifetime for non-persist toasts is **6000 ms**. These exact numbers appear in code below; do not round them differently in two places.
- **Run tests with** `npx vitest run tests/<file>.test.ts` for one file, `npm test` for all 80 files / 987 tests. Both are green at the start of this plan.
- **Typecheck with** `npx tsc --noEmit` from the repo root. It covers `electron/`, `src/` and `tests/` and excludes `renderer/`. It is clean at the start of this plan.
- **The renderer typechecks separately** via `npm run build:renderer`.
- **Dark variants are inert in window pages.** `renderer/app/compose-account/page.tsx` documents this: `darkMode` is class-based and the class is only toggled on the main document, so these pages always render light. Do not add `dark:` classes to the toast card expecting them to work.
- **Never construct `new Notification(...)` in new code** except the one deliberate fallback in Task 6.

## File Structure

| File | Responsibility |
| --- | --- |
| `renderer/lib/toast.ts` | **Create.** Types shared by main, the page and the bridge |
| `electron/toast-model.ts` | **Create.** Pure stack reducer: add, dismiss, expire, collapse |
| `electron/toast-layout.ts` | **Create.** Pure geometry: bottom-right anchoring, zoom, clamping |
| `electron/toast-window.ts` | **Create.** The one `BrowserWindow`: create, size, position, hide |
| `electron/toast-controller.ts` | **Create.** Holds the stack, drives the window, owns the expiry timer |
| `renderer/app/toasts/page.tsx` | **Create.** The cards → `toasts.html` |
| `tests/toast-model.test.ts` | **Create.** Reducer tests |
| `tests/toast-layout.test.ts` | **Create.** Geometry tests |
| `electron/ipc.ts` | **Modify.** Nine new channels; `NotifyState` loses three fields |
| `electron/sidebar-preload.ts` | **Modify.** Seven bridge methods for the toast page |
| `renderer/app/page.tsx` | **Modify.** The same seven on the `DesktopBridge` type |
| `electron/main.ts` | **Modify.** Five call sites, the controller, `withTokenFor`, `refreshNotifyAllowed` |
| `electron/preload.ts` | **Modify.** Relay page notifications to main instead of constructing them |
| `electron/notification-policy.ts` | **Modify.** `notificationPersist` default inverts |
| `renderer/app/settings/NotificationsSection.tsx` | **Modify.** Persist column polarity + header comment |
| `renderer/app/strings.ts` | **Modify.** Five new keys × three sets, persist copy rewritten |
| `tests/notification-policy.test.ts` | **Modify.** Persist default cases |
| `tests/preload-notification-options.test.ts` | **Delete.** The function it covers goes away |
| `CHANGELOG.md` | **Modify.** Dutch release note |

---

### Task 1: The stack model

The reducer that decides what is on screen. Pure, no Electron, no timers — it is handed a `now` and returns a new stack.

**Files:**
- Create: `renderer/lib/toast.ts`
- Create: `electron/toast-model.ts`
- Test: `tests/toast-model.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ToastKind`, `ToastAccount`, `Toast`, `ToastSummary`, `ToastStack`, `ToastState` from `renderer/lib/toast`; `MAX_CARDS`, `EMPTY_STACK`, `addToast`, `dismissToast`, `dismissAll`, `expireToasts`, `delayExpiries`, `collapse`, `stackCount` from `electron/toast-model`.

- [ ] **Step 1: Create the shared types**

Create `renderer/lib/toast.ts`:

```ts
// Types shared between main, the toast page and the preload bridge, in renderer/lib for
// the same reason compose-account.ts is: main imports from here, the page imports from
// here, and neither has to reach into the other's tree. A toast with no `expiresAt` stays
// until it is dismissed, which is the default; the field is only set for accounts whose
// per-account persist switch is off. `account` is absent on the toasts that belong to the
// app rather than to a mailbox — an update, a finished download, a failed account link —
// and those never carry actions. `messageId` is what the archive and mark-read buttons
// need, so it is present only on push-sourced mail, where main got it from the Gmail API;
// a notification relayed from the Gmail page knows its subject but not its message id.
// Such a relayed one carries `webNotifyId` instead: the id the page gave it, which a click
// has to travel back with, because only that page still holds the subject the thread
// lookup matches against.

export type ToastKind = 'mail' | 'update' | 'download' | 'error' | 'test';

export interface ToastAccount {
  /** The account key activateNotification expects, not the address. */
  key: string;
  email: string;
  label: string;
  color: string;
  avatarUrl: string;
}

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  body: string;
  account?: ToastAccount;
  threadId?: string;
  messageId?: string;
  /** The page-side id of a notification relayed from a Gmail view. */
  webNotifyId?: string;
  /** Epoch ms. Absent means it stays until dismissed. */
  expiresAt?: number;
}

export interface ToastSummary {
  count: number;
  /** The account every collapsed toast came from, or null when they were mixed. */
  accountKey: string | null;
}

export interface ToastStack {
  toasts: Toast[];
  summary: ToastSummary | null;
}

export interface ToastState extends ToastStack {
  locale: 'en' | 'nl';
  reneMode: boolean;
}

export type ToastAction = 'archive' | 'read';
```

- [ ] **Step 2: Write the failing tests**

Create `tests/toast-model.test.ts`:

```ts
// The stack reducer. The one rule worth stating twice: a sixth arrival does not add a
// sixth card, it removes the five and leaves a number, and that number keeps climbing
// for as long as mail keeps coming.

import { describe, expect, it } from 'vitest';
import {
  EMPTY_STACK,
  MAX_CARDS,
  addToast,
  collapse,
  delayExpiries,
  dismissAll,
  dismissToast,
  expireToasts,
  stackCount,
} from '../electron/toast-model';
import type { Toast, ToastStack } from '../renderer/lib/toast';

function mail(id: string, accountKey = 'a1', expiresAt?: number): Toast {
  return {
    id,
    kind: 'mail',
    title: `Sender ${id}`,
    body: `Subject ${id}`,
    account: {
      key: accountKey,
      email: `${accountKey}@example.com`,
      label: accountKey,
      color: '#4285f4',
      avatarUrl: '',
    },
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

function withMails(count: number, accountKey = 'a1'): ToastStack {
  let stack = EMPTY_STACK;
  for (let i = 1; i <= count; i += 1) stack = addToast(stack, mail(`m${i}`, accountKey));
  return stack;
}

describe('addToast', () => {
  it('stacks up to five cards', () => {
    const stack = withMails(MAX_CARDS);
    expect(stack.toasts).toHaveLength(5);
    expect(stack.summary).toBeNull();
  });

  it('puts the newest card last', () => {
    const stack = withMails(3);
    expect(stack.toasts.map((t) => t.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('collapses the whole stack when a sixth arrives', () => {
    const stack = withMails(6);
    expect(stack.toasts).toEqual([]);
    expect(stack.summary).toEqual({ count: 6, accountKey: 'a1' });
  });

  it('keeps counting once collapsed', () => {
    let stack = withMails(6);
    stack = addToast(stack, mail('m7'));
    stack = addToast(stack, mail('m8'));
    expect(stack.summary?.count).toBe(8);
    expect(stack.toasts).toEqual([]);
  });

  it('remembers the account when every collapsed toast came from one', () => {
    expect(withMails(6, 'work').summary?.accountKey).toBe('work');
  });

  it('forgets the account when the collapsed toasts are mixed', () => {
    let stack = withMails(5, 'work');
    stack = addToast(stack, mail('m6', 'home'));
    expect(stack.summary?.accountKey).toBeNull();
  });

  it('forgets the account when a later arrival is from another one', () => {
    let stack = withMails(6, 'work');
    stack = addToast(stack, mail('m7', 'home'));
    expect(stack.summary).toEqual({ count: 7, accountKey: null });
  });

  it('forgets the account when a collapsed toast has none', () => {
    let stack = withMails(5, 'work');
    stack = addToast(stack, { id: 'u1', kind: 'update', title: 'Update', body: '0.3.0' });
    expect(stack.summary).toEqual({ count: 6, accountKey: null });
  });
});

describe('dismissToast', () => {
  it('removes one card and leaves the rest', () => {
    const stack = dismissToast(withMails(3), 'm2');
    expect(stack.toasts.map((t) => t.id)).toEqual(['m1', 'm3']);
  });

  it('ignores an id that is not in the stack', () => {
    const before = withMails(2);
    expect(dismissToast(before, 'nope')).toEqual(before);
  });

  it('does nothing to a collapsed stack', () => {
    const before = withMails(6);
    expect(dismissToast(before, 'm1')).toEqual(before);
  });
});

describe('dismissAll', () => {
  it('empties a stack of cards', () => {
    expect(dismissAll(withMails(3))).toEqual(EMPTY_STACK);
  });

  it('clears the summary', () => {
    expect(dismissAll(withMails(6))).toEqual(EMPTY_STACK);
  });
});

describe('expireToasts', () => {
  it('drops the toasts whose time has passed', () => {
    let stack = addToast(EMPTY_STACK, mail('a', 'a1', 1000));
    stack = addToast(stack, mail('b', 'a1', 3000));
    expect(expireToasts(stack, 2000).toasts.map((t) => t.id)).toEqual(['b']);
  });

  it('drops one exactly at its expiry', () => {
    const stack = addToast(EMPTY_STACK, mail('a', 'a1', 2000));
    expect(expireToasts(stack, 2000).toasts).toEqual([]);
  });

  it('leaves the toasts that have no expiry', () => {
    const stack = withMails(3);
    expect(expireToasts(stack, 9_999_999).toasts).toHaveLength(3);
  });

  it('never expires the summary', () => {
    const stack = withMails(6);
    expect(expireToasts(stack, 9_999_999)).toEqual(stack);
  });

  it('returns the same object when nothing expired', () => {
    const stack = withMails(3);
    expect(expireToasts(stack, 9_999_999)).toBe(stack);
  });
});

describe('delayExpiries', () => {
  it('pushes every expiry forward by the paused time', () => {
    let stack = addToast(EMPTY_STACK, mail('a', 'a1', 1000));
    stack = addToast(stack, mail('b', 'a1', 3000));
    const out = delayExpiries(stack, 500);
    expect(out.toasts.map((t) => t.expiresAt)).toEqual([1500, 3500]);
  });

  it('leaves the toasts that have no expiry alone', () => {
    const out = delayExpiries(withMails(2), 500);
    expect(out.toasts.every((t) => t.expiresAt === undefined)).toBe(true);
  });
});

describe('collapse', () => {
  it('folds two or more cards into a summary', () => {
    expect(collapse(withMails(3)).summary).toEqual({ count: 3, accountKey: 'a1' });
  });

  it('leaves a single card alone', () => {
    const before = withMails(1);
    expect(collapse(before)).toBe(before);
  });

  it('leaves an already collapsed stack alone', () => {
    const before = withMails(6);
    expect(collapse(before)).toBe(before);
  });
});

describe('stackCount', () => {
  it('counts the cards', () => {
    expect(stackCount(withMails(3))).toBe(3);
  });

  it('reports the summary count', () => {
    expect(stackCount(withMails(7))).toBe(7);
  });

  it('is zero when empty', () => {
    expect(stackCount(EMPTY_STACK)).toBe(0);
  });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `npx vitest run tests/toast-model.test.ts`
Expected: FAIL — `Failed to resolve import "../electron/toast-model"`.

- [ ] **Step 4: Write the reducer**

Create `electron/toast-model.ts`:

```ts
// What the stack contains, as a pure function of what it contained and what arrived.
// Every function returns a new stack, or the same object when it changed nothing, so a
// caller can skip a re-render on identity. Time is a parameter, never Date.now(), which
// is what makes expiry testable.
//
// Collapsing is deliberately all-or-nothing: a sixth arrival does not push a "+1 more"
// row under five cards, it replaces them with a single number. Five cards is already the
// most that can arrive without the corner of the screen becoming a wall, and past that
// the useful information is the count, not the five oldest senders. The summary keeps the
// account key only while every toast behind it came from the same mailbox, because that
// is the only case where clicking it can sensibly pick one.

import type { Toast, ToastStack, ToastSummary } from '../renderer/lib/toast';

export const MAX_CARDS = 5;

export const EMPTY_STACK: ToastStack = { toasts: [], summary: null };

function sharedAccountKey(toasts: Toast[]): string | null {
  const first = toasts[0]?.account?.key ?? null;
  if (first === null) return null;
  return toasts.every((t) => t.account?.key === first) ? first : null;
}

function summarise(toasts: Toast[]): ToastSummary {
  return { count: toasts.length, accountKey: sharedAccountKey(toasts) };
}

/** Adds a toast, collapsing the stack into a counting summary past MAX_CARDS. */
export function addToast(stack: ToastStack, toast: Toast): ToastStack {
  if (stack.summary) {
    const sameAccount =
      stack.summary.accountKey !== null && stack.summary.accountKey === toast.account?.key;
    return {
      toasts: [],
      summary: {
        count: stack.summary.count + 1,
        accountKey: sameAccount ? stack.summary.accountKey : null,
      },
    };
  }
  const toasts = [...stack.toasts, toast];
  if (toasts.length > MAX_CARDS) return { toasts: [], summary: summarise(toasts) };
  return { toasts, summary: null };
}

/** Removes one card. A collapsed stack has no cards to remove, so it is left as it is. */
export function dismissToast(stack: ToastStack, id: string): ToastStack {
  if (stack.summary) return stack;
  const toasts = stack.toasts.filter((t) => t.id !== id);
  if (toasts.length === stack.toasts.length) return stack;
  return { toasts, summary: null };
}

/** Clears everything, cards or summary alike. */
export function dismissAll(_stack: ToastStack): ToastStack {
  return EMPTY_STACK;
}

/** Drops the cards that have reached their expiry. The summary never expires. */
export function expireToasts(stack: ToastStack, now: number): ToastStack {
  if (stack.summary) return stack;
  const toasts = stack.toasts.filter((t) => t.expiresAt === undefined || t.expiresAt > now);
  if (toasts.length === stack.toasts.length) return stack;
  return { toasts, summary: null };
}

/** Pushes every expiry forward, which is how a hover pauses the countdown. */
export function delayExpiries(stack: ToastStack, ms: number): ToastStack {
  if (stack.summary || ms <= 0) return stack;
  return {
    toasts: stack.toasts.map((t) =>
      t.expiresAt === undefined ? t : { ...t, expiresAt: t.expiresAt + ms },
    ),
    summary: null,
  };
}

/** Forces a collapse the arrival count did not trigger — the stack outgrew the screen. */
export function collapse(stack: ToastStack): ToastStack {
  if (stack.summary || stack.toasts.length < 2) return stack;
  return { toasts: [], summary: summarise(stack.toasts) };
}

/** How many notifications the stack stands for, collapsed or not. */
export function stackCount(stack: ToastStack): number {
  return stack.summary ? stack.summary.count : stack.toasts.length;
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run tests/toast-model.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add renderer/lib/toast.ts electron/toast-model.ts tests/toast-model.test.ts
git commit -m "feat: the notification stack model"
```

---

### Task 2: Where the stack goes

Pure geometry. Screen coordinates in, window bounds out — no `screen` module, so it can be tested against a second monitor at a negative x without one.

**Files:**
- Create: `electron/toast-layout.ts`
- Test: `tests/toast-layout.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ToastRect`, `TOAST_MARGIN`, `TOAST_WIDTH`, `toastWindowBounds(workArea, cssSize, zoom)`, `exceedsWorkArea(workArea, cssHeight, zoom)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/toast-layout.test.ts`:

```ts
// Where the stack window sits. Work areas do not start at the origin — a second monitor
// left of the primary one has a negative x — so every assertion here anchors to the work
// area it is given rather than to the screen size.

import { describe, expect, it } from 'vitest';
import { TOAST_MARGIN, exceedsWorkArea, toastWindowBounds } from '../electron/toast-layout';

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };

describe('toastWindowBounds', () => {
  it('anchors to the bottom-right corner with a margin on both edges', () => {
    const b = toastWindowBounds(PRIMARY, { width: 380, height: 240 }, 1);
    expect(b).toEqual({ x: 1920 - 380 - TOAST_MARGIN, y: 1040 - 240 - TOAST_MARGIN, width: 380, height: 240 });
  });

  it('follows a work area that does not start at the origin', () => {
    const left = { x: -1920, y: -120, width: 1920, height: 1080 };
    const b = toastWindowBounds(left, { width: 380, height: 240 }, 1);
    expect(b.x).toBe(-1920 + 1920 - 380 - TOAST_MARGIN);
    expect(b.y).toBe(-120 + 1080 - 240 - TOAST_MARGIN);
  });

  it('multiplies the measured size by the zoom factor', () => {
    const b = toastWindowBounds(PRIMARY, { width: 380, height: 240 }, 2);
    expect(b.width).toBe(760);
    expect(b.height).toBe(480);
    expect(b.x).toBe(1920 - 760 - TOAST_MARGIN);
  });

  it('rounds a fractional zoom rather than passing a float to setBounds', () => {
    const b = toastWindowBounds(PRIMARY, { width: 380, height: 101 }, 1.25);
    expect(Number.isInteger(b.width)).toBe(true);
    expect(Number.isInteger(b.height)).toBe(true);
    expect(b.height).toBe(126);
  });

  it('clamps a stack taller than the work area allows', () => {
    const b = toastWindowBounds(PRIMARY, { width: 380, height: 4000 }, 1);
    expect(b.height).toBe(1040 - TOAST_MARGIN * 2);
    expect(b.y).toBe(TOAST_MARGIN);
  });

  it('never returns a zero or negative size', () => {
    const b = toastWindowBounds(PRIMARY, { width: 0, height: 0 }, 1);
    expect(b.width).toBeGreaterThan(0);
    expect(b.height).toBeGreaterThan(0);
  });
});

describe('exceedsWorkArea', () => {
  it('is false for a stack that fits', () => {
    expect(exceedsWorkArea(PRIMARY, 300, 1)).toBe(false);
  });

  it('is false at exactly the fit', () => {
    expect(exceedsWorkArea(PRIMARY, 1040 - TOAST_MARGIN * 2, 1)).toBe(false);
  });

  it('is true one pixel past the fit', () => {
    expect(exceedsWorkArea(PRIMARY, 1040 - TOAST_MARGIN * 2 + 1, 1)).toBe(true);
  });

  it('counts the zoom factor, so Rene mode collapses sooner', () => {
    expect(exceedsWorkArea(PRIMARY, 600, 1)).toBe(false);
    expect(exceedsWorkArea(PRIMARY, 600, 2)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run tests/toast-layout.test.ts`
Expected: FAIL — `Failed to resolve import "../electron/toast-layout"`.

- [ ] **Step 3: Write the geometry**

Create `electron/toast-layout.ts`:

```ts
// Where the stack window goes. Split from toast-window.ts so it can be tested without a
// display: a second monitor left of the primary one has a negative x, and getting that
// wrong puts the toasts off screen for exactly the people who would not think to report
// it. Sizes arrive in CSS pixels because that is what the page can measure, and are
// multiplied by the zoom factor actually in effect — Rene mode doubles the whole UI, and
// a window sized to the unzoomed measurement would clip every card in half.

export interface ToastRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Gap between the stack and the screen edges, on both axes. */
export const TOAST_MARGIN = 16;

/** The card width the page lays out to, in CSS pixels. */
export const TOAST_WIDTH = 380;

function usableHeight(workArea: ToastRect): number {
  return Math.max(1, workArea.height - TOAST_MARGIN * 2);
}

/** Bottom-right of the work area, sized to what the page measured, clamped to what fits. */
export function toastWindowBounds(
  workArea: ToastRect,
  cssSize: { width: number; height: number },
  zoom: number,
): ToastRect {
  const width = Math.max(1, Math.round(cssSize.width * zoom));
  const height = Math.max(1, Math.min(Math.round(cssSize.height * zoom), usableHeight(workArea)));
  return {
    x: workArea.x + workArea.width - width - TOAST_MARGIN,
    y: workArea.y + workArea.height - height - TOAST_MARGIN,
    width,
    height,
  };
}

/** True when a stack this tall would not fit, which is a second reason to collapse it. */
export function exceedsWorkArea(workArea: ToastRect, cssHeight: number, zoom: number): boolean {
  return Math.round(cssHeight * zoom) > usableHeight(workArea);
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run tests/toast-layout.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/toast-layout.ts tests/toast-layout.test.ts
git commit -m "feat: bottom-right geometry for the toast stack"
```

---

### Task 3: Channels and the bridge

Wiring only — no behaviour yet. Doing it in one task keeps the next two from each half-defining the same channel names.

**Files:**
- Modify: `electron/ipc.ts:11-81` (the `IPC` object) and `electron/ipc.ts:132-138` (`NotifyState`)
- Modify: `electron/sidebar-preload.ts:128-135` (after the compose-account block)
- Modify: `renderer/app/page.tsx:237-240` (end of `DesktopBridge`)

**Interfaces:**
- Consumes: `ToastState`, `ToastAction` from Task 1.
- Produces: `IPC.TOAST_STATE`, `IPC.TOAST_SIZE`, `IPC.TOAST_ACTIVATE`, `IPC.TOAST_DISMISS`, `IPC.TOAST_DISMISS_ALL`, `IPC.TOAST_ACTION`, `IPC.TOAST_HOVER`, `IPC.WEB_NOTIFY_SHOW`, `IPC.WEB_NOTIFY_CLICK`; bridge methods `onToastState`, `reportToastSize`, `activateToast`, `dismissToast`, `dismissAllToasts`, `runToastAction`, `setToastHovered`.

- [ ] **Step 1: Add the channels**

In `electron/ipc.ts`, after `COMPOSE_ACCOUNT_SIZE: 'compose:account-size',`:

```ts
  TOAST_STATE: 'toast:state',
  TOAST_SIZE: 'toast:size',
  TOAST_ACTIVATE: 'toast:activate',
  TOAST_DISMISS: 'toast:dismiss',
  TOAST_DISMISS_ALL: 'toast:dismiss-all',
  TOAST_ACTION: 'toast:action',
  TOAST_HOVER: 'toast:hover',
  WEB_NOTIFY_SHOW: 'web-notify:show',
  WEB_NOTIFY_CLICK: 'web-notify:click',
```

- [ ] **Step 2: Shrink NotifyState**

`persist` goes: nothing draws a system toast any more, so `requireInteraction` has no reader. `hiddenSender` and `hiddenSubject` go too: the page now sends main the real text and main applies the privacy replacement, the same way it already does for push mail in `notifyNewMail`. What is left is the two things the page itself still decides.

Replace `electron/ipc.ts:132-138`:

```ts
export type NotifyState = {
  show: boolean;
  silent: boolean;
};
```

And update the file header comment at `electron/ipc.ts:5-9` — the paragraph about `hiddenSender`/`hiddenSubject` no longer describes anything in this file. Replace those five lines with:

```ts
// Two conventions to keep. Settings arrive as one patch channel per settings tab
// rather than a channel per field, which would be twenty-odd identical handlers. And
// NotifyState carries only what the Gmail page itself has to decide — whether a
// notification may be raised at all, and whether that page may make noise. The text,
// the privacy replacements and how long it stays are main's, because main draws it.
```

- [ ] **Step 3: Add the bridge methods**

In `electron/sidebar-preload.ts`, after `reportComposeAccountSize` (line 133-134), inside the same object:

```ts
  onToastState: (cb: (state: unknown) => void): void => {
    ipcRenderer.on(IPC.TOAST_STATE, (_e, state) => cb(state));
  },
  reportToastSize: (size: { width: number; height: number }): void =>
    ipcRenderer.send(IPC.TOAST_SIZE, size),
  activateToast: (id: string): void => ipcRenderer.send(IPC.TOAST_ACTIVATE, id),
  dismissToast: (id: string): void => ipcRenderer.send(IPC.TOAST_DISMISS, id),
  dismissAllToasts: (): void => ipcRenderer.send(IPC.TOAST_DISMISS_ALL),
  runToastAction: (arg: { id: string; action: 'archive' | 'read' }): void =>
    ipcRenderer.send(IPC.TOAST_ACTION, arg),
  setToastHovered: (hovered: boolean): void => ipcRenderer.send(IPC.TOAST_HOVER, hovered),
```

- [ ] **Step 4: Declare them on the bridge type**

In `renderer/app/page.tsx`, add to the imports near the other shared-lib types:

```tsx
import type { ToastAction, ToastState } from '../lib/toast';
```

and after `reportComposeAccountSize(size: { width: number; height: number }): void;` (line 239), inside `interface DesktopBridge`:

```tsx
  onToastState(cb: (state: ToastState) => void): void;
  reportToastSize(size: { width: number; height: number }): void;
  activateToast(id: string): void;
  dismissToast(id: string): void;
  dismissAllToasts(): void;
  runToastAction(arg: { id: string; action: ToastAction }): void;
  setToastHovered(hovered: boolean): void;
```

- [ ] **Step 5: Break the build on purpose, then fix the three readers**

`NotifyState` lost `persist`, so `main.ts:853` and the preload no longer compile.

Run: `npx tsc --noEmit`
Expected: FAIL, with errors at `electron/main.ts:853` (`persist` not in type) and `electron/preload.ts` (`notificationOptionsFor` reads `state.persist`, `state.hiddenSubject`).

Fix `electron/main.ts:850-855` by dropping the two lines that no longer belong:

```ts
      manager?.pushNotifyAllowed(keyOf(profile), surface, {
        show: notificationsAllowed(p, profile.email, now, surface, coverage.has(profile.email)),
        silent: notificationSilent(p, profile.email, surface),
      });
```

Leave `electron/preload.ts` alone for now — Task 9 rewrites that path. To keep the tree compiling until then, change `notificationOptionsFor` and `notificationTitleFor` in `electron/preload.ts:102-118` to read from a locally typed argument instead of `NotifyState`:

```ts
type LegacyNotifyState = {
  show: boolean;
  silent: boolean;
  persist?: boolean;
  hiddenSender?: string;
  hiddenSubject?: string;
};

export function notificationOptionsFor(
  state: LegacyNotifyState,
  options?: NotificationOptions,
): NotificationOptions | undefined {
```

and the same swap on `notificationTitleFor(state: LegacyNotifyState, title: string)`. Both functions and `LegacyNotifyState` are deleted in Task 9; this is scaffolding so that Task 3 leaves a green tree.

- [ ] **Step 6: Typecheck and run the suite**

Run: `npx tsc --noEmit && npm run build:renderer && npm test`
Expected: tsc silent; renderer build succeeds; 987 tests pass.

- [ ] **Step 7: Commit**

```bash
git add electron/ipc.ts electron/sidebar-preload.ts electron/preload.ts electron/main.ts renderer/app/page.tsx
git commit -m "feat: IPC channels and bridge for the toast stack"
```

---

### Task 4: The window and the controller

The Electron half. No unit test — it is all `BrowserWindow` calls — so it is verified by typecheck here and by seeing a real toast in Task 6.

**Files:**
- Create: `electron/toast-window.ts`
- Create: `electron/toast-controller.ts`

**Interfaces:**
- Consumes: `toastWindowBounds`, `exceedsWorkArea`, `TOAST_MARGIN`, `TOAST_WIDTH` (Task 2); the whole of `electron/toast-model` and `renderer/lib/toast` (Task 1); `IPC.TOAST_STATE` (Task 3).
- Produces: `ToastWindow` class with `send`, `setInteractive`, `wouldOverflow`, `applySize`, `reposition`, `hide`, `destroy`; `ToastController` class with `show(input: ToastInput): void`, `dismiss(id)`, `dismissAll()`, `activate(id)`, `actionFor(id)`, `setHovered(bool)`, `applySize(w, h)`, `refresh()`, `destroy()`; type `ToastInput`.

- [ ] **Step 1: Write the window**

Create `electron/toast-window.ts`:

```ts
// The one window the stack lives in. One window for all the cards, not one per card:
// stacking, ordering and the gap between cards are then plain CSS in a single document
// instead of five windows main has to keep in formation as they come and go.
//
// Three properties carry the whole design. `focusable: false` is the important one — a
// toast that steals focus from whatever you are typing in is worse than no toast, and
// Windows still delivers mouse input to a non-focusable window, so clicking and hovering
// keep working while the keyboard stays where it was. `transparent` with a page that
// paints no background is what lets the cards be rounded and separated; and mouse events
// are ignored by default so the transparent strips between the cards do not swallow
// clicks meant for whatever is behind them. The page turns that off while the pointer is
// actually over a card, which it can do because `forward: true` keeps mouse moves coming.
//
// The window is created once and hidden when the stack empties rather than destroyed, so
// the next card appears without a reload. Sizing follows compose-account-window.ts: the
// page measures its own card and reports it, main resizes to that and only then shows,
// which is what keeps a resize from ever being seen.

import { BrowserWindow, screen } from 'electron';
import { TOAST_WIDTH, exceedsWorkArea, toastWindowBounds, type ToastRect } from './toast-layout';

export class ToastWindow {
  private win: BrowserWindow | null = null;
  private lastSize: { width: number; height: number } | null = null;

  constructor(
    private readonly preloadPath: string,
    private readonly url: string,
    private readonly zoom: () => number,
    /** The window whose display the stack should appear on; null falls back to primary. */
    private readonly anchor: () => BrowserWindow | null,
    private readonly onReady: () => void,
  ) {}

  /** Creates the window on first use. Returns null when creation failed. */
  private ensure(): BrowserWindow | null {
    if (this.win && !this.win.isDestroyed()) return this.win;
    try {
      const win = new BrowserWindow({
        width: TOAST_WIDTH,
        height: 1,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        focusable: false,
        alwaysOnTop: true,
        acceptFirstMouse: true,
        show: false,
        webPreferences: { preload: this.preloadPath, contextIsolation: true },
      });
      win.setIgnoreMouseEvents(true, { forward: true });
      const applyZoom = (): void => {
        if (win.isDestroyed() || win.webContents.isDestroyed()) return;
        try {
          win.webContents.setZoomFactor(this.zoom());
        } catch {
        }
      };
      applyZoom();
      win.webContents.once('did-finish-load', () => {
        applyZoom();
        this.onReady();
      });
      win.on('closed', () => {
        if (this.win === win) this.win = null;
      });
      void win.loadURL(this.url);
      this.win = win;
      return win;
    } catch (e) {
      console.warn('[toast] window creation failed:', e);
      this.win = null;
      return null;
    }
  }

  send(channel: string, payload: unknown): void {
    const win = this.ensure();
    if (!win || win.webContents.isDestroyed()) return;
    win.webContents.send(channel, payload);
  }

  /** Lets the page take clicks while the pointer is over a card, and pass them through otherwise. */
  setInteractive(on: boolean): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.setIgnoreMouseEvents(!on, { forward: true });
  }

  private workArea(): ToastRect {
    const anchor = this.anchor();
    const display =
      anchor && !anchor.isDestroyed()
        ? screen.getDisplayMatching(anchor.getBounds())
        : screen.getPrimaryDisplay();
    return display.workArea;
  }

  /** True when a stack of this measured height would not fit the screen it is on. */
  wouldOverflow(cssHeight: number): boolean {
    return exceedsWorkArea(this.workArea(), cssHeight, this.zoom());
  }

  /** Applies the size the page measured, anchors it bottom-right, and shows the window. */
  applySize(cssWidth: number, cssHeight: number): void {
    const win = this.ensure();
    if (!win || win.isDestroyed()) return;
    this.lastSize = { width: cssWidth, height: cssHeight };
    win.setBounds(toastWindowBounds(this.workArea(), this.lastSize, this.zoom()));
    if (!win.isVisible()) win.showInactive();
    win.setAlwaysOnTop(true);
  }

  /** Re-anchors to the current work area, for a resolution or taskbar change. */
  reposition(): void {
    if (!this.win || this.win.isDestroyed() || !this.lastSize) return;
    this.win.setBounds(toastWindowBounds(this.workArea(), this.lastSize, this.zoom()));
  }

  hide(): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.hide();
    this.win.setIgnoreMouseEvents(true, { forward: true });
  }

  destroy(): void {
    const win = this.win;
    this.win = null;
    if (win && !win.isDestroyed()) win.destroy();
  }
}
```

`showInactive()` rather than `show()` is what keeps the stack from raising itself over the user's focus even once.

- [ ] **Step 2: Write the controller**

Create `electron/toast-controller.ts`:

```ts
// Holds the stack, pushes it to the window, and turns what the page reports back into the
// callbacks main already has. It owns the only clock in the feature: a toast that stays
// until dismissed is the default, and the interval below exists solely for the accounts
// whose per-account persist switch is off. It runs only while such a toast is up, and a
// hovered stack does not count down at all — the paused time is added back to every
// expiry when the pointer leaves, so a card you were reading does not vanish a tenth of a
// second after you look away.
//
// The height guard is the second reason a stack collapses. The page reports the size it
// laid out to; if that does not fit the screen the stack folds into its summary and the
// page is asked to lay out again. That is why applySize can push a new state rather than
// only resizing.

import { IPC } from './ipc';
import {
  EMPTY_STACK,
  addToast,
  collapse,
  delayExpiries,
  dismissAll,
  dismissToast,
  expireToasts,
} from './toast-model';
import type { ToastWindow } from './toast-window';
import type { Toast, ToastAction, ToastStack, ToastState } from '../renderer/lib/toast';

/** How long a toast lives when its account has the persist switch turned off. */
export const TOAST_LIFETIME_MS = 6000;

const TICK_MS = 500;

export type ToastInput = Omit<Toast, 'id' | 'expiresAt'> & { persist: boolean };

export interface ToastControllerHooks {
  window: ToastWindow;
  locale: () => 'en' | 'nl';
  reneMode: () => boolean;
  now: () => number;
  /** A card was clicked: open the mail, the settings panel, the download — whatever it stands for. */
  onActivate: (toast: Toast) => void;
  /** The summary was clicked: bring the app forward, on that account when there is one. */
  onActivateSummary: (accountKey: string | null) => void;
  onAction: (toast: Toast, action: ToastAction) => void;
}

export class ToastController {
  private stack: ToastStack = EMPTY_STACK;
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private hoveredSince: number | null = null;
  private ready = false;

  constructor(private readonly hooks: ToastControllerHooks) {}

  /** Called by main when the window has finished loading, so a queued state is not lost. */
  markReady(): void {
    this.ready = true;
    this.push();
  }

  show(input: ToastInput): void {
    const { persist, ...rest } = input;
    this.seq += 1;
    const toast: Toast = {
      ...rest,
      id: `t${this.seq}`,
      ...(persist ? {} : { expiresAt: this.hooks.now() + TOAST_LIFETIME_MS }),
    };
    this.stack = addToast(this.stack, toast);
    this.push();
    this.retime();
  }

  dismiss(id: string): void {
    this.stack = dismissToast(this.stack, id);
    this.push();
    this.retime();
  }

  dismissAll(): void {
    this.stack = dismissAll(this.stack);
    this.push();
    this.retime();
  }

  activate(id: string): void {
    const toast = this.stack.toasts.find((t) => t.id === id);
    if (!toast) return;
    this.stack = dismissToast(this.stack, id);
    this.push();
    this.retime();
    this.hooks.onActivate(toast);
  }

  activateSummary(): void {
    const accountKey = this.stack.summary?.accountKey ?? null;
    if (!this.stack.summary) return;
    this.stack = dismissAll(this.stack);
    this.push();
    this.retime();
    this.hooks.onActivateSummary(accountKey);
  }

  runAction(id: string, action: ToastAction): void {
    const toast = this.stack.toasts.find((t) => t.id === id);
    if (!toast) return;
    this.stack = dismissToast(this.stack, id);
    this.push();
    this.retime();
    this.hooks.onAction(toast, action);
  }

  setHovered(hovered: boolean): void {
    this.hooks.window.setInteractive(hovered);
    if (hovered) {
      if (this.hoveredSince === null) this.hoveredSince = this.hooks.now();
      return;
    }
    if (this.hoveredSince === null) return;
    const paused = this.hooks.now() - this.hoveredSince;
    this.hoveredSince = null;
    this.stack = delayExpiries(this.stack, paused);
  }

  /** The page measured itself. Collapse if it does not fit, otherwise size the window to it. */
  applySize(cssWidth: number, cssHeight: number): void {
    if (this.hooks.window.wouldOverflow(cssHeight)) {
      const folded = collapse(this.stack);
      if (folded !== this.stack) {
        this.stack = folded;
        this.push();
        return;
      }
    }
    this.hooks.window.applySize(cssWidth, cssHeight);
  }

  /** Re-sends the current stack, for a language or Rene-mode change. */
  refresh(): void {
    this.push();
  }

  reposition(): void {
    this.hooks.window.reposition();
  }

  destroy(): void {
    this.stopTimer();
    this.stack = EMPTY_STACK;
    this.hooks.window.destroy();
  }

  private push(): void {
    if (this.stack.toasts.length === 0 && this.stack.summary === null) {
      this.hoveredSince = null;
      this.hooks.window.hide();
      if (this.ready) this.hooks.window.send(IPC.TOAST_STATE, this.state());
      return;
    }
    this.hooks.window.send(IPC.TOAST_STATE, this.state());
  }

  private state(): ToastState {
    return {
      toasts: this.stack.toasts,
      summary: this.stack.summary,
      locale: this.hooks.locale(),
      reneMode: this.hooks.reneMode(),
    };
  }

  private retime(): void {
    const needed = this.stack.toasts.some((t) => t.expiresAt !== undefined);
    if (needed && !this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    if (!needed) this.stopTimer();
  }

  private stopTimer(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    if (this.hoveredSince !== null) return;
    const next = expireToasts(this.stack, this.hooks.now());
    if (next === this.stack) return;
    this.stack = next;
    this.push();
    this.retime();
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output. Nothing imports these two yet, which is why this task ends here rather than at a running app.

- [ ] **Step 4: Commit**

```bash
git add electron/toast-window.ts electron/toast-controller.ts
git commit -m "feat: the toast window and its controller"
```

---

### Task 5: The card

The page. Five new strings in three sets, and a layout whose height never changes on hover — the third line of the card holds the account address at rest and the two action buttons when hovered, in the same row. That is deliberate: a stack anchored to the bottom of the screen grows upward, so a card that got taller on hover would shove the cards above it up under the pointer and flicker between hovered and not.

**Files:**
- Create: `renderer/app/toasts/page.tsx`
- Modify: `renderer/app/strings.ts` (interface + three sets)

**Interfaces:**
- Consumes: `ToastState`, `Toast`, `ToastAction` (Task 1); bridge methods (Task 3); `IPC.TOAST_STATE` payload shape.
- Produces: the `toasts.html` route; strings `toastArchive`, `toastMarkRead`, `toastDismiss`, `toastDismissAll`, `toastSummary`.

- [ ] **Step 1: Add the strings to the interface**

In `renderer/app/strings.ts`, in `interface UiStrings` after `persistToggleTitle: string;` (line 206):

```ts
  toastArchive: string;
  toastMarkRead: string;
  toastDismiss: string;
  toastDismissAll: string;
  toastSummary: (count: number) => string;
```

- [ ] **Step 2: Add the English values**

After `persistToggleTitle: 'Keep notifications on screen until you dismiss them',` (line 573) in `STRINGS_NORMAL`:

```ts
  toastArchive: 'Archive',
  toastMarkRead: 'Mark read',
  toastDismiss: 'Dismiss',
  toastDismissAll: 'Dismiss all',
  toastSummary: (count: number) => `${count} new notifications`,
```

- [ ] **Step 3: Add the Rene values**

After `persistToggleTitle: 'Meldingen blijven op het scherm staan tot u ze wegklikt',` (line 850) in `STRINGS_RENE`:

```ts
  toastArchive: 'Opbergen',
  toastMarkRead: 'Al gezien',
  toastDismiss: 'Weg ermee',
  toastDismissAll: 'Alles weg',
  toastSummary: (count: number) => `${count} nieuwe berichtjes`,
```

- [ ] **Step 4: Add the Dutch values**

After `persistToggleTitle: 'Houd meldingen op het scherm tot je ze wegklikt',` (line 1140) in `STRINGS_NL`:

```ts
  toastArchive: 'Archiveren',
  toastMarkRead: 'Gelezen',
  toastDismiss: 'Sluiten',
  toastDismissAll: 'Alles sluiten',
  toastSummary: (count: number) => `${count} nieuwe meldingen`,
```

- [ ] **Step 5: Run the string tests**

Run: `npx vitest run tests/strings-sets.test.ts`
Expected: PASS. All three sets carry the five new keys, no value is empty, and no Dutch value equals its English one.

- [ ] **Step 6: Write the page**

Create `renderer/app/toasts/page.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getStrings } from '../strings';
import { HAIRLINE } from '../settings/tokens';
import type { Toast, ToastAction, ToastState } from '../../lib/toast';

// The notification stack, one card per notification, anchored to the bottom-right of the
// screen by main and growing upward. It is its own frameless transparent window, so as in
// compose-account/page.tsx the card is the window and the html background must be
// transparent or Chromium paints an opaque rectangle around the rounded corners. Dark
// variants are inert here — the dark class is only ever put on the main document — so this
// renders light, as the other window pages do.
//
// The card's height must not change on hover. The stack grows upward from a fixed bottom
// edge, so a card that got taller when hovered would push the cards above it up under the
// pointer, and the pointer would then be over a different card, and the height would
// change again. The third line therefore holds the account address at rest and swaps it
// in place for the action buttons — same row, same height, nothing moves. The close box
// is absolutely positioned for the same reason.
//
// Hover is read from a document-level mousemove rather than onMouseEnter per card. Main
// keeps the window click-through so the transparent gaps between cards do not swallow
// clicks meant for the desktop, and a click-through window gets mouse moves but no enter
// or leave events; elementFromPoint is what still works under that.

const CARD_WIDTH = 380;
// Windows at a fractional display scale rounds the content size and then divides the CSS
// viewport by the zoom factor, so an exact fit can land a pixel short and clip a shadow.
const ROUNDING_SLACK = 2;

export default function ToastsPage() {
  const [state, setState] = useState<ToastState | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const hoveredRef = useRef(false);

  useEffect(() => {
    window.desktop?.onToastState((next) => setState(next));
  }, []);

  // One observer for the life of the page: the stack changes size when cards come and go,
  // and again when a font finishes loading or a long subject wraps to a second line.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const report = (): void => {
      const box = el.getBoundingClientRect();
      window.desktop?.reportToastSize({
        width: Math.ceil(box.width),
        height: Math.ceil(box.height) + ROUNDING_SLACK,
      });
    };
    const observer = new ResizeObserver(report);
    observer.observe(el);
    report();
    return () => observer.disconnect();
  }, [state]);

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const over = el instanceof Element && el.closest('[data-toast-card]') !== null;
      if (over === hoveredRef.current) return;
      hoveredRef.current = over;
      window.desktop?.setToastHovered(over);
    };
    const onLeave = (): void => {
      if (!hoveredRef.current) return;
      hoveredRef.current = false;
      window.desktop?.setToastHovered(false);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseleave', onLeave);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  const transparent = <style>{'html,body{background:transparent;overflow:hidden}'}</style>;
  if (!state) return transparent;

  const S = getStrings(state.locale, state.reneMode);
  const empty = state.toasts.length === 0 && state.summary === null;

  return (
    <>
      {transparent}
      <div
        ref={wrapRef}
        style={{ width: CARD_WIDTH }}
        className="flex flex-col items-stretch gap-2"
      >
        {empty ? null : (
          <>
            {state.toasts.length > 1 ? (
              <div className="flex justify-end">
                <button
                  type="button"
                  data-toast-card
                  onClick={() => window.desktop?.dismissAllToasts()}
                  className={`rounded-full border ${HAIRLINE} bg-white/95 px-3 py-1 text-xs text-neutral-600 shadow-lg backdrop-blur hover:bg-white`}
                >
                  {S.toastDismissAll}
                </button>
              </div>
            ) : null}

            {state.summary ? (
              <SummaryCard
                count={state.summary.count}
                label={S.toastSummary(state.summary.count)}
                dismissLabel={S.toastDismiss}
              />
            ) : (
              state.toasts.map((t) => (
                <ToastCard
                  key={t.id}
                  toast={t}
                  archiveLabel={S.toastArchive}
                  readLabel={S.toastMarkRead}
                  dismissLabel={S.toastDismiss}
                />
              ))
            )}
          </>
        )}
      </div>
    </>
  );
}

const CARD = `group relative flex overflow-hidden rounded-2xl border ${HAIRLINE} bg-white shadow-2xl`;
const ACTION =
  'rounded-md px-2 py-0.5 text-xs font-medium text-neutral-700 transition hover:bg-black/[0.06] motion-reduce:transition-none';

function ToastCard({
  toast,
  archiveLabel,
  readLabel,
  dismissLabel,
}: {
  toast: Toast;
  archiveLabel: string;
  readLabel: string;
  dismissLabel: string;
}) {
  const color = toast.account?.color ?? '#5f6368';
  const hasActions = Boolean(toast.messageId);
  const run = useCallback(
    (action: ToastAction) => window.desktop?.runToastAction({ id: toast.id, action }),
    [toast.id],
  );

  return (
    <div data-toast-card className={CARD}>
      <span aria-hidden className="w-[5px] shrink-0" style={{ backgroundColor: color }} />

      <button
        type="button"
        onClick={() => window.desktop?.activateToast(toast.id)}
        className="flex min-w-0 flex-1 items-start gap-3 px-3.5 py-3 text-left outline-none"
      >
        <Avatar toast={toast} color={color} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate pr-6 text-[13.5px] font-medium text-neutral-900">
            {toast.title}
          </span>
          <span className="truncate text-[13px] text-neutral-600">{toast.body}</span>
          <span className="mt-1 flex h-5 items-center gap-1">
            <span
              className={`truncate text-xs text-neutral-400 ${hasActions ? 'group-hover:hidden' : ''}`}
            >
              {toast.account?.email ?? ''}
            </span>
            {hasActions ? (
              <span className="hidden gap-1 group-hover:flex">
                <span
                  role="button"
                  tabIndex={0}
                  className={ACTION}
                  onClick={(e) => {
                    e.stopPropagation();
                    run('archive');
                  }}
                >
                  {archiveLabel}
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  className={ACTION}
                  onClick={(e) => {
                    e.stopPropagation();
                    run('read');
                  }}
                >
                  {readLabel}
                </span>
              </span>
            ) : null}
          </span>
        </span>
      </button>

      <CloseBox label={dismissLabel} onClick={() => window.desktop?.dismissToast(toast.id)} />
    </div>
  );
}

function SummaryCard({
  count,
  label,
  dismissLabel,
}: {
  count: number;
  label: string;
  dismissLabel: string;
}) {
  return (
    <div data-toast-card className={CARD}>
      <span aria-hidden className="w-[5px] shrink-0 bg-neutral-800" />
      <button
        type="button"
        onClick={() => window.desktop?.activateToast('summary')}
        className="flex min-w-0 flex-1 items-center gap-3 px-3.5 py-3 text-left outline-none"
      >
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-xs font-semibold tabular-nums text-white"
        >
          {count > 99 ? '99+' : count}
        </span>
        <span className="truncate pr-6 text-[13.5px] font-medium text-neutral-900">{label}</span>
      </button>
      <CloseBox label={dismissLabel} onClick={() => window.desktop?.dismissAllToasts()} />
    </div>
  );
}

function CloseBox({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-neutral-400 opacity-0 transition hover:bg-black/[0.06] hover:text-neutral-700 group-hover:opacity-100 motion-reduce:transition-none"
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
        <path
          d="M4 4l8 8M12 4l-8 8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </button>
  );
}

function Avatar({ toast, color }: { toast: Toast; color: string }) {
  const [broken, setBroken] = useState(false);
  const url = toast.account?.avatarUrl;
  const initial =
    (toast.account?.label || toast.account?.email || toast.title || '?').trim().charAt(0).toUpperCase() ||
    '?';
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold text-white"
      style={{ backgroundColor: color }}
    >
      {url && !broken ? (
        <img
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        initial
      )}
    </span>
  );
}
```

The summary's click sends the literal id `'summary'`; Task 6 routes that to `activateSummary()`.

- [ ] **Step 7: Build the renderer and confirm the route exists**

Run: `npm run build:renderer && ls renderer/out/toasts.html`
Expected: the build succeeds and `renderer/out/toasts.html` is listed.

- [ ] **Step 8: Run the whole suite**

Run: `npm test`
Expected: 987 tests pass.

- [ ] **Step 9: Commit**

```bash
git add renderer/app/toasts/page.tsx renderer/app/strings.ts
git commit -m "feat: the notification card and its stack page"
```

---

### Task 6: Switch main over

Everything meets here. After this task the app raises its own toasts and Windows raises none — verified by running the app and pressing the test button.

**Files:**
- Modify: `electron/main.ts` — imports, the controller instance, the five call sites (`:590`, `:1515`, `:1867`, `:2020`, `:2174`), the IPC handlers block near `:2342`, and the quit path

**Interfaces:**
- Consumes: `ToastWindow`, `ToastController`, `ToastInput` (Task 4); `IPC.TOAST_*` (Task 3); the `toasts` route (Task 5).
- Produces: `showToast(input: ToastInput): void` and `toastAccountFor(email: string): ToastAccount | undefined` inside `main.ts`.

- [ ] **Step 1: Import what the controller needs**

Near the other local imports in `electron/main.ts` (the block around line 100-130):

```ts
import { ToastWindow } from './toast-window';
import { ToastController, type ToastInput } from './toast-controller';
import type { Toast, ToastAccount, ToastAction } from '../renderer/lib/toast';
```

- [ ] **Step 2: Create the controller alongside the other module-level state**

Add near the other `let` declarations at the top of `main.ts` (around line 219, beside `reconnectBanner`):

```ts
let toasts: ToastController | null = null;
```

Then, inside `createWindow()` right after `manager` is constructed (after the block ending at line ~1747), add:

```ts
  // Built with the main window because that is what decides which display the stack
  // appears on, and torn down with it: a stack floating over a closed app is nonsense.
  const toastWindow = new ToastWindow(
    SIDEBAR_PRELOAD_PATH,
    DEV_URL ? `${DEV_URL}/toasts` : 'app://bundle/toasts.html',
    () => (prefs?.getAll().reneMode ? RENE_ZOOM_FACTOR : 1),
    () => mainWindow,
    () => toasts?.markReady(),
  );
  toasts = new ToastController({
    window: toastWindow,
    locale: () => currentLocale(),
    reneMode: () => prefs?.getAll().reneMode === true,
    now: () => Date.now(),
    onActivate: (toast) => activateToast(toast),
    onActivateSummary: (accountKey) => {
      if (accountKey) activateNotification(accountKey, 'mail');
      else if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    },
    onAction: (toast, action) => void runToastAction(toast, action),
  });
  mainWindow.on('closed', () => {
    toasts?.destroy();
    toasts = null;
  });
```

And once, next to the other app-level listeners (near where `app.whenReady` wires things up):

```ts
  screen.on('display-metrics-changed', () => toasts?.reposition());
```

`screen` is already in the `electron` import at `electron/main.ts:20`; nothing to add.

- [ ] **Step 3: Add the three helpers**

Put these next to `notifyNewMail` (above line 1505):

```ts
// The account fields a card needs, resolved once at show time. A toast keeps the colour
// and avatar it was raised with rather than a reference to a profile that may be removed
// while the card is still on screen.
function toastAccountFor(email: string): ToastAccount | undefined {
  const profile = profiles.find((p) => p.email === email);
  if (!profile) return undefined;
  return {
    key: keyOf(profile),
    email: profile.email,
    label: prefs?.getAccount(email).label ?? profile.name ?? email,
    color: profile.color,
    avatarUrl: profile.avatarUrl,
  };
}

// The one place a toast is raised. Falling back to a system notification when our own
// window is not there is not politeness: a bug in the stack must not mean mail arrives
// silently, and the fallback is the behaviour this feature replaced, so it is known good.
function showToast(input: ToastInput): void {
  if (toasts) {
    toasts.show(input);
    return;
  }
  if (!Notification.isSupported()) return;
  new Notification({ title: input.title, body: input.body }).show();
}

function activateToast(toast: Toast): void {
  if (toast.kind === 'mail' && toast.account) {
    activateNotification(toast.account.key, 'mail', toast.threadId);
    return;
  }
  if (toast.kind === 'update' || toast.kind === 'error') {
    openSettingsPanel();
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}
```

The download branch is missing from `activateToast` on purpose — it needs a map that Step 6 introduces alongside the download call site, and it is added there. Until then a download card click falls through to "show the window", which is harmless.

- [ ] **Step 4: Add a stub for the action handler**

So Step 3 compiles. Task 8 fills it in. Put it next to `activateToast`:

```ts
async function runToastAction(_toast: Toast, _action: ToastAction): Promise<void> {
  // Filled in by the archive / mark-read task.
}
```

- [ ] **Step 5: Convert the new-mail call site**

Replace `electron/main.ts:1505-1524` (`notifyNewMail`) with:

```ts
function notifyNewMail(email: string, meta: MessageMeta): void {
  if (!prefs) return;
  if (!coverage.has(email)) return;
  const account = toastAccountFor(email);
  if (!account) return;
  const p = prefs.getAll();
  const now = new Date();
  if (!notificationsAllowed(p, email, now, 'mail')) return;
  const hidden = hiddenNotificationText(p);
  const L = nativeLabels(currentLocale(), p.reneMode === true);
  showToast({
    kind: 'mail',
    title: hidden.hiddenSender ?? (displayName(meta.from) || email),
    body: hidden.hiddenSubject ?? (meta.subject || L.noSubject),
    account,
    threadId: meta.threadId,
    messageId: meta.id,
    persist: notificationPersist(p, email),
  });
  if (!notificationSilent(p, email, 'mail')) playNotificationSound(p);
}
```

- [ ] **Step 6: Convert the other four call sites**

`electron/main.ts:588-594` (account not added) becomes:

```ts
      const L = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true);
      showToast({
        kind: 'error',
        title: L.accountNotAddedTitle,
        body: L.accountNotAddedBody(email, result.error),
        persist: true,
      });
```

Drop the `if (Notification.isSupported())` wrapper around it.

`electron/main.ts:1864-1872` (update available) becomes:

```ts
  notifiedUpdateVersion = version;
  const L = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true);
  showToast({
    kind: 'update',
    title: L.updateAvailableTitle,
    body: L.updateAvailableBody(version),
    persist: true,
  });
```

Drop the `if (!Notification.isSupported()) return;` line above it.

`electron/main.ts:2015-2029` (test notification) becomes:

```ts
function showTestNotification(): void {
  if (!prefs) return;
  const p = prefs.getAll();
  const hidden = hiddenNotificationText(p);
  const L = nativeLabels(currentLocale(), p.reneMode === true);
  const first = profiles[0];
  showToast({
    kind: 'test',
    title: hidden.hiddenSender ?? 'Gmail Desktop',
    body: hidden.hiddenSubject ?? L.testNotificationBody,
    ...(first ? { account: toastAccountFor(first.email) } : {}),
    persist: true,
  });
  if (p.notifications.sound !== false && p.notifications.soundName) {
    lastSoundAt = 0;
    playNotificationSound(p);
  }
}
```

`electron/main.ts:2165-2186` (download done) becomes:

```ts
function notifyDownloadDone(
  filename: string,
  path: string,
  state: 'completed' | 'cancelled' | 'interrupted',
  onClick: DownloadClickAction,
): void {
  const done = state === 'completed';
  const L = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true);
  if (done && path && onClick !== 'nothing') downloadClickPaths.set(path, onClick);
  showToast({
    kind: 'download',
    title: done ? L.downloadCompleteTitle : state === 'cancelled' ? L.downloadCancelledTitle : L.downloadFailedTitle,
    body: filename,
    ...(done && path && onClick !== 'nothing' ? { threadId: path } : {}),
    persist: true,
  });
}
```

with, above it:

```ts
// A download card carries its path in threadId — the only field on a Toast that is a free
// string, and reusing it beats widening the type for one kind. The action is remembered
// here rather than on the card, so a preference changed between download and click is the
// one that applies.
const downloadClickPaths = new Map<string, DownloadClickAction>();
```

and in `activateToast`, before the final fallback:

```ts
  if (toast.kind === 'download' && toast.threadId) {
    const action = downloadClickPaths.get(toast.threadId);
    downloadClickPaths.delete(toast.threadId);
    if (action === 'open-file') void shell.openPath(toast.threadId);
    else if (action === 'show-in-folder') shell.showItemInFolder(toast.threadId);
    return;
  }
```

- [ ] **Step 7: Handle what the page sends back**

Next to the other `ipcMain.on` registrations (around `electron/main.ts:2342`):

```ts
  ipcMain.on(IPC.TOAST_SIZE, (_e, size: { width: number; height: number }) =>
    toasts?.applySize(size.width, size.height),
  );
  ipcMain.on(IPC.TOAST_ACTIVATE, (_e, id: string) =>
    id === 'summary' ? toasts?.activateSummary() : toasts?.activate(id),
  );
  ipcMain.on(IPC.TOAST_DISMISS, (_e, id: string) => toasts?.dismiss(id));
  ipcMain.on(IPC.TOAST_DISMISS_ALL, () => toasts?.dismissAll());
  ipcMain.on(IPC.TOAST_ACTION, (_e, arg: { id: string; action: ToastAction }) =>
    toasts?.runAction(arg.id, arg.action),
  );
  ipcMain.on(IPC.TOAST_HOVER, (_e, hovered: boolean) => toasts?.setHovered(Boolean(hovered)));
```

- [ ] **Step 8: Re-send the stack when the language changes**

Add `toasts?.refresh();` inside the `ipcMain.on(IPC.SET_LANGUAGE, ...)` handler at `electron/main.ts:2640` and the `ipcMain.on(IPC.SET_RENE_MODE, ...)` handler at `electron/main.ts:2649`, after the `pushPrefs()` each already calls. A card on screen then follows the new language, and in the Rene case the new zoom factor as well — the controller re-sends the state, the page re-measures, and `applySize` re-reads the zoom.

- [ ] **Step 9: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both silent / successful.

- [ ] **Step 10: See it work**

Run: `npm run dev`

If it starts and immediately vanishes, another instance is holding the single-instance lock — close the running app first.

In the app: Settings → Notifications → the test-notification button. Confirm all of:
1. A white rounded card appears at the bottom-right of the screen, above the taskbar.
2. It does **not** steal focus — click into a text field in another app first, press the button, and keep typing.
3. It stays. Wait 30 seconds; it is still there.
4. Hovering shows the close box; clicking it removes the card and the window disappears.
5. Press the button six times: the first five stack upward, and the sixth replaces them all with one card reading "6 nieuwe meldingen" (or the English equivalent).
6. Clicking in the transparent gap between two cards does not swallow the click — the app or desktop behind it responds.
7. No Windows toast appears at any point.

- [ ] **Step 11: Commit**

```bash
git add electron/main.ts
git commit -m "feat: raise our own notifications instead of Windows toasts"
```

---

### Task 7: Staying becomes the default

**Files:**
- Modify: `electron/notification-policy.ts:72-74`
- Modify: `tests/notification-policy.test.ts:311-331`
- Modify: `renderer/app/settings/NotificationsSection.tsx:11-18` (header comment) and `:89-98` (the persist column)
- Modify: `renderer/app/strings.ts` (three `persistToggleTitle` values)

**Interfaces:**
- Consumes: `notificationPersist` as called from `notifyNewMail` (Task 6).
- Produces: no new symbols; `notificationPersist` changes meaning.

- [ ] **Step 1: Change the failing tests first**

Replace `tests/notification-policy.test.ts:311-331` with:

```ts
describe('notificationPersist', () => {
  it('persists by default (field absent)', () => {
    expect(notificationPersist(prefs({}), 'a@x.com')).toBe(true);
  });
  it('persists when notifyPersist is true', () => {
    const p = prefs({ accounts: { 'a@x.com': { notifyPersist: true } } });
    expect(notificationPersist(p, 'a@x.com')).toBe(true);
  });
  it('stops persisting only when notifyPersist is explicitly false', () => {
    const p = prefs({ accounts: { 'a@x.com': { notifyPersist: false } } });
    expect(notificationPersist(p, 'a@x.com')).toBe(false);
  });
  it('is per account', () => {
    const p = prefs({ accounts: { 'a@x.com': { notifyPersist: false }, 'b@x.com': {} } });
    expect(notificationPersist(p, 'a@x.com')).toBe(false);
    expect(notificationPersist(p, 'b@x.com')).toBe(true);
  });
  it('is unknown-account safe', () => {
    expect(notificationPersist(prefs({}), 'nobody@x.com')).toBe(true);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/notification-policy.test.ts`
Expected: FAIL — three cases expecting `true` receive `false`.

- [ ] **Step 3: Invert the default**

`electron/notification-policy.ts:72-74`:

```ts
// Our own notifications stay on screen until they are dismissed; this switch is how an
// account opts out of that and gets a card that fades instead. It reads `!== false`
// rather than `=== true` because staying is the default, and a prefs file written before
// this existed has no opinion to honour.
export function notificationPersist(prefs: Prefs, email: string): boolean {
  return prefs.accounts[email]?.notifyPersist !== false;
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run tests/notification-policy.test.ts`
Expected: PASS.

- [ ] **Step 5: Match the settings grid**

`renderer/app/settings/NotificationsSection.tsx:89-98`, the persist column:

```tsx
    {
      key: 'persist',
      header: S.persistToggle,
      name: S.persistToggleTitle,
      cell: (p, a) => ({
        checked: a?.notifyPersist !== false,
        set: (v) => window.desktop?.setAccountPref({ email: p.email, notifyPersist: v }),
      }),
    },
```

And the header comment at `:12-17`, which currently names persist among the `=== true` columns:

```tsx
// Notifications: mute, quiet hours, the notification sound, and the per-account grid
// of which notifications each account may give. The polarity per column is
// deliberate and not sloppiness: mail, badge, sound and persist read `!== false`
// because they are on until you turn them off, while calendar reads `=== true`
// because it is off until you turn it on. A cell whose setting does not exist for an
// account (calendar on a delegated mailbox) stays empty, keeping the grid aligned.
```

- [ ] **Step 6: Say what the switch now means**

The label is still accurate — on means it stays — but the description should say what off does now. In `renderer/app/strings.ts`:

`STRINGS_NORMAL`: `persistToggleTitle: 'Keep notifications on screen until you dismiss them, instead of hiding them after a few seconds',`

`STRINGS_RENE`: `persistToggleTitle: 'Berichtjes blijven staan tot u ze wegklikt, in plaats van vanzelf weg te gaan',`

`STRINGS_NL`: `persistToggleTitle: 'Houd meldingen op het scherm tot je ze wegklikt, in plaats van ze na een paar tellen te laten verdwijnen',`

- [ ] **Step 7: Run everything**

Run: `npm test && npx tsc --noEmit && npm run build:renderer`
Expected: all green.

- [ ] **Step 8: See it work**

Run: `npm run dev`. In Settings → Notifications, the per-account grid now shows the persist column ticked for every account. Untick it for one account, raise a test notification, and confirm the card fades after about six seconds — and that hovering it stops the countdown for as long as the pointer is on it.

- [ ] **Step 9: Commit**

```bash
git add electron/notification-policy.ts tests/notification-policy.test.ts renderer/app/settings/NotificationsSection.tsx renderer/app/strings.ts
git commit -m "feat: notifications stay by default, per-account opt-out"
```

---

### Task 8: Archive and mark read

**Files:**
- Modify: `electron/gmail-api.ts` (add `archiveMessage`)
- Modify: `electron/main.ts` (`withTokenFor` extracted from `syncRunnerFor`, `runToastAction` filled in)
- Test: `tests/gmail-api.test.ts` (add the archive-body case)

**Interfaces:**
- Consumes: `runToastAction(toast, action)` stub (Task 6); `messageModifyUrl`, `requestJson` (existing).
- Produces: `archiveMessage(accessToken, messageId)` in `gmail-api.ts`; `withTokenFor(email)` in `main.ts`.

- [ ] **Step 1: Write the failing test**

`markMessageRead` has no request-level test — `tests/gmail-api.test.ts` covers the URL builders and the parsers, and leaves the `fetch` wrappers alone. Follow that: test the URL, and let the body be reviewed rather than mocked. `MESSAGES_URL` is `https://gmail.googleapis.com/gmail/v1/users/me/messages` (`electron/gmail-api.ts:168`).

Add to `tests/gmail-api.test.ts`, and add `archiveMessage` and `messageModifyUrl` to the existing import from `../electron/gmail-api`:

```ts
describe('archiveMessage', () => {
  it('is the modify endpoint for that message', () => {
    expect(messageModifyUrl('18f2c')).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/18f2c/modify',
    );
  });

  it('escapes a message id that needs it', () => {
    expect(messageModifyUrl('a/b')).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/a%2Fb/modify',
    );
  });

  it('exists and takes a token and a message id', () => {
    expect(typeof archiveMessage).toBe('function');
    expect(archiveMessage.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/gmail-api.test.ts`
Expected: FAIL on the new case (import error, or a URL mismatch you then correct).

- [ ] **Step 3: Add archiveMessage**

In `electron/gmail-api.ts`, directly after `markMessageRead` (line 193-199):

```ts
// Archiving is removing INBOX, which is the same modify call mark-as-read uses with a
// different label. Gmail has no archive endpoint of its own.
export async function archiveMessage(accessToken: string, messageId: string): Promise<void> {
  await requestJson(messageModifyUrl(messageId), accessToken, {
    method: 'POST',
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify({ removeLabelIds: ['INBOX'] }), 'utf8'),
  });
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/gmail-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Lift withToken out of syncRunnerFor**

The token dance — fetch, retry once on a 401 after a forced refresh, record the failure when the refresh also fails — is currently a closure inside `syncRunnerFor` (`electron/main.ts:1566-1582`). A card clicked ten minutes later needs the same dance for an arbitrary account. Move it out, above `syncRunnerFor`:

```ts
// The access-token dance for one account: use what we have, and on a 401 force a refresh
// and try once more. Lifted out of syncRunnerFor because the toast actions need the same
// thing for whichever account the card belongs to, long after the sync that raised it.
function withTokenFor(email: string): (<T>(fn: (token: string) => Promise<T>) => Promise<T>) | null {
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return null;
  return async <T>(fn: (token: string) => Promise<T>): Promise<T> => {
    const token = await accessTokenFor(cfg, oauthTokens!, email);
    if (!token) throw new Error('no token');
    try {
      return await fn(token);
    } catch (e) {
      if (!(e instanceof GmailHttpError) || e.status !== 401) throw e;
      const fresh = await forceRefresh(cfg, oauthTokens!, email);
      if (!fresh) {
        refreshFailures.add(email);
        scheduleOAuthHealthCheck();
        throw e;
      }
      refreshFailures.delete(email);
      return await fn(fresh);
    }
  };
}
```

Then in `syncRunnerFor`, replace the local `withToken` definition (lines 1566-1582) with:

```ts
  const withToken = withTokenFor(email);
  if (!withToken) return null;
```

and delete the now-redundant `const cfg = oauthConfig(); if (!cfg || !oauthTokens || !history) return null;` guard down to just `if (!history) return null;` — `withTokenFor` covers the other two.

- [ ] **Step 6: Fill in runToastAction**

Replace the stub from Task 6 Step 4:

```ts
// Archive and mark-read from the card. The card is already gone by the time this runs —
// the controller removes it before calling — because a button that leaves its card sitting
// there while a request is in flight invites a second click on the same message. A failure
// is logged and not surfaced: the mail is still in the inbox, which is the same state the
// user would have been in had they never clicked.
async function runToastAction(toast: Toast, action: ToastAction): Promise<void> {
  const email = toast.account?.email;
  const messageId = toast.messageId;
  if (!email || !messageId) return;
  const withToken = withTokenFor(email);
  if (!withToken) return;
  try {
    if (action === 'archive') await withToken((t) => archiveMessage(t, messageId));
    else await withToken((t) => markMessageRead(t, messageId));
  } catch (e) {
    console.warn(`[toast] ${action} failed for ${email}:`, e);
  }
}
```

Add `archiveMessage` to the existing `./gmail-api` import in `main.ts`.

- [ ] **Step 7: Typecheck and run the suite**

Run: `npx tsc --noEmit && npm test`
Expected: both green.

- [ ] **Step 8: See it work**

Run: `npm run dev` with at least one OAuth-connected account. Send yourself a mail. When the card appears, hover it: the account address on the third line is replaced by Archive and Mark read. Click Archive and confirm in Gmail that the message left the inbox. Repeat with Mark read and confirm the message is no longer bold.

- [ ] **Step 9: Commit**

```bash
git add electron/gmail-api.ts electron/main.ts tests/gmail-api.test.ts
git commit -m "feat: archive and mark read from a notification"
```

---

### Task 9: Gmail's own notifications

The last path still producing a Windows toast. Also where `notificationOptionsFor`, `notificationTitleFor` and `LegacyNotifyState` are deleted.

**Files:**
- Modify: `electron/preload.ts:86-118` (the two helpers) and `:303-351` (the install block)
- Modify: `electron/profile-view-manager.ts:164` (add `keyForWebContents`)
- Modify: `electron/main.ts` (the `WEB_NOTIFY_SHOW` handler and `activateToast`)
- Delete: `tests/preload-notification-options.test.ts`
- Test: `tests/preload-web-notify.test.ts` (create)

**Interfaces:**
- Consumes: `IPC.WEB_NOTIFY_SHOW`, `IPC.WEB_NOTIFY_CLICK` (Task 3); `Toast.webNotifyId` (Task 1); `showToast`, `toastAccountFor`, `activateToast`, `downloadClickPaths` (Task 6).
- Produces: `webNotifyPayload(id, title, options)` exported from `electron/preload.ts`; `ProfileViewManager.keyForWebContents(wc)`.

- [ ] **Step 1: Write the failing test**

Create `tests/preload-web-notify.test.ts`:

```ts
// What the page sends main when Gmail raises a notification. The raw subject travels with
// it: main applies the privacy replacement, the same way it does for push mail, and the
// page keeps the original so a click can still find the thread by its subject.

import { describe, expect, it } from 'vitest';
import { webNotifyPayload } from '../electron/preload';

describe('webNotifyPayload', () => {
  it('carries the title, the body and the id', () => {
    expect(webNotifyPayload('w1', 'Ada Lovelace', { body: 'Re: the engine' })).toEqual({
      id: 'w1',
      title: 'Ada Lovelace',
      body: 'Re: the engine',
    });
  });

  it('sends an empty body when the page passed no options', () => {
    expect(webNotifyPayload('w2', 'Ada', undefined)).toEqual({ id: 'w2', title: 'Ada', body: '' });
  });

  it('sends an empty body when the page passed options without one', () => {
    expect(webNotifyPayload('w3', 'Ada', { tag: 'x' })).toEqual({ id: 'w3', title: 'Ada', body: '' });
  });

  it('stringifies a body that is not a string', () => {
    expect(webNotifyPayload('w4', 'Ada', { body: 42 as unknown as string }).body).toBe('42');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/preload-web-notify.test.ts`
Expected: FAIL — `webNotifyPayload` is not exported.

- [ ] **Step 3: Replace the two helpers with one**

In `electron/preload.ts`, delete `notificationOptionsFor`, `notificationTitleFor` and the `LegacyNotifyState` type added in Task 3, and put this in their place:

```ts
export function webNotifyPayload(
  id: string,
  title: string,
  options?: NotificationOptions,
): { id: string; title: string; body: string } {
  const raw = options?.body;
  return { id, title, body: raw === undefined || raw === null ? '' : String(raw) };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/preload-web-notify.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Delete the obsolete test file**

```bash
git rm tests/preload-notification-options.test.ts
```

- [ ] **Step 6: Relay instead of constructing**

Replace the `Notification` wrapper block in `electron/preload.ts:324-346` with:

```ts
    // Gmail's own notifications are relayed to main rather than raised here: main draws
    // every notification the app gives, and only main knows the account this view belongs
    // to, whether it should stay, and what the privacy settings should replace. The stub
    // returned is the object Gmail's code goes on to use, so it has to answer to onclick,
    // close and addEventListener whatever we do with it. The original body is kept until
    // the click, because finding the thread means matching that subject in this page's
    // DOM, and by then main has long since replaced the text on screen.
    const bodies = new Map<string, string>();
    let webNotifySeq = 0;
    const Wrapped = function (this: Notification, title: string, options?: NotificationOptions) {
      if (!notifyState.show) {
        return { onclick: null, close() {}, addEventListener() {} } as unknown as Notification;
      }
      webNotifySeq += 1;
      const id = `w${webNotifySeq}`;
      const payload = webNotifyPayload(id, title, options);
      bodies.set(id, payload.body);
      ipcRenderer.send(IPC.WEB_NOTIFY_SHOW, payload);
      return {
        onclick: null,
        close: () => bodies.delete(id),
        addEventListener() {},
      } as unknown as Notification;
    } as unknown as typeof Notification;
    const Original = window.Notification;
    if (Original) {
      Object.defineProperty(Wrapped, 'permission', {
        configurable: true,
        get: () => Original.permission,
      });
      Wrapped.requestPermission = Original.requestPermission.bind(Original);
    }
    window.Notification = Wrapped;

    ipcRenderer.on(IPC.WEB_NOTIFY_CLICK, (_e: unknown, id: string) => {
      const body = bodies.get(id) ?? '';
      bodies.delete(id);
      const threadId = findThreadIdBySubject(document, body);
      ipcRenderer.send(IPC.NOTIFICATION_ACTIVATE, threadId ?? undefined);
    });
```

Note `window.Notification = Wrapped` now runs whether or not the page had a `Notification` constructor — a page without one still needs the relay. The permission getter is the only part that depends on the original.

Also update the file header at `electron/preload.ts:1-9`: the sentence about a click resolving its thread "from options.body and not from the text shown" is still true, but the reason changes. Replace that clause with:

```ts
// from the body the page gave us, which we keep, and never from the text on screen —
// main replaced that before drawing it.
```

- [ ] **Step 7: Let the view manager name the sender**

The handler needs to know which account a `WebContents` belongs to. The manager keys its views by `` `${accountKey}:${surface}` `` and already has the private `acctKeyOfViewKey` helper for reading the account back out (`electron/profile-view-manager.ts:38`). Add next to `activeKey()` at `:164`:

```ts
  /** Which account a view belongs to, for an event that arrives from the page itself. */
  keyForWebContents(wc: WebContents): string | null {
    for (const [vk, view] of this.views) {
      if (view.webContents === wc) return acctKeyOfViewKey(vk);
    }
    return null;
  }
```

Add `type WebContents` to the existing `from 'electron'` import at the top of that file.

- [ ] **Step 8: Handle the relay in main**

Two module-level maps, next to `downloadClickPaths` from Task 6:

```ts
// Which view raised a relayed notification. A click has to go back to that page, because
// the page is the only place that still knows the real subject, and finding the thread
// means matching that subject in its own DOM. Keyed by the page-side id, not the toast id,
// so the round trip carries the name the page will recognise.
const webNotifySources = new Map<string, Electron.WebContents>();
```

The handler, next to the toast handlers from Task 6:

```ts
  // Gmail raised a notification in one of its views. The account comes from which view
  // sent it, never from the page, and the privacy replacement is applied here so that one
  // place decides it for both notification paths. Push-covered accounts never get here:
  // notificationsAllowed already told that view to keep quiet.
  ipcMain.on(IPC.WEB_NOTIFY_SHOW, (e, arg: { id: string; title: string; body: string }) => {
    if (!prefs) return;
    const accountKey = manager?.keyForWebContents(e.sender) ?? null;
    const profile = accountKey ? profiles.find((p) => keyOf(p) === accountKey) : undefined;
    if (!profile) return;
    const p = prefs.getAll();
    const hidden = hiddenNotificationText(p);
    const L = nativeLabels(currentLocale(), p.reneMode === true);
    webNotifySources.set(arg.id, e.sender);
    showToast({
      kind: 'mail',
      title: hidden.hiddenSender ?? arg.title,
      body: hidden.hiddenSubject ?? (arg.body || L.noSubject),
      account: toastAccountFor(profile.email),
      webNotifyId: arg.id,
      persist: notificationPersist(p, profile.email),
    });
    if (!notificationSilent(p, profile.email, 'mail')) playNotificationSound(p);
  });
```

The card has no `messageId`, so it shows no action buttons — correct, since this path never learned one.

- [ ] **Step 9: Route its click back to the page**

Replace the whole of `activateToast` from Task 6 with the version that knows about the relay. The `webNotifyId` branch comes first: a relayed toast has an account and no thread, and sending it through `activateNotification` would open the account and stop there, losing the conversation.

```ts
function activateToast(toast: Toast): void {
  if (toast.webNotifyId) {
    const sender = webNotifySources.get(toast.webNotifyId);
    webNotifySources.delete(toast.webNotifyId);
    if (sender && !sender.isDestroyed()) {
      sender.send(IPC.WEB_NOTIFY_CLICK, toast.webNotifyId);
      return;
    }
    // The view is gone, so nothing can resolve the thread. Showing the account beats
    // swallowing the click.
    if (toast.account) activateNotification(toast.account.key, 'mail');
    return;
  }
  if (toast.kind === 'mail' && toast.account) {
    activateNotification(toast.account.key, 'mail', toast.threadId);
    return;
  }
  if (toast.kind === 'download' && toast.threadId) {
    const action = downloadClickPaths.get(toast.threadId);
    downloadClickPaths.delete(toast.threadId);
    if (action === 'open-file') void shell.openPath(toast.threadId);
    else if (action === 'show-in-folder') shell.showItemInFolder(toast.threadId);
    return;
  }
  if (toast.kind === 'update' || toast.kind === 'error') {
    openSettingsPanel();
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}
```

- [ ] **Step 10: Typecheck, build, run everything**

Run: `npx tsc --noEmit && npm run build && npm test`
Expected: all green. Six cases were deleted with `tests/preload-notification-options.test.ts` and four added, so the total moves by two; the exact number does not matter, a failure does.

- [ ] **Step 11: See it work**

Run: `npm run dev` with an account that is **not** push-covered (no OAuth connection), so Gmail's own notifications are the ones in play. Leave the app in the background and send that account a mail. Confirm a card appears in the stack — not a Windows toast — and that clicking it opens that conversation.

- [ ] **Step 12: Commit**

```bash
git add electron/preload.ts electron/main.ts electron/profile-view-manager.ts tests/preload-web-notify.test.ts
git commit -m "feat: relay the Gmail page's notifications into our own stack"
```

---

### Task 10: Release note

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Write the entry**

`CHANGELOG.md` is user-facing Dutch release copy, so this entry is Dutch — the one exception to the English rule at the top of this plan. Under `## [Nog niet uitgebracht]` → `### Toegevoegd`, at the end of the list:

```markdown
- **Eigen meldingen in plaats van Windows-meldingen.** Meldingen verschijnen nu
  rechtsonder in een eigen venster en stapelen wél: tot vijf kaartjes onder elkaar,
  en komt er een zesde bij, dan maakt de app er één melding van met het totaal
  erop. Ze blijven staan tot je ze wegklikt — dat deed Windows nooit, hoe vaak je
  het ook vroeg. Per account kun je dat uitzetten bij Instellingen → Meldingen;
  die meldingen verdwijnen dan na een paar tellen, en blijven staan zolang je
  muis erop staat. Beweeg je over een mailmelding, dan verschijnen Archiveren en
  Gelezen, zodat je een bericht kunt wegwerken zonder de app te openen.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entry for our own notifications"
```

---

## Final Verification

- [ ] `npm test` — every test passes
- [ ] `npx tsc --noEmit` — silent
- [ ] `npm run build` — renderer and main both build
- [ ] `npm run dev` — six test notifications in a row collapse to a summary; the summary's count keeps climbing on a seventh; clicking the summary brings the app forward and clears the stack
- [ ] Nothing in the app raises a Windows toast any more. Search the tree: `grep -rn "new Notification" electron/` should find exactly one hit, the fallback inside `showToast`.
