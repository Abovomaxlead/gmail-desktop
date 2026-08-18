// Reading thread ids and subjects out of Gmail's DOM for a drag, and the drop zone's
// geometry.

import { describe, it, expect } from 'vitest';
import {
  threadIdFromDragTarget,
  messageRefFromDragTarget,
  authuserFromPath,
  ikFromPage,
  resultText,
  dropOutcome,
  NOTHING_SAVED,
  DROPZONE_ID,
  DROPZONE_CSS,
  DROPZONE_Z,
  DRAG_CHROME_Z,
  selectedRows,
  rowsForDrag,
  threadSubjects,
  itemsForDrag,
  NO_SUBJECT,
  isOverZone,
  movedEnough,
} from '../electron/mail/dropzone';

function node(attrs: Record<string, string>, parent: any = null, descendants: any[] = []): any {
  return {
    getAttribute: (n: string) => attrs[n] ?? null,
    parentElement: parent,
    querySelectorAll: () => descendants,
  };
}

function gmailRow(threadId: string) {
  const subject = node({ 'data-legacy-thread-id': threadId });
  return node({ draggable: 'true', role: 'row' }, null, [subject]);
}

describe('threadIdFromDragTarget', () => {
  it('finds the id on the element itself', () => {
    expect(threadIdFromDragTarget(node({ 'data-legacy-thread-id': '18f2a' }))).toBe('18f2a');
  });
  it('walks up to an ancestor that carries the id', () => {
    const row = node({ 'data-legacy-thread-id': '18f2a' });
    const span = node({}, node({}, row));
    expect(threadIdFromDragTarget(span)).toBe('18f2a');
  });
  it('finds the id on the subject span inside the dragged row', () => {
    expect(threadIdFromDragTarget(gmailRow('18f2a'))).toBe('18f2a');
  });
  it('finds it from a cell inside that row too', () => {
    const row = gmailRow('18f2a');
    const cell = node({}, row);
    expect(threadIdFromDragTarget(cell)).toBe('18f2a');
  });
  it('refuses to guess when an ancestor holds several different ids', () => {
    const list = node({}, null, [
      node({ 'data-legacy-thread-id': 'a' }),
      node({ 'data-legacy-thread-id': 'b' }),
    ]);
    expect(threadIdFromDragTarget(list)).toBeNull();
  });
  it('returns null when no ancestor has one', () => {
    expect(threadIdFromDragTarget(node({}, node({})))).toBeNull();
    expect(threadIdFromDragTarget(null)).toBeNull();
  });
  // An opened conversation hangs all of its messages under one thread id, so a press in
  // the body would arm the strip on a gesture that is only selecting text. Dragging comes
  // from the list.
  it('refuses a press inside an opened conversation', () => {
    const conversation = node({ 'data-legacy-thread-id': '18f2a' });
    const message = node({ 'data-legacy-message-id': '19ff5f50' }, conversation);
    expect(threadIdFromDragTarget(node({}, node({}, message)))).toBeNull();
    expect(threadIdFromDragTarget(message)).toBeNull();
  });
  it('ignores an empty attribute value', () => {
    expect(threadIdFromDragTarget(node({ 'data-legacy-thread-id': '' }))).toBeNull();
  });
  it('stops after a sane number of levels instead of looping forever', () => {
    const self: any = { getAttribute: () => null, parentElement: null };
    self.parentElement = self;
    expect(threadIdFromDragTarget(self)).toBeNull();
  });
});

