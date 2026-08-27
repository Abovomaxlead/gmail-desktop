// Pure parts of the drag-to-save dropzone; preload.ts attaches them to the DOM, inside the
// Gmail page, because drag & drop does not work between two Electron views.
//
// Dragging is tracked with mouse events rather than dragstart/drop, since Gmail marks
// nothing draggable and reimplements dragging itself, and the drop is decided on
// coordinates because the element under the cursor is Gmail's own drag image.
//
// Everything matches on structure, role/aria-* and hrefs, never on visible text or Gmail's
// obfuscated class names.


//===========================
// Types
//===========================

export interface DragNode {
  getAttribute(name: string): string | null;
  textContent?: string | null;
  // Full nodes rather than something that only reads attributes: telling the subject line of
  // an opened conversation from a row of the list is a question about what encloses an
  // element, so a candidate found downwards has to be walkable upwards as well.
  querySelectorAll?(sel: string): ArrayLike<DragNode>;
  parentElement: DragNode | null;
}

/** What a press turned out to be.
 *
 * 'row' names one conversation and is the only one that arms the strip. 'refused' is a press
 * on mail that is no drag -- an opened message, its subject line, a card Gmail drew beside
 * it. 'none' is a press that is not on mail at all, and it is the only one another gesture
 * may still claim: preload.ts offers exactly that one to the label drag.
 *
 * The two halves of "no row" have to stay apart. While both answered null, a press the
 * guards refused inside an opened conversation reached the label branch, where one label
 * link in reach turned selecting the subject into a drag of every mail under that label. */
export type DragPress =
  | { kind: 'row'; threadId: string }
  | { kind: 'refused' }
  | { kind: 'none' };

export interface MessageRef {
  legacyId?: string;
  permId?: string;
}

/** One row of Gmail's list as a drag sees it. With conversation view on that is a whole
 * conversation and `message` stays empty; with it off every row is one message of a
 * conversation, and then the thread id alone cannot tell two ticked rows apart. */
export interface DragRow {
  threadId: string;
  message?: MessageRef;
}

export interface DocLike {
  querySelectorAll(sel: string): ArrayLike<DragNode>;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}


//===========================
// Constants
//===========================

export const DROPZONE_ID = 'gmd-dropzone';

export const DROPZONE_Z = 2147483646;
export const DRAG_CHROME_Z = 2147483647;

export const CANCEL_ID = 'gmd-dropzone-cancel';

export const CANCEL_LABEL = 'Annuleren';

// The strip passes clicks through to Gmail and one element inside it does not. A child may set
// pointer-events: auto under a parent that set none -- the property is inherited but not
// binding, so each element decides for itself -- which is what lets the strip stay a label
// while the button in it is a button. The surface around it goes on letting Gmail have the
// click, so nothing of the promise below is given up beyond this one element.
//
// Whether the button is on screen is decided here rather than in the page's own script: that
// script draws the report a finished drop ends on, and hiding the button would be one more
// thing it had to remember. A report has nothing left to cancel, so the two states that draw
// one -- done and failed -- match no rule that shows it.
export const DROPZONE_CSS = `
#${DROPZONE_ID} {
  position: fixed; top: 0; left: 0; right: 0; height: 56px;
  display: none; align-items: center; justify-content: center;
  box-sizing: border-box; margin: 8px;
  font: 500 14px/1.2 Roboto, Arial, sans-serif; color: #1a73e8;
  background: rgba(232, 240, 254, 0.97);
  border: 2px dashed #1a73e8; border-radius: 12px;
  z-index: ${DROPZONE_Z}; pointer-events: none;
}
#${DROPZONE_ID}[data-state="armed"] { display: flex; }
#${DROPZONE_ID}[data-state="over"] { display: flex; background: #d2e3fc; border-style: solid; }
#${DROPZONE_ID}[data-state="done"] { display: flex; color: #188038; border-color: #188038; background: rgba(230, 244, 234, 0.97); }
#${DROPZONE_ID}[data-state="failed"] { display: flex; color: #c5221f; border-color: #c5221f; background: rgba(252, 232, 230, 0.97); }
#${CANCEL_ID} {
  display: none; pointer-events: auto;
  margin-left: 16px; padding: 3px 12px;
  font: inherit; color: inherit;
  background: transparent; border: 1px solid currentColor; border-radius: 8px;
  cursor: pointer;
}
#${DROPZONE_ID}[data-state="armed"] #${CANCEL_ID} { display: inline-block; }
#${DROPZONE_ID}[data-state="over"] #${CANCEL_ID} { display: inline-block; }
`;

