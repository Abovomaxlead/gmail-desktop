// Which tabs a window draws once a mailbox can be dragged out into a window of its own.
//
// The two kinds of window ask opposite questions, and getting that backwards is how a
// mailbox ends up with a tab in two strips at once, or with none anywhere: a torn-off window
// draws what it was given, the main window draws everything that was not given away. The
// main window's strip also holds rows no window can claim -- an account remembered from the
// cache whose address detection has not recovered yet -- which is why it is told what to
// leave out rather than what to show.

import { describe, it, expect } from 'vitest';
import { ALL_TABS, tabsForWindow } from '../renderer/lib/window-tabs';

const rows = [{ key: 'u0' }, { key: 'u1' }, { key: 'd:shared@example.nl' }, { key: 'seed:new@example.nl' }];

describe('tabsForWindow', () => {
  it('draws every row before main has said anything', () => {
    expect(tabsForWindow(rows, ALL_TABS)).toEqual(rows);
  });

  it('leaves a mailbox that lives in another window out of the main strip', () => {
    const tabs = tabsForWindow(rows, { detached: false, own: [], foreign: ['u1'] });
    expect(tabs.map((r) => r.key)).toEqual(['u0', 'd:shared@example.nl', 'seed:new@example.nl']);
  });

  it('keeps a row no window claimed in the main strip', () => {
    const tabs = tabsForWindow(rows, { detached: false, own: [], foreign: ['u0', 'u1'] });
    expect(tabs.map((r) => r.key)).toEqual(['d:shared@example.nl', 'seed:new@example.nl']);
  });

  it('draws nothing but its own mailboxes in a torn-off window', () => {
    const tabs = tabsForWindow(rows, {
      detached: true,
      own: ['u1', 'd:shared@example.nl'],
      foreign: ['u0'],
    });
    expect(tabs.map((r) => r.key)).toEqual(['u1', 'd:shared@example.nl']);
  });

  it('keeps the bar order, not the order the mailboxes were dragged out in', () => {
    const tabs = tabsForWindow(rows, { detached: true, own: ['d:shared@example.nl', 'u0'], foreign: [] });
    expect(tabs.map((r) => r.key)).toEqual(['u0', 'd:shared@example.nl']);
  });

  it('puts every mailbox in exactly one strip', () => {
    const main = tabsForWindow(rows, { detached: false, own: [], foreign: ['u1'] });
    const away = tabsForWindow(rows, { detached: true, own: ['u1'], foreign: [] });
    const drawn = [...main, ...away].map((r) => r.key);
    expect(new Set(drawn).size).toBe(drawn.length);
    expect(new Set(drawn)).toEqual(new Set(rows.map((r) => r.key)));
  });
});