// A press inside an open conversation lands on one message of it, and that is the message
// the drag is about — the thread id alone cannot say which.
describe('messageRefFromDragTarget', () => {
  const gmailMessage = (legacy: string, perm?: string) =>
    node({ 'data-legacy-message-id': legacy, ...(perm ? { 'data-message-id': `#${perm}` } : {}) });

  it('finds the message the press landed on', () => {
    expect(messageRefFromDragTarget(gmailMessage('18f2a', 'msg-f:111'))).toEqual({
      legacyId: '18f2a',
      permId: 'msg-f:111',
    });
  });
  it('walks up from a span inside the message body', () => {
    const span = node({}, node({}, gmailMessage('18f2a', 'msg-f:111')));
    expect(messageRefFromDragTarget(span)?.legacyId).toBe('18f2a');
  });
  it('reads a message without a perm id', () => {
    expect(messageRefFromDragTarget(gmailMessage('18f2a'))).toEqual({ legacyId: '18f2a' });
  });
  // The older messages of an open conversation are collapsed, so the one message id below
  // a container is the last one — the message a drag on an older one wants to leave behind.
  it('never takes a message from below the press', () => {
    const conversation = node({}, null, [gmailMessage('laatste', 'msg-f:9')]);
    expect(messageRefFromDragTarget(conversation)).toBeNull();
  });
  it('is null on a list row, which carries no message id', () => {
    expect(messageRefFromDragTarget(gmailRow('18f2a'))).toBeNull();
    expect(messageRefFromDragTarget(null)).toBeNull();
  });
  it('ignores an empty attribute value', () => {
    expect(messageRefFromDragTarget(node({ 'data-legacy-message-id': '' }))).toBeNull();
  });
  it('stops after a sane number of levels instead of looping forever', () => {
    const self: any = { getAttribute: () => null, parentElement: null };
    self.parentElement = self;
    expect(messageRefFromDragTarget(self)).toBeNull();
  });

  // With conversation view off a list row is one message, and Gmail says which one behind
  // the pipe in data-thread-id. Without that pipe the row stands for the whole conversation.
  describe('a list row that is one message', () => {
    const messageRow = (thread: string, perm: string | null, last: string) => {
      const span = node({
        'data-thread-id': perm ? `#thread-a:r-693|${perm}` : '#thread-a:r-693',
        'data-legacy-thread-id': thread,
        'data-legacy-last-message-id': last,
      });
      return node({ role: 'row' }, null, [span]);
    };

    it('names the message the row stands for', () => {
      expect(messageRefFromDragTarget(messageRow('19ff5f3f', 'msg-f:181', '19ff5f50'))).toEqual({
        legacyId: '19ff5f50',
        permId: 'msg-f:181',
      });
    });
    it('finds it from a cell inside that row', () => {
      const cell = node({}, messageRow('19ff5f3f', 'msg-f:181', '19ff5f50'));
      expect(messageRefFromDragTarget(cell)?.legacyId).toBe('19ff5f50');
    });
    it('leaves a conversation row alone, whose last message is not what was grabbed', () => {
      expect(messageRefFromDragTarget(messageRow('19ff5f3f', null, '19ff5f50'))).toBeNull();
    });
    it('refuses to guess once the search reaches more than one row', () => {
      const list = node({}, null, [
        node({ 'data-thread-id': '#t|msg-f:1', 'data-legacy-last-message-id': 'a' }),
        node({ 'data-thread-id': '#t|msg-f:2', 'data-legacy-last-message-id': 'b' }),
      ]);
      expect(messageRefFromDragTarget(list)).toBeNull();
    });
  });
});

