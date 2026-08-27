// Reading thread ids and subjects out of Gmail's DOM for a drag, and the drop zone's
// geometry.

import { describe, it, expect } from 'vitest';
import { labelFromDragTarget } from '../electron/mail/label-drop';
import {
  pressFromDragTarget,
  threadIdFromDragTarget,
  messageRefFromDragTarget,
  authuserFromPath,
  ikFromPage,
  resultText,
  savingText,
  SEARCHING_TEXT,
  DROPLOCK_ID,
  DROPLOCK_CSS,
  DROPLOCK_Z,
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
  CANCEL_ID,
  CANCEL_LABEL,
  cancelledText,
} from '../electron/mail/dropzone';

//===========================
// The fixture
//===========================

// The fake used to answer every querySelectorAll with the same hand-listed array, whatever
// the selector asked for, and that array was flat. Both halves of a guard that searches
// downwards were therefore untestable: a selector that matches nothing in the real DOM came
// back full here, and an element two levels down came back not at all. The fake now honours
// the selector and walks the subtree, so a fixture is a tree and reads like the page.

const ATTR_SELECTOR = /\[([a-zA-Z0-9-]+)(?:="([^"]*)")?\]/g;

/**
 * Whether one element answers an attribute selector
 *
 * @param el
 * @param sel one or more [attr] / [attr="value"] terms, which is all this module ever asks
 * @returns true when every term holds
 */
function matchesSelector(el: any, sel: string): boolean {
  const terms = [...sel.matchAll(ATTR_SELECTOR)];
  if (terms.length === 0) return false;
  return terms.every(([, name, want]) => {
    const have = el.getAttribute(name);
    return have !== null && (want === undefined || have === want);
  });
}

/**
 * One element of the fake page
 *
 * @param attrs
 * @param parent the element above it, for the upward walk
 * @param descendants the subtree below it; each one is given this element as its parent
 *   unless it already names another, so a fixture can be written either way round
 */
function node(attrs: Record<string, string>, parent: any = null, descendants: any[] = []): any {
  const self: any = {
    getAttribute: (n: string) => attrs[n] ?? null,
    parentElement: parent,
    children: descendants,
    querySelectorAll(sel: string) {
      const out: any[] = [];
      const walk = (kids: any[]) => {
        for (const kid of kids) {
          if (matchesSelector(kid, sel)) out.push(kid);
          walk(kid?.children ?? []);
        }
      };
      walk(self.children);
      return out;
    },
  };
  for (const kid of descendants) {
    if (kid && kid.parentElement === null) kid.parentElement = self;
  }
  return self;
}

/** The document, which is a node like any other so that selectedRows really has to filter. */
const docOf = (...descendants: any[]) => node({}, null, descendants);

// The h2 an opened conversation puts its subject in, as Gmail writes it: the thread named
// permanently, and no message of its own. Every fixture of an opened conversation uses this
// one, so a guard can never be proved against a heading Gmail does not write.
/** The subject line of an opened conversation */
const openedHeading = () =>
  node({
    'data-thread-perm-id': 'thread-f:1874125737797397702',
    'data-legacy-thread-id': '1a023b6',
  });

/** One message of an opened conversation, as the reading pane wraps it */
const openedMessage = (legacy = '1a023b6', perm = 'msg-f:187') =>
  node({ 'data-legacy-message-id': legacy, 'data-message-id': `#${perm}` }, null, [
    node({ _body: 'Beste, hierbij…' }),
  ]);

/** The card Gmail draws beside a message rather than inside it, as the invite card is drawn */
const gmailCard = () =>
  node({ 'data-card-id': '0:msg-f:187:extractedsmartmailevent' }, null, [node({ _title: 'x' })]);

// A list row as Gmail writes it: the ids sit on a span deep inside the row, the row itself
// is marked role="row", and the cells around the span carry nothing at all. `last` and
// `perm` are the two attributes the guards key on, so every case can be built from here.
/**
 * One row of the list
 *
 * @param threadId
 * @param opts `perm` names the thread permanently the way a row does beside the heading;
 *   `last` is the row's own last message, null to leave it off entirely; `message` hangs a
 *   chip naming a message under the row; `pipe` makes the row one message of a conversation
 * @returns the row, its cells addressable through `cells`
 */
