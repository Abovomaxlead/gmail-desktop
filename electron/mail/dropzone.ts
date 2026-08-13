// Pure parts of the drag-to-save dropzone; preload.ts attaches them to the DOM. It
// has to live inside the Gmail page, because drag & drop does not work between two
// Electron views. Dragging is tracked with mouse events rather than dragstart/drop —
// Gmail marks nothing draggable and reimplements dragging itself, so native HTML5 drag
// events never fire — and the drop is decided on coordinates, since the element under
// the cursor is Gmail's own drag image.
//
// Everything matches on structure, `role`/`aria-*` and hrefs, never on visible text or
// Gmail's obfuscated class names. data-legacy-thread-id sits on the subject span deep
// inside a row and never on the drag target, so ancestors are searched downwards too
// and a hit counts only when exactly one id is found. The strip's z-index is one below
// the maximum, leaving the top layer to Gmail's drag card. `ik` is Gmail's per-session
// request token, without which the show-original URL is refused.


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

// how far the cursor has to travel before a press counts as a drag, in pixels
export const DRAG_THRESHOLD = 15;

// Gmail's own views, which carry a bare route rather than a label/ one
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
 * The id sits on a subject span deep inside the row and never on the drag target, so
 * ancestors are searched downwards too and a hit counts only when exactly one id is
 * found — two ids mean the search climbed past the row into the list.
 *
 * @param el the element under the cursor when the press began
 * @returns the thread id, or null when the drag did not start on one row
 */
export function threadIdFromDragTarget(el: DragNode | null): string | null {
  let cur = el;
  for (let depth = 0; cur && depth < 30; depth++) {
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

/**
 * The conversations whose checkbox is ticked
 *
 * @param doc
 * @returns the thread ids, without duplicates, in list order
 */
export function selectedThreadIds(doc: DocLike): string[] {
  const boxes = doc.querySelectorAll('[role="checkbox"][aria-checked="true"]');
  const ids: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    const id = threadIdFromDragTarget(boxes[i]);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * What the drag carries: the selection, or only the row that was pressed
 *
 * @param pressed the thread the drag started on
 * @param selected the ticked threads
 * @returns the selection when the pressed row is part of it, otherwise that row alone
 */
export function threadIdsForDrag(pressed: string, selected: string[]): string[] {
  return selected.includes(pressed) ? selected : [pressed];
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
 * Pairs every dragged thread with the subject to show
 *
 * @param ids
 * @param subjects
 * @returns one item per id, in drag order
 */
export function itemsForDrag(
  ids: string[],
  subjects: Record<string, string>,
): Array<{ threadId: string; subject: string }> {
  return ids.map((threadId) => ({ threadId, subject: subjects[threadId] || NO_SUBJECT }));
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