describe('selectedRows / rowsForDrag', () => {
  // The row carries role="row", the way Gmail marks it: that is what tells a row's tick
  // apart from the select-all in the toolbar, which no row encloses.
  const checkedRow = (threadId: string) => {
    const row = node({ role: 'row' }, null, [node({ 'data-legacy-thread-id': threadId })]);
    return node({ role: 'checkbox', 'aria-checked': 'true' }, row);
  };
  // With conversation view off a row is one message: same data-legacy-thread-id as its
  // siblings, told apart by what stands behind the pipe in data-thread-id.
  const checkedMessageRow = (threadId: string, perm: string, last: string) => {
    const span = node({
      'data-thread-id': `#thread-f:${threadId}|${perm}`,
      'data-legacy-thread-id': threadId,
      'data-legacy-last-message-id': last,
    });
    return node({ role: 'checkbox', 'aria-checked': 'true' }, node({ role: 'row' }, null, [span]));
  };
  const doc = (boxes: any[]) => ({ querySelectorAll: () => boxes });

  it('collects the thread id of every checked row', () => {
    expect(selectedRows(doc([checkedRow('a'), checkedRow('b')]))).toEqual([
      { threadId: 'a' },
      { threadId: 'b' },
    ]);
  });
  it('deduplicates conversation rows and skips rows without an id', () => {
    expect(selectedRows(doc([checkedRow('a'), checkedRow('a'), node({}, node({}))]))).toEqual([
      { threadId: 'a' },
    ]);
  });
  it('returns nothing when the selection is empty', () => {
    expect(selectedRows(doc([]))).toEqual([]);
  });

  // Measured in Gmail: three ticked rows, two of them messages of one conversation. Keying
  // the selection on the thread collapsed those two into one and dropped a mail.
  it('keeps two messages of one conversation apart', () => {
    const first = checkedMessageRow('1a00f50f', 'msg-f:1873768580910141322', '1a00f698');
    const other = checkedMessageRow('1a00f5fe', 'msg-f:1873767919121614861', '1a00f5fe');
    const second = checkedMessageRow('1a00f50f', 'msg-f:1873766890158687640', '1a00f50f');
    expect(selectedRows(doc([first, other, second]))).toEqual([
      { threadId: '1a00f50f', message: { legacyId: '1a00f698', permId: 'msg-f:1873768580910141322' } },
      { threadId: '1a00f5fe', message: { legacyId: '1a00f5fe', permId: 'msg-f:1873767919121614861' } },
      { threadId: '1a00f50f', message: { legacyId: '1a00f50f', permId: 'msg-f:1873766890158687640' } },
    ]);
  });
  it('still drops a row Gmail lists twice over', () => {
    const twice = () => checkedMessageRow('1a00f50f', 'msg-f:181', '1a00f698');
    expect(selectedRows(doc([twice(), twice()]))).toHaveLength(1);
  });

  // Gmail's own select-all sits in the toolbar and goes aria-checked="true" the moment every
  // visible row is ticked. It is no row, but in a list showing one conversation the search
  // below it reaches exactly one thread id, so it answered as a row that names no message --
  // measured in production, where two ticked messages of one conversation arrived as three
  // rows: two mails and one refused with "Kon niet zien welk bericht deze rij is".
  it('leaves out a ticked checkbox that sits outside the rows', () => {
    const first = checkedMessageRow('19fefd61', 'msg-f:1', '19fefd6a');
    const second = checkedMessageRow('19fefd61', 'msg-f:2', '19fefd6b');
    const selectAll = node(
      { role: 'checkbox', 'aria-checked': 'true' },
      node({}, null, [node({ 'data-legacy-thread-id': '19fefd61' })]),
    );
    expect(selectedRows(doc([selectAll, first, second]))).toEqual([
      { threadId: '19fefd61', message: { legacyId: '19fefd6a', permId: 'msg-f:1' } },
      { threadId: '19fefd61', message: { legacyId: '19fefd6b', permId: 'msg-f:2' } },
    ]);
  });

  it('drags the whole selection when the pressed row is part of it', () => {
    const rows = [{ threadId: 'a' }, { threadId: 'b' }, { threadId: 'c' }];
    expect(rowsForDrag({ threadId: 'b' }, rows)).toEqual(rows);
  });
  it('drags only the pressed row when it is outside the selection', () => {
    expect(rowsForDrag({ threadId: 'z' }, [{ threadId: 'a' }])).toEqual([{ threadId: 'z' }]);
  });
  it('drags only the pressed row when nothing is selected', () => {
    expect(rowsForDrag({ threadId: 'z' }, [])).toEqual([{ threadId: 'z' }]);
  });
  // Pressing an unticked message of a conversation whose other message is ticked drags that
  // message alone, the way Gmail treats a drag on a row outside the selection.
  it('tells two messages of one conversation apart when deciding what the press meant', () => {
    const ticked = [{ threadId: 'a', message: { permId: 'msg-f:1' } }];
    expect(rowsForDrag({ threadId: 'a', message: { permId: 'msg-f:2' } }, ticked)).toEqual([
      { threadId: 'a', message: { permId: 'msg-f:2' } },
    ]);
    expect(rowsForDrag({ threadId: 'a', message: { permId: 'msg-f:1' } }, ticked)).toEqual(ticked);
  });
});