function gmailRow(
  threadId: string,
  opts: { perm?: boolean; last?: string | null; message?: string; pipe?: string } = {},
) {
  const { perm = true, last = threadId, message, pipe } = opts;
  const ids = node({
    'data-thread-id': pipe ? `#thread-f:${threadId}|${pipe}` : `#thread-f:${threadId}`,
    'data-legacy-thread-id': threadId,
    ...(perm ? { 'data-thread-perm-id': `thread-f:${threadId}` } : {}),
    ...(last === null ? {} : { 'data-legacy-last-message-id': last }),
  });
  const sender = node({ _sender: 'x' });
  const date = node({ _date: 'x' });
  const chip = message ? node({ 'data-legacy-message-id': message }) : null;
  const row = node({ role: 'row' }, null, [ids, sender, date, ...(chip ? [chip] : [])]);
  return Object.assign(row, { cells: { ids, sender, date, chip } });
}

/** The reading pane of an opened conversation, with whatever Gmail hung beside the message */
const readingPane = (...beside: any[]) =>
  node({}, null, [
    node({}, null, [openedHeading()]),
    node({}, null, [openedMessage(), ...beside]),
  ]);

/** The list, as the column the rows live in */
const mailList = (...rows: any[]) => node({}, null, [node({}, null, [node({}, null, rows)])]);

