// Which conversation the page has open, read off a fake Gmail page. A card leaves on this
// answer, so the cases that matter are the ones where the thread id is on the page without
// that mail being newly opened: its row in the list, a conversation Gmail drew before and
// keeps hidden, and the conversation that was already open when the card arrived.

import { describe, expect, it } from 'vitest';
import { newlyOpened, openConversations, parseOpenConversations } from '../electron/gmail/open-conversation';

const OPENED = '1a01f12d2ec28372';
const LISTED = '1a01f14e87dea294';
const HIDDEN = '1a01f15f00aa0001';

/** Just enough of an element: a tag, attributes, text, a parent and layout. */
class El {
  parentElement: El | null = null;
  children: El[] = [];
  constructor(
    readonly tag: string,
    private attrs: Record<string, string>,
    public laidOut = true,
    public textContent: string | null = '',
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
  querySelectorAll(sel: string): El[] {
    const m = /^([a-z0-9]+)\[([a-z-]+)\]$/.exec(sel)!;
    const out: El[] = [];
    const walk = (el: El) => {
      for (const k of el.children) {
        if (k.tag === m[1] && k.getAttribute(m[2]) !== null) out.push(k);
        walk(k);
      }
    };
    walk(this);
    return out;
  }
}

const subjectLine = (id: string, subject: string, laidOut = true) =>
  new El('h2', { 'data-legacy-thread-id': id }, laidOut, subject);
const listRow = (id: string, subject: string) =>
  new El('tr', { role: 'row' }).append(new El('span', { 'data-legacy-thread-id': id }, true, subject));

describe('openConversations', () => {
  it('names only the conversation open on screen, not one merely listed or kept hidden', () => {
    const page = new El('body', {}).append(
      listRow(OPENED, 'Factuur'),
      listRow(LISTED, 'Offerte'),
      // Gmail keeps the conversation it showed before, hidden, beside the one it shows now
      new El('div', {}, false).append(subjectLine(OPENED, 'Factuur'), subjectLine(HIDDEN, 'Oud')),
      subjectLine(OPENED, ' Factuur\n'),
    );
    expect(openConversations(page)).toEqual([{ threadId: OPENED, subject: 'Factuur' }]);
  });
});

describe('newlyOpened', () => {
  it('reports a conversation only when it becomes the open one', () => {
    const now = [{ threadId: OPENED, subject: 'Factuur' }];
    expect(newlyOpened(new Set(), now)).toEqual(now);
    // already on screen when the card arrived: the reader opened nothing
    expect(newlyOpened(new Set([OPENED]), now)).toEqual([]);
  });
});

describe('parseOpenConversations', () => {
  it('drops whatever a page sends that is not a conversation', () => {
    expect(
      parseOpenConversations([{ threadId: OPENED, subject: 'Factuur' }, { threadId: 7 }, null, { subject: 'x' }]),
    ).toEqual([{ threadId: OPENED, subject: 'Factuur' }]);
    expect(parseOpenConversations('nope')).toEqual([]);
  });
});