export const DROPZONE_LABEL = 'Sleep hier om de mail op te slaan';

export const NO_SUBJECT = '(geen onderwerp)';

export const NOTHING_SAVED = 'Niets opgeslagen';

export const DRAG_THRESHOLD = 15;

export const DROPLOCK_ID = 'gmd-droplock';

/** Just under the strip, so the veil covers Gmail and the line that says why stays legible
 * on top of it. */
export const DROPLOCK_Z = DROPZONE_Z - 1;

// The one layer in this file that swallows clicks wholesale: while mail is being pulled the
// page underneath must not answer a second drag, and a strip that only says so does not stop
// one. Apart, so the strip's own stylesheet keeps its promise -- which is no longer "never a
// click" but "no click but the cancel button's": the rule for DROPZONE_ID is still
// pointer-events none and passes everything through, and the rule for CANCEL_ID is the only
// one in that sheet setting auto.
export const DROPLOCK_CSS = `
#${DROPLOCK_ID} {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  display: none; cursor: progress;
  background: rgba(255, 255, 255, 0.45);
  z-index: ${DROPLOCK_Z}; pointer-events: auto;
}
#${DROPLOCK_ID}[data-state="on"] { display: block; }
`;

/** While the label is being listed there is nothing to count yet. */
export const SEARCHING_TEXT = 'Mail zoeken…';

/** What the other accounts' views say, since they are locked by a pull they did not start. */
export const PULLING_TEXT = 'Er wordt mail opgehaald…';

export const BUSY_TEXT = 'Er wordt al mail opgehaald';

export const SLOW_TEXT = 'Ophalen duurde te lang';

/** A cancel that caught the pull before a single conversation landed. Its own line rather than
 * a count of nothing, the same way NOTHING_SAVED is not "0 opgeslagen". */
export const CANCELLED_NOTHING = 'Geannuleerd, niets opgehaald';

const MESSAGE_ID_ATTR = 'data-legacy-message-id';
const MESSAGE_PERM_ATTR = 'data-message-id';

const ROW_MESSAGE_ID_ATTR = 'data-legacy-last-message-id';
const ROW_THREAD_ATTR = 'data-thread-id';

const HEADING_THREAD_ATTR = 'data-thread-perm-id';

/** Held as constants so the two kinds that carry nothing are one object each rather than a
 * fresh one per press. */
const REFUSED: DragPress = { kind: 'refused' };
const NONE: DragPress = { kind: 'none' };


//===========================
// Exported functions
//===========================

/**
 * Works out what a press was on
 *
 * The id sits deep inside the row and never on the drag target, so ancestors are searched
 * downwards too and a hit counts only when exactly one id is found. Everything that is not
 * that one row is then sorted into the two kinds the caller has to tell apart: a press on
 * mail that is no drag is refused, and only a press on nothing at all answers 'none'.
 *
 * Several ids is 'none' and not a refusal, deliberately. The navigation stands beside the
 * list, so the walk from a label link reaches a container holding every row within a few
 * levels; reading that as "on mail" would end the label drag.
 *
 * @param el the element under the cursor when the press began
 * @returns the row, a refusal, or nothing
 */
