// Making Gmail's list show a card action now, run against a fake Gmail page the way the
// browser would run it: the script the app hands to the page is executed, not read.
//
// Hiding a row the list should still show loses the reader a mail until Gmail redraws, and a
// row Gmail reuses for other mail must not stay hidden, so those are the cases that matter.

import { describe, expect, it } from 'vitest';
import {
  HIDE_MAX_MS,
  LIST_REFRESH_SCRIPT,
  hideThreadRowsScript,
} from '../electron/gmail/list-refresh';

const THREAD = '1a18ca577d34bd1c';
const OTHER = '1a18ca45a39a1149';

/** Just enough of an element for the scripts: attributes, a parent, layout, style and events. */
class El {
  parentElement: El | null = null;
  children: El[] = [];
  events: string[] = [];
  style = { display: '' };
  constructor(
    public attrs: Record<string, string>,
    public laidOut = true,
  ) {}
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  append(...kids: El[]): this {
    for (const k of kids) {
      k.parentElement = this;
      this.children.push(k);
    }
    return this;
  }
  getClientRects(): unknown[] {
    for (let cur: El | null = this; cur; cur = cur.parentElement) if (!cur.laidOut) return [];
    return [{}];
  }
  dispatchEvent(e: { type: string }): boolean {
    this.events.push(e.type);
    return true;
  }
  matches(sel: string): boolean {
    return [...sel.matchAll(/\[([a-z-]+)(?:="([^"]+)")?\]/g)].every(([, name, value]) => {
      const v = this.getAttribute(name);
      return v !== null && (value === undefined || v === value);
    });
  }
  querySelectorAll(sel: string): El[] {
    const out: El[] = [];
    const walk = (el: El) => {
      for (const k of el.children) {
        if (k.matches(sel)) out.push(k);
        walk(k);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel: string): El | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
}

/** A list row as Gmail draws it: role="row" around the subject span that names the thread. */
function row(threadId: string): { row: El; subject: El } {
  const subject = new El({ 'data-legacy-thread-id': threadId });
  return { row: new El({ role: 'row' }).append(new El({}).append(subject)), subject };
}

/** The page's clock and observers, driven by hand. */
function page(doc: El, hash = '#inbox') {
  const observers: { cb: () => void; live: boolean }[] = [];
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  let now = 0;
  class MutationObserver {
    private entry: { cb: () => void; live: boolean };
    constructor(cb: () => void) {
      this.entry = { cb, live: false };
      observers.push(this.entry);
    }
    observe(): void {
      this.entry.live = true;
    }
    disconnect(): void {
      this.entry.live = false;
    }
  }
  class MouseEvent {
    constructor(readonly type: string) {}
  }
  const setTimeout = (fn: () => void, ms: number) => {
    const t = { at: now + ms, fn, live: true };
    timers.push(t);
    return t;
  };
  const clearTimeout = (t: { live: boolean }) => {
    t.live = false;
  };
  return {
    run: (script: string): unknown =>
      new Function(
        'document',
        'location',
        'MouseEvent',
        'MutationObserver',
        'setTimeout',
        'clearTimeout',
        'window',
        `return ${script}`,
      )(doc, { hash }, MouseEvent, MutationObserver, setTimeout, clearTimeout, {}),
    /** Gmail changed something inside an observed row. */
    mutate: () => {
      for (const o of observers) if (o.live) o.cb();
    },
    advance: (ms: number) => {
      now += ms;
      for (const t of timers) {
        if (t.live && t.at <= now) {
          t.live = false;
          t.fn();
        }
      }
    },
  };
}

describe('LIST_REFRESH_SCRIPT', () => {
  it('presses the Refresh on screen, not the one of a list Gmail keeps hidden', () => {
    const hidden = new El({ role: 'button', act: '20' });
    const shown = new El({ role: 'button', act: '20' });
    const doc = new El({}).append(new El({}, false).append(hidden), shown);

    expect(page(doc).run(LIST_REFRESH_SCRIPT)).toBe('pressed');
    expect(hidden.events).toEqual([]);
    expect(shown.events).toEqual(['mousedown', 'mouseup', 'click']);
  });

  it('finds Refresh by its label when the action id is gone', () => {
    const button = new El({ role: 'button', 'aria-label': 'Vernieuwen' });
    const doc = new El({}).append(new El({ role: 'button', 'aria-label': 'Archiveren' }), button);

    expect(page(doc).run(LIST_REFRESH_SCRIPT)).toBe('pressed');
    expect(button.events).toHaveLength(3);
  });

  it('answers missing with a conversation open', () => {
    const doc = new El({}).append(new El({ role: 'button', 'aria-label': 'Beantwoorden' }));
    expect(page(doc).run(LIST_REFRESH_SCRIPT)).toBe('missing');
  });
});

describe('hideThreadRowsScript', () => {
  it('hides the rows of the conversation and leaves other mail alone', () => {
    const gone = row(THREAD);
    const kept = row(OTHER);
    const doc = new El({}).append(gone.row, kept.row);

    expect(page(doc).run(hideThreadRowsScript(THREAD)!)).toBe(1);
    expect(gone.row.style.display).toBe('none');
    expect(kept.row.style.display).toBe('');
  });

  it('touches nothing outside the inbox, where an archived mail rightly stays', () => {
    const gone = row(THREAD);
    const doc = new El({}).append(gone.row);

    expect(page(doc, '#label/Klanten').run(hideThreadRowsScript(THREAD)!)).toBe(-1);
    expect(gone.row.style.display).toBe('');
  });

  it('counts a category tab as the inbox', () => {
    const doc = new El({}).append(row(THREAD).row);
    expect(page(doc, '#category/updates').run(hideThreadRowsScript(THREAD)!)).toBe(1);
  });

  it('shows the row again once Gmail reuses it for other mail', () => {
    const gone = row(THREAD);
    const doc = new El({}).append(gone.row);
    const p = page(doc);
    p.run(hideThreadRowsScript(THREAD)!);

    p.mutate();
    expect(gone.row.style.display).toBe('none');

    gone.subject.attrs['data-legacy-thread-id'] = OTHER;
    p.mutate();
    expect(gone.row.style.display).toBe('');
  });

  it('shows the row again after Gmail has had time to sync', () => {
    const gone = row(THREAD);
    const p = page(new El({}).append(gone.row));
    p.run(hideThreadRowsScript(THREAD)!);

    p.advance(HIDE_MAX_MS - 1);
    expect(gone.row.style.display).toBe('none');
    p.advance(1);
    expect(gone.row.style.display).toBe('');
  });

  it('never builds a script around an id Gmail did not write', () => {
    expect(hideThreadRowsScript('thread-f:1"])')).toBeNull();
  });
});