/** One row of the navigation, whose link wraps the name alone */
const navRow = (label: string) =>
  node({ role: 'link' }, null, [node({ href: `#label/${label}` }, null, [node({ _name: 'x' })])]);

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
  // Gmail draws the card for a calendar invite beside the message instead of inside it, so
  // a press on it has no message id above it at all and the search climbed on to the
  // reading pane -- which names exactly one conversation and answered with it. Selecting
  // the appointment title armed the strip.
  // The pane names the conversation on the heading and nowhere else, which is the shape the
  // trace of 2026-08-27 recorded; the earlier fixture here named it on a subject node with
  // no perm id, a heading Gmail does not write.
  it('refuses a press in the card Gmail draws beside an opened message', () => {
    const pane = readingPane(gmailCard());
    const card = pane.querySelectorAll('[data-card-id]')[0];
    expect(threadIdFromDragTarget(card.children[0])).toBeNull();
  });
  // A row names its last message with data-legacy-last-message-id and never with
  // data-legacy-message-id, and the guard above must not read the two as one attribute.
  it('still arms on a list row that names its last message', () => {
    const span = node({
      'data-thread-id': '#thread-f:187',
      'data-legacy-thread-id': '18f2a',
      'data-legacy-last-message-id': '18f2a',
    });
    const row = node({ role: 'row' }, null, [span]);
    expect(threadIdFromDragTarget(node({}, row))).toBe('18f2a');
  });
  // The subject line of an opened conversation carries the thread id itself, so the press
  // lands straight on it and neither guard above ever comes into play. Gmail names the
  // thread permanently there and names no message at all, where a list row always names
  // its last one.
  it('refuses a press on the subject line of an opened conversation', () => {
    expect(threadIdFromDragTarget(openedHeading())).toBeNull();
  });
  // Beside the subject line there is no message either, so the search downwards found the
  // heading on its own and read it as the one row of a list.
  it('refuses a press beside that subject line', () => {
    const header = node({}, null, [openedHeading()]);
    expect(threadIdFromDragTarget(node({}, header))).toBeNull();
  });
  // The heading is known by the perm id together with showing no mark of a row, never by
  // the perm id alone: a row names the thread permanently too, and refusing it would break
  // dragging from the list. Either of a row's two marks is enough on its own, so both are
  // pinned apart -- the row around the span, and the span's own data-thread-id.
  it('still arms on a row that names its last message and the thread permanently', () => {
    expect(threadIdFromDragTarget(gmailRow('18f2a').cells.ids)).toBe('18f2a');
  });
  it('knows a row by the row around it, with no thread attribute of its own', () => {
    const span = node({ 'data-thread-perm-id': 'thread-f:187', 'data-legacy-thread-id': '18f2a' });
    expect(threadIdFromDragTarget(node({ role: 'row' }, null, [span]))).toBe('18f2a');
  });
  it('knows a row by its own data-thread-id, with no row around it', () => {
    const span = node({
      'data-thread-perm-id': 'thread-f:187',
      'data-legacy-thread-id': '18f2a',
      'data-thread-id': '#thread-f:187',
    });
    expect(threadIdFromDragTarget(span)).toBe('18f2a');
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

// A refused press and a press on nothing both answered null, so preload.ts could not tell
// them apart and offered the refused one to the label drag -- which pulls a whole label. The
// three kinds are the contract that fixes that, and these are the cases it turns on.
describe('pressFromDragTarget', () => {
  it('names the conversation of a list row', () => {
    expect(pressFromDragTarget(gmailRow('18f2a').cells.date)).toEqual({
      kind: 'row',
      threadId: '18f2a',
    });
  });
  it('answers none for a press that is not on mail at all', () => {
    expect(pressFromDragTarget(node({}, node({})))).toEqual({ kind: 'none' });
    expect(pressFromDragTarget(null)).toEqual({ kind: 'none' });
  });
  // Several rows is not a refusal. A press in the navigation reaches a container holding the
  // whole list within a few levels, and calling that "on mail" would stop every label drag.
  it('answers none for a press that reached the whole list', () => {
    expect(pressFromDragTarget(mailList(gmailRow('a'), gmailRow('b')))).toEqual({ kind: 'none' });
  });

  describe('a press on mail that is no drag', () => {
    it('refuses the subject line of an opened conversation', () => {
      expect(pressFromDragTarget(openedHeading())).toEqual({ kind: 'refused' });
    });
    it('refuses a press beside that subject line', () => {
      expect(pressFromDragTarget(readingPane().children[0])).toEqual({ kind: 'refused' });
    });
    it('refuses the card Gmail draws beside an opened message', () => {
      const pane = readingPane(gmailCard());
      expect(pressFromDragTarget(pane.querySelectorAll('[data-card-id]')[0].children[0])).toEqual({
        kind: 'refused',
      });
    });
    it('refuses a press inside the opened message itself', () => {
      const pane = readingPane();
      expect(pressFromDragTarget(pane.querySelectorAll('[data-legacy-message-id]')[0])).toEqual({
        kind: 'refused',
      });
    });
    // The upward walk answers with an ancestor that carries the id before any guard below it
    // is consulted, so a layout naming the conversation on the pane rather than on the
    // heading armed on the card exactly as it did before either fix.
    it('refuses a card under an ancestor that carries the thread id', () => {
      const card = gmailCard();
      const pane = node({ 'data-legacy-thread-id': '1a023b6' }, null, [openedMessage(), card]);
      expect(pressFromDragTarget(card.children[0])).toEqual({ kind: 'refused' });
      expect(threadIdFromDragTarget(card.children[0])).toBeNull();
    });
  });
});

// preload.ts hands a press the thread search did not claim to the label drag, and a label
// drag fetches every mail under that label. Before the two guards these presses answered
// with a thread id, which kept them out of that branch; answering null put them in it. The
// refusal is what keeps them out now, so it is asserted beside the label the same press
// would otherwise have been read as.
describe('a refused press never reaches the label drag', () => {
  /** An opened conversation with its own label chip beside the subject */
  const labelledConversation = () => {
    const chip = node({}, null, [node({ href: '#label/Klanten' })]);
    const heading = openedHeading();
    const card = gmailCard();
    const pane = node({}, null, [
      node({}, null, [heading, chip]),
      node({}, null, [openedMessage(), card]),
    ]);
    return { pane, heading, card };
  };

  it('refuses the subject line although a label link is in reach', () => {
    const { heading } = labelledConversation();
    expect(labelFromDragTarget(heading)).toBe('Klanten');
    expect(pressFromDragTarget(heading).kind).toBe('refused');
  });
  it('refuses the invite card although a label link is in reach', () => {
    const { card } = labelledConversation();
    expect(labelFromDragTarget(card.children[0])).toBe('Klanten');
    expect(pressFromDragTarget(card.children[0]).kind).toBe('refused');
  });
  it('refuses the header beside the subject although a label link is in reach', () => {
    const { pane } = labelledConversation();
    expect(labelFromDragTarget(pane.children[0])).toBe('Klanten');
    expect(pressFromDragTarget(pane.children[0]).kind).toBe('refused');
  });
});

// A guard too broad kills saving mail and says nothing: the strip simply never appears, and
// a ticked row it refuses leaves the drag without even the mark itemsForDrag raises for a
// row whose message could not be read. Every row Gmail may write has to keep arming.
describe('a list row keeps arming', () => {
  // Gmail was measured writing a row's ids incompletely -- the pipe missing from
  // data-thread-id on one row of three. Keying the heading on a row attribute being absent
  // made such a row read as the opened heading, and every press point in it went dead.
  it('arms on a row that names no last message', () => {
    const row = gmailRow('19fefd61', { last: null });
    expect(pressFromDragTarget(row.cells.ids)).toEqual({ kind: 'row', threadId: '19fefd61' });
    expect(threadIdFromDragTarget(row.cells.sender)).toBe('19fefd61');
    expect(threadIdFromDragTarget(row.cells.date)).toBe('19fefd61');
  });
  it('arms on a row whose last message is an empty attribute', () => {
    const row = gmailRow('19fefd62', { last: '' });
    expect(threadIdFromDragTarget(row.cells.ids)).toBe('19fefd62');
    expect(threadIdFromDragTarget(row.cells.date)).toBe('19fefd62');
  });
  // A row that happens to hold a message id below it -- an attachment chip naming the mail
  // it belongs to -- is still a row. Refusing it armed from the subject span and refused
  // from every other cell, which is the same row answering two ways.
  it('arms on a row whose subtree holds a message id, from every cell', () => {
    const row = gmailRow('18f2d', { message: '18f2d' });
    expect(threadIdFromDragTarget(row.cells.ids)).toBe('18f2d');
    expect(threadIdFromDragTarget(row.cells.sender)).toBe('18f2d');
    expect(threadIdFromDragTarget(row.cells.date)).toBe('18f2d');
  });

  const ticked = (row: any) => {
    const box = node({ role: 'checkbox', 'aria-checked': 'true' }, row);
    row.children.push(box);
    return row;
  };

  it('keeps a ticked row that names no last message in the selection', () => {
    const rows = [gmailRow('a'), gmailRow('b', { last: null }), gmailRow('c')].map(ticked);
    expect(selectedRows(docOf(mailList(...rows)))).toEqual([
      { threadId: 'a' },
      { threadId: 'b' },
      { threadId: 'c' },
    ]);
  });
  it('keeps a ticked row holding a message id in the selection', () => {
    const rows = [gmailRow('a'), gmailRow('b', { message: 'b' }), gmailRow('c')].map(ticked);
    expect(selectedRows(docOf(mailList(...rows)))).toHaveLength(3);
  });
});

// The list and the reading pane stand side by side under one ancestor, which no fixture
// could express while every pane was built without a parent. It is the one shape where the
// press on a card has rows above it as well as a message.
describe('split view', () => {
  const split = (...rows: any[]) =>
    node({}, null, [node({}, null, [mailList(...rows)]), node({}, null, [readingPane(gmailCard())])]);

  it('still arms on a row of the list beside the opened conversation', () => {
    const row = gmailRow('1a023b6');
    const page = split(row);
    expect(threadIdFromDragTarget(row.cells.date)).toBe('1a023b6');
    expect(page.querySelectorAll('[role="row"]')).toHaveLength(1);
  });
  it('refuses the card in the pane while the list shows that one conversation', () => {
    const page = split(gmailRow('1a023b6'));
    const card = page.querySelectorAll('[data-card-id]')[0];
    expect(pressFromDragTarget(card.children[0])).toEqual({ kind: 'refused' });
  });
  it('refuses the card in the pane while the list shows several conversations', () => {
    const page = split(gmailRow('a'), gmailRow('b'));
    const card = page.querySelectorAll('[data-card-id]')[0];
    expect(pressFromDragTarget(card.children[0]).kind).toBe('refused');
  });
});

// The three flows the app exists for. Each one is a whole gesture rather than a guard, so
// that a guard written for one of them can never be tightened past another in silence.
describe('the three reference flows keep working', () => {
  it('arms on a list row with conversation view on', () => {
    const row = gmailRow('18f2a');
    const page = docOf(mailList(row, gmailRow('18f2b')));
    expect(threadIdFromDragTarget(row.cells.date)).toBe('18f2a');
    expect(messageRefFromDragTarget(row.cells.date)).toBeNull();
    expect(threadSubjects(page)).toEqual({});
  });
  // With conversation view off every row is one message, and two rows of one conversation
  // share a thread id: only the message behind the pipe tells them apart.
  it('arms on a list row with conversation view off and keeps the two rows apart', () => {
    const first = gmailRow('1a00f50f', { pipe: 'msg-f:1', last: '1a00f698' });
    const second = gmailRow('1a00f50f', { pipe: 'msg-f:2', last: '1a00f50f' });
    expect(threadIdFromDragTarget(first.cells.date)).toBe('1a00f50f');
    expect(messageRefFromDragTarget(first.cells.date)).toEqual({
      legacyId: '1a00f698',
      permId: 'msg-f:1',
    });
    for (const row of [first, second]) {
      row.children.push(node({ role: 'checkbox', 'aria-checked': 'true' }, row));
    }
    expect(selectedRows(docOf(mailList(first, second)))).toEqual([
      { threadId: '1a00f50f', message: { legacyId: '1a00f698', permId: 'msg-f:1' } },
      { threadId: '1a00f50f', message: { legacyId: '1a00f50f', permId: 'msg-f:2' } },
    ]);
  });
  // The navigation sits beside the list, so the walk from a label reaches a container that
  // holds every row within a few levels. That must stay a label drag.
  it('drags a label out of the sidebar with the list in reach', () => {
    const row = navRow('Klanten');
    const name = row.querySelectorAll('[href]')[0].children[0];
    node({}, null, [node({}, null, [row, navRow('Offertes')]), mailList(gmailRow('a'), gmailRow('b'))]);
    expect(pressFromDragTarget(name)).toEqual({ kind: 'none' });
    expect(labelFromDragTarget(name)).toBe('Klanten');
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
  const doc = (boxes: any[]) => docOf(...boxes);

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
  const doc = (els: any[]) => docOf(...els);

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

// The strip reports what a cancelled pull managed before it was stopped, in the unit the pull
// counts in -- conversations, the same ones savingText was counting a moment earlier.
describe('cancelledText', () => {
  it('counts what a cancelled pull had already fetched', () => {
    expect(cancelledText(300)).toBe('Geannuleerd — 300 conversaties opgehaald');
  });
  it('says one conversation in the singular', () => {
    expect(cancelledText(1)).toBe('Geannuleerd — 1 conversatie opgehaald');
  });
  // Its own line rather than "0 conversaties": a cancel that caught the pull before anything
  // landed leaves nothing behind, and a count of nothing reads as a number that went wrong.
  it('has a line of its own for a pull that fetched nothing', () => {
    expect(cancelledText(0)).toBe('Geannuleerd, niets opgehaald');
  });
  it('reads a count below zero as nothing fetched', () => {
    expect(cancelledText(-5)).toBe('Geannuleerd, niets opgehaald');
  });
});

/** Every rule of a stylesheet as selector and declarations, which is all these tests need to
 * ask which selector carries a property rather than whether the sheet mentions it anywhere. */
function rulesOf(css: string): Array<{ selector: string; body: string }> {
  return css
    .split('}')
    .map((block) => {
      const [selector, body] = block.split('{');
      return { selector: (selector ?? '').trim(), body: (body ?? '').trim() };
    })
    .filter((rule) => rule.selector && rule.body);
}

/**
 * The display value one rule sets
 *
 * Read out rather than matched with a negative lookahead: `display:\s*(?!none)` also matches
 * `display: none`, because the optional whitespace backtracks to nothing and the lookahead
 * then reads the space instead of the value.
 *
 * @param body the rule's declarations
 * @returns the value, or null when the rule does not set display at all
 */
function displayOf(body: string): string | null {
  const found = /(?:^|;)\s*display:\s*([^;]+)/.exec(body);
  return found ? found[1].trim() : null;
}

describe('constants', () => {
  it('keeps the strip hidden until a drag arms it', () => {
    expect(DROPZONE_CSS).toContain('display: none');
    expect(DROPZONE_CSS).toContain('[data-state="armed"] { display: flex');
  });

  // Sharpened rather than relaxed when the cancel button arrived. Asserting that the sheet
  // nowhere says 'pointer-events: auto' stopped being the promise worth keeping -- the promise
  // is that the strip's own surface passes clicks through to Gmail, and that exactly one
  // element inside it may take them. So this now names the rule each value is allowed on,
  // which the flat string check could not do.
  it('never lets the strip itself swallow clicks meant for Gmail', () => {
    const strip = rulesOf(DROPZONE_CSS).find((r) => r.selector === `#${DROPZONE_ID}`);
    expect(strip?.body).toContain('pointer-events: none');
  });

  it('lets the cancel button, and nothing else, take a click', () => {
    const takesClicks = rulesOf(DROPZONE_CSS).filter((r) => r.body.includes('pointer-events: auto'));
    expect(takesClicks).toHaveLength(1);
    expect(takesClicks[0].selector).toContain(`#${CANCEL_ID}`);
  });

  it('names the cancel button so the page and the stylesheet agree', () => {
    expect(CANCEL_ID).toBe('gmd-dropzone-cancel');
    expect(CANCEL_LABEL).toBe('Annuleren');
    expect(DROPZONE_CSS).toContain(`#${CANCEL_ID}`);
  });

  // A finished drop has nothing left to cancel, so the button is gone in the two states that
  // report one. Decided here in css and not in the page, because the page's own script is
  // what draws the report and would have to remember to take the button away again.
  it('shows the cancel button while the strip is live and never on a report', () => {
    const shows = rulesOf(DROPZONE_CSS).filter((r) => {
      const display = displayOf(r.body);
      return r.selector.includes(`#${CANCEL_ID}`) && display !== null && display !== 'none';
    });
    expect(shows.length).toBeGreaterThan(0);
    for (const rule of shows) {
      expect(rule.selector).not.toContain('done');
      expect(rule.selector).not.toContain('failed');
    }
    const base = rulesOf(DROPZONE_CSS).find((r) => r.selector === `#${CANCEL_ID}`);
    expect(base?.body).toContain('display: none');
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

describe('savingText', () => {
  it('says it is still looking while the total is unknown', () => {
    expect(savingText(0, 0)).toBe(SEARCHING_TEXT);
  });
  it('counts the conversations pulled so far', () => {
    expect(savingText(0, 10)).toBe('0 van 10 opgehaald');
    expect(savingText(7, 10)).toBe('7 van 10 opgehaald');
    expect(savingText(10, 10)).toBe('10 van 10 opgehaald');
  });
  it('counts a single conversation as well', () => {
    expect(savingText(1, 1)).toBe('1 van 1 opgehaald');
  });
});

describe('the lock layer', () => {
  it('stays out of the way until a pull turns it on', () => {
    expect(DROPLOCK_CSS).toContain('display: none');
    expect(DROPLOCK_CSS).toContain('[data-state="on"] { display: block');
  });

  it('does swallow clicks, which is the whole point of it', () => {
    expect(DROPLOCK_CSS).toContain('pointer-events: auto');
  });

  it('covers the page rather than a strip of it', () => {
    for (const side of ['top: 0', 'left: 0', 'right: 0', 'bottom: 0']) {
      expect(DROPLOCK_CSS).toContain(side);
    }
  });

  it('sits under the strip that says why the page is locked', () => {
    expect(DROPLOCK_Z).toBeLessThan(DROPZONE_Z);
    expect(DROPLOCK_CSS).toContain(`z-index: ${DROPLOCK_Z};`);
  });

  it('scopes every rule to the lock id, so Gmail keeps its own styling', () => {
    const selectors = DROPLOCK_CSS.split('}')
      .map((b) => b.split('{')[0].trim())
      .filter(Boolean);
    expect(selectors.length).toBeGreaterThan(0);
    for (const s of selectors) expect(s).toContain(`#${DROPLOCK_ID}`);
  });

  it('keeps the two layers on ids of their own', () => {
    expect(DROPLOCK_ID).not.toBe(DROPZONE_ID);
  });
});