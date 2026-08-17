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
  querySelectorAll?(sel: string): ArrayLike<{ getAttribute(name: string): string | null }>;
  parentElement: DragNode | null;
}

export interface LabelRef {
  hash: string;
  name: string;
}

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

export const ALWAYS_VISIBLE = false;

export const DROPZONE_Z = 2147483646;
export const DRAG_CHROME_Z = 2147483647;

export const DROPZONE_CSS = `
#${DROPZONE_ID} {
  position: fixed; top: 0; left: 0; right: 0; height: 56px;
  display: ${ALWAYS_VISIBLE ? 'flex' : 'none'}; align-items: center; justify-content: center;
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
`;

export const DROPZONE_LABEL = 'Sleep hier om de mail op te slaan';

export const NO_SUBJECT = '(geen onderwerp)';

export const NOTHING_SAVED = 'Niets opgeslagen';

export const DRAG_THRESHOLD = 15;

const MESSAGE_ID_ATTR = 'data-legacy-message-id';
const MESSAGE_PERM_ATTR = 'data-message-id';

const ROW_MESSAGE_ID_ATTR = 'data-legacy-last-message-id';
const ROW_THREAD_ATTR = 'data-thread-id';

const SYSTEM_VIEWS: Record<string, string> = {
  inbox: 'Postvak IN',
  starred: 'Met ster',
  snoozed: 'Snoozed',
  sent: 'Verzonden',
  drafts: 'Concepten',
  imp: 'Belangrijk',
  scheduled: 'Gepland',
  all: 'Alle berichten',
  spam: 'Spam',
  trash: 'Prullenbak',
};


//===========================
// Exported functions
//===========================

/**
 * Finds the conversation a drag started on
 *
 * The id sits deep inside the row and never on the drag target, so ancestors are searched
 * downwards too and a hit counts only when exactly one id is found — two mean the search
 * climbed into the list. A press inside an opened message is no drag, or the strip would
 * arm on selecting a line of text.
 *
 * @param el the element under the cursor when the press began
 * @returns the thread id, or null when the drag did not start on one row
 */
export function threadIdFromDragTarget(el: DragNode | null): string | null {
  let cur = el;
  for (let depth = 0; cur && depth < 30; depth++) {
    if (cur.getAttribute(MESSAGE_ID_ATTR)) return null;
    const own = cur.getAttribute('data-legacy-thread-id');
    if (own) return own;
    const inside = cur.querySelectorAll?.('[data-legacy-thread-id]');
    if (inside && inside.length > 0) {
      const ids = new Set<string>();
      for (let i = 0; i < inside.length; i++) {
        const id = inside[i].getAttribute('data-legacy-thread-id');
        if (id) ids.add(id);
      }
      if (ids.size === 1) return [...ids][0];
      if (ids.size > 1) return null;
    }
    const next: DragNode | null = cur.parentElement;
    if (next === cur) break;
    cur = next;
  }
  return null;
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

/**
 * Finds the label or system view a drag started on
 *
 * @param el the element under the cursor when the press began
 * @returns the route and the name to show, or null when it was not a view
 */
export function labelFromDragTarget(el: DragNode | null): LabelRef | null {
  let cur = el;
  for (let depth = 0; cur && depth < 30; depth++) {
    const href = cur.getAttribute('href');
    const hash = href && href.includes('#') ? href.slice(href.indexOf('#') + 1) : '';
    if (hash) {
      const route = hash.replace(/\/p\d+$/, '');
      if (/^label\//i.test(route)) {
        const raw = route.slice('label/'.length);
        let name = raw;
        try {
          name = decodeURIComponent(raw);
        } catch {
        }
        if (name) return { hash: route, name: name.split('/').filter(Boolean).pop() || name };
      }
      const system = SYSTEM_VIEWS[route.toLowerCase()];
      if (system) return { hash: route.toLowerCase(), name: system };
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

/**
 * Pairs every dragged row with the subject to show
 *
 * The message each row names travels with it however many rows the drag carries: it says
 * which mail of that conversation was ticked, which a selection needs as much as one row.
 *
 * @param rows
 * @param subjects
 * @returns one item per row, in drag order
 */
export function itemsForDrag(
  rows: DragRow[],
  subjects: Record<string, string>,
): Array<{ threadId: string; subject: string; message?: MessageRef }> {
  return rows.map((row) => ({
    threadId: row.threadId,
    subject: subjects[row.threadId] || NO_SUBJECT,
    ...(row.message ? { message: row.message } : {}),
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