describe('threadSubjects / itemsForDrag', () => {
  const subjectSpan = (id: string, text: string) => ({
    getAttribute: (n: string) => (n === 'data-legacy-thread-id' ? id : null),
    textContent: text,
    parentElement: null,
  });
  const doc = (els: any[]) => ({ querySelectorAll: () => els });

  it('maps every thread id to its subject', () => {
    expect(threadSubjects(doc([subjectSpan('a', 'Offerte week 31'), subjectSpan('b', 'Factuur')]))).toEqual({
      a: 'Offerte week 31',
      b: 'Factuur',
    });
  });
  it('collapses the whitespace Gmail leaves in the subject', () => {
    expect(threadSubjects(doc([subjectSpan('a', '  Offerte\n   week 31 ')]))).toEqual({
      a: 'Offerte week 31',
    });
  });
  it('keeps the first occurrence when an id appears twice', () => {
    expect(threadSubjects(doc([subjectSpan('a', 'Eerste'), subjectSpan('a', 'Tweede')]))).toEqual({
      a: 'Eerste',
    });
  });
  it('skips entries without an id or without text', () => {
    expect(threadSubjects(doc([subjectSpan('', 'x'), subjectSpan('b', '   ')]))).toEqual({});
  });

  it('pairs the dragged rows with their subjects, in order', () => {
    expect(itemsForDrag([{ threadId: 'b' }, { threadId: 'a' }], { a: 'Offerte', b: 'Factuur' })).toEqual([
      { threadId: 'b', subject: 'Factuur' },
      { threadId: 'a', subject: 'Offerte' },
    ]);
  });
  it('falls back to a placeholder when the subject is unknown', () => {
    expect(itemsForDrag([{ threadId: 'z' }], {})).toEqual([{ threadId: 'z', subject: NO_SUBJECT }]);
  });

  it('carries the message a row stands for', () => {
    expect(itemsForDrag([{ threadId: 'a', message: { legacyId: '18f2a' } }], { a: 'Offerte' })).toEqual([
      { threadId: 'a', subject: 'Offerte', message: { legacyId: '18f2a' } },
    ]);
  });
  // Every row names its own message, so a selection spanning one conversation still saves
  // the two mails that were ticked rather than that conversation's newest one twice.
  it('keeps every row its own message across a multi-row drag', () => {
    expect(
      itemsForDrag(
        [
          { threadId: 'a', message: { permId: 'msg-f:2' } },
          { threadId: 'b' },
          { threadId: 'a', message: { permId: 'msg-f:1' } },
        ],
        {},
      ),
    ).toEqual([
      { threadId: 'a', subject: NO_SUBJECT, message: { permId: 'msg-f:2' } },
      { threadId: 'b', subject: NO_SUBJECT },
      { threadId: 'a', subject: NO_SUBJECT, message: { permId: 'msg-f:1' } },
    ]);
  });

  // Measured in Gmail: three ticked rows of one conversation, of which the middle one's
  // data-thread-id came back without the message behind the pipe. That row fell through to
  // the conversation's newest message -- a mail nobody ticked, and one that another row of
  // the same drag had already saved.
  it('marks the row whose message went missing beside rows of its own conversation', () => {
    expect(
      itemsForDrag(
        [
          { threadId: 'a', message: { permId: 'msg-f:1' } },
          { threadId: 'a' },
          { threadId: 'a', message: { permId: 'msg-f:2' } },
        ],
        {},
      ),
    ).toEqual([
      { threadId: 'a', subject: NO_SUBJECT, message: { permId: 'msg-f:1' } },
      { threadId: 'a', subject: NO_SUBJECT, messageUnknown: true },
      { threadId: 'a', subject: NO_SUBJECT, message: { permId: 'msg-f:2' } },
    ]);
  });
  it('leaves the rows alone when no row of that conversation names a message', () => {
    expect(itemsForDrag([{ threadId: 'a' }, { threadId: 'b' }], {})).toEqual([
      { threadId: 'a', subject: NO_SUBJECT },
      { threadId: 'b', subject: NO_SUBJECT },
    ]);
  });
  it('does not mark a conversation row because another conversation is one message', () => {
    expect(
      itemsForDrag([{ threadId: 'a' }, { threadId: 'b', message: { permId: 'msg-f:1' } }], {}),
    ).toEqual([
      { threadId: 'a', subject: NO_SUBJECT },
      { threadId: 'b', subject: NO_SUBJECT, message: { permId: 'msg-f:1' } },
    ]);
  });
});

describe('authuserFromPath', () => {
  it('reads the authuser slot from the path', () => {
    expect(authuserFromPath('/mail/u/2/')).toBe('2');
    expect(authuserFromPath('/mail/u/0/#inbox')).toBe('0');
  });
  it('defaults to 0 when the path has no slot', () => {
    expect(authuserFromPath('/mail/')).toBe('0');
    expect(authuserFromPath('')).toBe('0');
  });
});

describe('ikFromPage', () => {
  it('prefers GLOBALS[9]', () => {
    const globals = new Array(12).fill(null);
    globals[9] = 'a1b2c3';
    expect(ikFromPage({ GLOBALS: globals }, '')).toBe('a1b2c3');
  });
  it('falls back to an ik parameter in the page html', () => {
    expect(ikFromPage({}, '<a href="/mail/u/0/?ik=deadbeef&view=om">x</a>')).toBe('deadbeef');
  });
  it('ignores a GLOBALS entry that is not a token', () => {
    const globals = new Array(12).fill(null);
    globals[9] = { not: 'a token' };
    expect(ikFromPage({ GLOBALS: globals }, '?ik=cafe01&')).toBe('cafe01');
  });
  it('returns null when neither is available', () => {
    expect(ikFromPage({}, '<html></html>')).toBeNull();
  });
});