export function pressFromDragTarget(el: DragNode | null): DragPress {
  let cur = el;
  for (let depth = 0; cur && depth < 30; depth++) {
    if (cur.getAttribute(MESSAGE_ID_ATTR)) return REFUSED;
    if (isOpenedHeading(cur)) return REFUSED;
    const own = cur.getAttribute('data-legacy-thread-id');
    // The same test as the downward answer below. Without it here, a layout that names the
    // conversation on the pane rather than on the heading armed on every card beside the
    // message: the walk answered with the ancestor it found the id on and no guard ran.
    if (own) return isOpenedConversation(cur) ? REFUSED : { kind: 'row', threadId: own };
    const inside = cur.querySelectorAll?.('[data-legacy-thread-id]');
    if (inside && inside.length > 0) {
      const ids = new Set<string>();
      let heading = false;
      for (let i = 0; i < inside.length; i++) {
        if (isOpenedHeading(inside[i])) {
          heading = true;
          continue;
        }
        const id = inside[i].getAttribute('data-legacy-thread-id');
        if (id) ids.add(id);
      }
      if (ids.size === 1) {
        return isOpenedConversation(cur) ? REFUSED : { kind: 'row', threadId: [...ids][0] };
      }
      if (ids.size > 1) return NONE;
      // A heading and nothing else below: the reading pane, whose only named conversation is
      // the one it has open. This is the press beside the subject line.
      if (heading) return REFUSED;
    }
    const next: DragNode | null = cur.parentElement;
    if (next === cur) break;
    cur = next;
  }
  return NONE;
}

/**
 * Finds the conversation a drag started on
 *
 * @param el the element under the cursor when the press began
 * @returns the thread id, or null when the press did not name one row -- which a caller that
 *   has another gesture to offer the press to must read through pressFromDragTarget instead,
 *   since null here covers both a refusal and a press on nothing
 */
export function threadIdFromDragTarget(el: DragNode | null): string | null {
  const press = pressFromDragTarget(el);
  return press.kind === 'row' ? press.threadId : null;
}

/**
 * Finds the message of a conversation a drag started on
 *
 * Two places say it, searched differently. An open conversation puts the id above the
 * press, and looking down there finds the last message — exactly the one a drag on an
 * older message is leaving behind. A list row keeps it deep inside the row, so that one is
 * searched downwards under the thread's rule: exactly one hit counts.
 *
 * @param el the element under the cursor when the press began
 * @returns the ids of that message, or null when the press named a whole conversation
 */
export function messageRefFromDragTarget(el: DragNode | null): MessageRef | null {
  let cur = el;
  for (let depth = 0; cur && depth < 30; depth++) {
    if (cur.getAttribute(MESSAGE_ID_ATTR)) return refOf(cur);
    const own = rowRefOf(cur);
    if (own) return own;
    const inside = cur.querySelectorAll?.(`[${ROW_MESSAGE_ID_ATTR}]`);
    if (inside && inside.length > 0) {
      const ids = new Set<string>();
      for (let i = 0; i < inside.length; i++) {
        const id = inside[i].getAttribute(ROW_MESSAGE_ID_ATTR);
        if (id) ids.add(id);
      }
      if (ids.size > 1) return null;
      if (ids.size === 1) {
        for (let i = 0; i < inside.length; i++) {
          const row = rowRefOf(inside[i]);
          if (row) return row;
        }
        return null;
      }
    }
    const next: DragNode | null = cur.parentElement;
    if (next === cur) break;
    cur = next;
  }
  return null;
}

// Each row names its own message, not just its conversation. Two ticked messages of one
// conversation are two mails, and keying them on the thread threw the second one away and
// then saved that conversation's newest message for the first — the wrong mail, one short.

/**
 * The rows whose checkbox is ticked
 *
 * @param doc
 * @returns one entry per row, without duplicates, in list order
 */
