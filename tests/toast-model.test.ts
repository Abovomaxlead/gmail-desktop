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