// A row that saved nothing used to stay out of the total, so a drag of three that saved two
// reported "2 berichten opgeslagen" — the wording of a complete drop.
describe('dropOutcome', () => {
  it('reports a drop where every row produced a mail', () => {
    expect(dropOutcome([1, 1, 1])).toEqual({ ok: true, count: 3, total: 3 });
    expect(resultText(dropOutcome([1, 1, 1]))).toBe('3 berichten opgeslagen');
  });
  it('counts a row that failed towards the total', () => {
    expect(dropOutcome([1, 0, 1], 'HTTP 403')).toEqual({ ok: true, count: 2, total: 3 });
    expect(resultText(dropOutcome([1, 0, 1], 'HTTP 403'))).toBe('2 van 3 opgeslagen');
  });
  it('fails with the reason when no row produced anything', () => {
    expect(dropOutcome([0, 0], 'HTTP 403')).toEqual({
      ok: false,
      count: 0,
      total: 2,
      error: 'HTTP 403',
    });
  });
  it('still fails when nothing said why', () => {
    expect(dropOutcome([0])).toEqual({ ok: false, count: 0, total: 1, error: NOTHING_SAVED });
  });
  it('fails on a drop that found no rows at all', () => {
    expect(dropOutcome([], 'Geen mail gevonden in label "x"')).toEqual({
      ok: false,
      count: 0,
      total: 0,
      error: 'Geen mail gevonden in label "x"',
    });
  });
});

describe('resultText', () => {
  it('reports a full success', () => {
    expect(resultText({ ok: true, count: 3, total: 3 })).toBe('3 berichten opgeslagen');
  });
  it('uses the singular for one message', () => {
    expect(resultText({ ok: true, count: 1, total: 1 })).toBe('1 bericht opgeslagen');
  });
  it('reports a partial success', () => {
    expect(resultText({ ok: true, count: 2, total: 3 })).toBe('2 van 3 opgeslagen');
  });
  it('reports the error', () => {
    expect(resultText({ ok: false, count: 0, total: 0, error: 'HTTP 404' })).toBe('Mislukt: HTTP 404');
  });
});

describe('constants', () => {
  it('keeps the strip hidden until a drag arms it', () => {
    expect(DROPZONE_CSS).toContain('display: none');
    expect(DROPZONE_CSS).toContain('[data-state="armed"] { display: flex');
  });
  it('never lets the strip swallow clicks meant for Gmail', () => {
    expect(DROPZONE_CSS).toContain('pointer-events: none');
    expect(DROPZONE_CSS).not.toContain('pointer-events: auto');
  });

  it('scopes every css rule to the dropzone id', () => {
    const selectors = DROPZONE_CSS.split('}')
      .map((b) => b.split('{')[0].trim())
      .filter(Boolean);
    expect(selectors.length).toBeGreaterThan(0);
    for (const s of selectors) expect(s).toContain(`#${DROPZONE_ID}`);
  });
});

describe('isOverZone', () => {
  const rect = { left: 8, top: 8, right: 900, bottom: 64 };
  it('accepts a point inside the strip', () => {
    expect(isOverZone({ x: 400, y: 30 }, rect)).toBe(true);
  });
  it('accepts the exact edge', () => {
    expect(isOverZone({ x: 8, y: 8 }, rect)).toBe(true);
    expect(isOverZone({ x: 900, y: 64 }, rect)).toBe(true);
  });
  it('rejects a point below or beside the strip', () => {
    expect(isOverZone({ x: 400, y: 200 }, rect)).toBe(false);
    expect(isOverZone({ x: 950, y: 30 }, rect)).toBe(false);
  });
});

describe('movedEnough', () => {
  it('rejects a plain click that barely moves', () => {
    expect(movedEnough({ x: 100, y: 100 }, { x: 103, y: 98 })).toBe(false);
  });
  it('accepts a clear horizontal or vertical move', () => {
    expect(movedEnough({ x: 100, y: 100 }, { x: 120, y: 100 })).toBe(true);
    expect(movedEnough({ x: 100, y: 100 }, { x: 100, y: 60 })).toBe(true);
  });
  it('honours a custom threshold', () => {
    expect(movedEnough({ x: 0, y: 0 }, { x: 5, y: 0 }, 4)).toBe(true);
  });
});

describe('stacking', () => {
  it('leaves a layer above the strip for Gmail to draw its drag card in', () => {
    expect(DRAG_CHROME_Z).toBeGreaterThan(DROPZONE_Z);
  });

  it('keeps the strip on the layer the stylesheet actually uses', () => {
    expect(DROPZONE_CSS).toContain(`z-index: ${DROPZONE_Z};`);
  });

  it('stays at the top of what a page can stack', () => {
    expect(DRAG_CHROME_Z).toBe(2147483647);
  });
});