export function selectedRows(doc: DocLike): DragRow[] {
  const boxes = doc.querySelectorAll('[role="checkbox"][aria-checked="true"]');
  const rows: DragRow[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < boxes.length; i++) {
    if (!insideOneRow(boxes[i])) continue;
    const threadId = threadIdFromDragTarget(boxes[i]);
    if (!threadId) continue;
    const message = messageRefFromDragTarget(boxes[i]);
    const row: DragRow = { threadId, ...(message ? { message } : {}) };
    const key = dragRowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows;
}

/**
 * What the drag carries: the selection, or only the row that was pressed
 *
 * @param pressed the row the drag started on
 * @param selected the ticked rows
 * @returns the selection when the pressed row is part of it, otherwise that row alone
 */
export function rowsForDrag(pressed: DragRow, selected: DragRow[]): DragRow[] {
  const key = dragRowKey(pressed);
  return selected.some((row) => dragRowKey(row) === key) ? selected : [pressed];
}

/**
 * Reads the subject line of every conversation on screen
 *
 * @param doc
 * @returns subject by thread id; the first row wins for a repeated id
 */
export function threadSubjects(doc: DocLike): Record<string, string> {
  const els = doc.querySelectorAll('[data-legacy-thread-id]');
  const out: Record<string, string> = {};
  for (let i = 0; i < els.length; i++) {
    const id = els[i].getAttribute('data-legacy-thread-id');
    if (!id || out[id]) continue;
    const text = (els[i].textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text) out[id] = text;
  }
  return out;
}

// A row that names no message while a sibling row of the same conversation names one is a
// read that failed, not a conversation: with conversation view off every row of the list is
// one message, so the two cannot stand in one drag together. Measured in Gmail on three
// ticked rows of one conversation, where the middle row's data-thread-id came back without
// the message behind the pipe. Left unmarked it reached main as a whole conversation and
// saved that conversation's newest message -- a mail nobody ticked, and one another row of
// the same drag had already saved, which is how three ticked rows became two mails and a
// duplicate.

/**
 * Pairs every dragged row with the subject to show
 *
 * The message each row names travels with it however many rows the drag carries: it says
 * which mail of that conversation was ticked, which a selection needs as much as one row.
 *
 * @param rows
 * @param subjects
 * @returns one item per row, in drag order, the unreadable ones marked
 */
export function itemsForDrag(
  rows: DragRow[],
  subjects: Record<string, string>,
): Array<{ threadId: string; subject: string; message?: MessageRef; messageUnknown?: true }> {
  const named = new Set(rows.filter((row) => row.message).map((row) => row.threadId));
  return rows.map((row) => ({
    threadId: row.threadId,
    subject: subjects[row.threadId] || NO_SUBJECT,
    ...(row.message ? { message: row.message } : {}),
    ...(!row.message && named.has(row.threadId) ? { messageUnknown: true as const } : {}),
  }));
}

export function isOverZone(p: Point, r: Rect): boolean {
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

/**
 * Whether a press has travelled far enough to be a drag
 *
 * @param from where the press began
 * @param to where the cursor is now
 * @param min in pixels, on either axis
 */
export function movedEnough(from: Point, to: Point, min = DRAG_THRESHOLD): boolean {
  return Math.abs(to.x - from.x) >= min || Math.abs(to.y - from.y) >= min;
}

/**
 * The account index Gmail has in its path
 *
 * @param pathname
 * @returns the digits of /mail/u/<n>, or '0' when the path carries none
 */
export function authuserFromPath(pathname: string): string {
  return (/\/mail\/u\/(\d+)/.exec(pathname || '') ?? [])[1] ?? '0';
}

/**
 * Digs out Gmail's per-session request token
 *
 * Without `ik` the show-original URL is refused. GLOBALS is where the page keeps it;
 * the HTML is searched as a fallback for the moment before that array is filled.
 *
 * @param win the Gmail window
 * @param html the page source
 * @returns the token, or null when neither place has one
 */
export function ikFromPage(win: { GLOBALS?: unknown }, html: string): string | null {
  const g = win.GLOBALS;
  if (Array.isArray(g) && typeof g[9] === 'string' && /^[0-9a-f]{4,}$/i.test(g[9])) return g[9];
  const m = /[?&]ik=([0-9a-f]{4,})/i.exec(html || '');
  return m ? m[1] : null;
}

/**
 * What a finished drop reports back to the strip
 *
 * Every dragged row counts towards the total, whether or not it produced a mail. A row that
 * failed is exactly what "2 van 3 opgeslagen" exists to say, and leaving it out of the total
 * made a short drop read as a complete one.
 *
 * @param saved how many mails each dragged row produced, in drag order
 * @param error the last failure a row named
 * @returns what resultText draws
 */
export function dropOutcome(
  saved: number[],
  error?: string,
): { ok: boolean; count: number; total: number; error?: string } {
  const count = saved.reduce((n, s) => n + s, 0);
  const total = saved.length;
  if (count === 0) return { ok: false, count: 0, total, error: error ?? NOTHING_SAVED };
  return { ok: true, count, total };
}

/**
 * What the strip says while mail is being pulled
 *
 * Conversations, not mails: both pull paths loop over conversations, and how many mails a
 * label holds is not known until every one of them has been fetched. A total of nothing means
 * the label is still being listed, which is the one moment there is nothing to count.
 *
 * @param done conversations pulled so far
 * @param total conversations this pull will fetch, or 0 while that is not known yet
 * @returns the line for the strip
 */
export function savingText(done: number, total: number): string {
  if (total <= 0) return SEARCHING_TEXT;
  return `${done} van ${total} opgehaald`;
}

/**
 * What the strip says once a pull has been cancelled
 *
 * Conversations, because that is what the line was counting a moment earlier -- see
 * savingText. The total is left out: a cancelled pull was never going to reach it, and naming
 * it invites the reading that the rest still follows.
 *
 * @param done conversations pulled before the cancel took effect
 * @returns the line for the strip, which counts what was kept
 */
export function cancelledText(done: number): string {
  if (done < 1) return CANCELLED_NOTHING;
  return `Geannuleerd — ${done} conversatie${done === 1 ? '' : 's'} opgehaald`;
}

/**
 * The line the strip shows once the drop is done
 *
 * @param r
 * @returns the message, which names the failure or counts what was saved
 */
export function resultText(r: { ok: boolean; count: number; total: number; error?: string }): string {
  if (!r.ok) return `Mislukt: ${r.error ?? 'onbekende fout'}`;
  if (r.count < r.total) return `${r.count} van ${r.total} opgeslagen`;
  return `${r.count} bericht${r.count === 1 ? '' : 'en'} opgeslagen`;
}


//===========================
// Helper functions
//===========================

// Gmail ticks more than rows. Its select-all sits in the toolbar, is a checkbox like any
// row's, and turns aria-checked="true" the moment every visible row is ticked. Nothing
// below it says which mail it is, and the search for a thread id climbs until it finds
// one, so in a list showing a single conversation it answered with that conversation --
// a row nobody ticked, naming no message, refused later as unreadable. Hence the ancestry
// check: a tick counts when it sits in a row, and the toolbar is not one.

/**
 * Whether a ticked checkbox belongs to one row of the list
 *
 * @param el the checkbox
 * @returns true when a row encloses it, by role or by carrying a thread id
 * @private
 */
function insideOneRow(el: DragNode | null): boolean {
  let cur = el;
  for (let depth = 0; cur && depth < 30; depth++) {
    if (cur.getAttribute('role') === 'row') return true;
    if (cur.getAttribute('data-legacy-thread-id')) return true;
    const next: DragNode | null = cur.parentElement;
    if (next === cur) break;
    cur = next;
  }
  return false;
}

// The subject line of an opened conversation carries the thread id itself, so a press on it
// never reaches the guards below and selecting the subject armed the strip. Beside it the
// header holds no message either, so a press next to the subject found that same heading
// downwards and read it as the one row of a list.
//
// The heading is known by what it has, never by what a row is missing. Keying it on the perm
// id together with the absence of data-legacy-last-message-id read any row Gmail wrote
// without that attribute -- or with it empty -- as the heading, and since the check aborts
// the walk rather than skipping the element, every press point in such a row went dead and
// the row vanished from a selection without a word. Gmail was measured writing a row's ids
// incompletely, so that was reachable.
//
// What the heading has is the perm id. What a row has is its own data-thread-id and a
// role="row" around it; either one is enough to know a row, and the heading shows neither.

/**
 * Whether an element is the subject line of an opened conversation
 *
 * @param el
 * @returns true when it names a thread permanently while showing no mark of a list row
 * @private
 */
function isOpenedHeading(el: DragNode): boolean {
  if (!el.getAttribute(HEADING_THREAD_ATTR)) return false;
  return !el.getAttribute(ROW_THREAD_ATTR) && !insideListRow(el);
}

/**
 * Whether a list row encloses an element, or is one
 *
 * Apart from insideOneRow, which also accepts an element that carries a thread id: the
 * heading carries one, so that test cannot be used to tell it from a row.
 *
 * @param el
 * @returns true when a role="row" stands at or above it
 * @private
 */
function insideListRow(el: DragNode): boolean {
  let cur: DragNode | null = el;
  for (let depth = 0; cur && depth < 30; depth++) {
    if (cur.getAttribute('role') === 'row') return true;
    const next: DragNode | null = cur.parentElement;
    if (next === cur) break;
    cur = next;
  }
  return false;
}

// Gmail hangs more under an opened conversation than its messages. A calendar invite gets a
// card of Gmail's own beside the message rather than inside it, and a press on that card
// passes no message id on its way up, so the guard above never fires. This is what still
// answers for two shapes the heading check cannot reach: a pane that names the conversation
// somewhere other than on its heading, and an ancestor that carries the id itself, which the
// upward walk answers with before anything else is asked.
//
// Narrowed to elements no row encloses. Unnarrowed it refused any row whose subtree happened
// to hold a message id -- an attachment chip naming the mail it belongs to would do it -- and
// that row then armed from its subject span, where the id is carried, and refused from every
// other cell, where it is found downwards. One row answering two ways.

/**
 * Whether an element stands for an opened conversation rather than a row of the list
 *
 * @param el the element the walk is about to answer with
 * @returns true when a message of an opened conversation hangs below it and no row encloses it
 * @private
 */
function isOpenedConversation(el: DragNode): boolean {
  if (insideListRow(el)) return false;
  const found = el.querySelectorAll?.(`[${MESSAGE_ID_ATTR}]`);
  if (!found) return false;
  for (let i = 0; i < found.length; i++) {
    if (found[i].getAttribute(MESSAGE_ID_ATTR)) return true;
  }
  return false;
}

/**
 * What makes a row the same row, for deduplicating and for recognising the press
 *
 * The message when the row stands for one, so two messages of a conversation stay two; the
 * thread when it stands for the whole conversation. Which one it is stays in the key, since
 * a thread id and a message id are not drawn from the same pot.
 *
 * @param row
 * @returns the key
 * @private
 */
function dragRowKey(row: DragRow): string {
  const permId = row.message?.permId;
  const legacyId = row.message?.legacyId;
  if (permId) return `msg:${permId}`;
  if (legacyId) return `msg:${legacyId}`;
  return `thread:${row.threadId}`;
}

/**
 * Reads both message ids off the block Gmail wraps a message in
 *
 * @param el
 * @returns the ids, the perm one without the hash Gmail writes in front of it
 * @private
 */
function refOf(el: { getAttribute(name: string): string | null }): MessageRef {
  const legacyId = el.getAttribute(MESSAGE_ID_ATTR) ?? '';
  const perm = (el.getAttribute(MESSAGE_PERM_ATTR) ?? '').replace(/^#/, '');
  return { ...(legacyId ? { legacyId } : {}), ...(perm ? { permId: perm } : {}) };
}

// The pipe is the whole decision: "#thread-a:r-693|msg-f:181" is one message of a thread,
// "#thread-a:r-693" is the thread itself. Without it the row stands for the conversation
// and its last message is not the message anybody grabbed.

/**
 * Reads the message a list row stands for
 *
 * @param el the span that carries the row's ids
 * @returns the ids, or null when this row is a whole conversation
 * @private
 */
function rowRefOf(el: { getAttribute(name: string): string | null }): MessageRef | null {
  const thread = el.getAttribute(ROW_THREAD_ATTR) ?? '';
  const pipe = thread.indexOf('|');
  if (pipe === -1) return null;
  const permId = thread.slice(pipe + 1).replace(/^#/, '');
  const legacyId = el.getAttribute(ROW_MESSAGE_ID_ATTR) ?? '';
  if (!legacyId && !permId) return null;
  return { ...(legacyId ? { legacyId } : {}), ...(permId ? { permId } : {}) };
}
