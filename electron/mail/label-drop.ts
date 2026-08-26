// Dragging a label from Gmail's left navigation onto the dropzone. Recognised by the link's
// href (`#label/<name>`), which is language-independent and which only real labels have;
// the row around it is searched too, since a press beside the name still means that label.
//
// No API lists a label, so pages of Gmail's own list view are scraped. Gmail re-shows the
// last page for a too-high number, so paging stops when a page adds nothing new, and the
// scrape caps the total at SCRAPE_MAX_THREADS and the API path at API_MAX_THREADS — reported
// when either bites, since truncating silently reads as "everything saved".

import type { DragNode } from './dropzone';



//===========================
// Types
//===========================

export interface LabelThread {
  threadId: string;
  subject: string;
}

/** One thread of a dragged tree, with the labels of that tree it turned up under. A thread in
 * both `Klanten` and `Klanten/Acme` is one thread with two labels, never two threads: it is
 * saved once and inserted once, carrying both destination labels. */
export interface TreeThread {
  threadId: string;
  subject: string;
  labels: string[];
}


//===========================
// Constants
//===========================

export const PAGE_SIZE = 50;

/** Where paging Gmail's own list view stops being worth it. The scrape reads 50 rows a page and
 * Gmail re-shows the last page for a page number past the end, so forty pages is the point past
 * which more paging buys guesses rather than rows. A real ceiling, and still reported when it
 * bites: truncating in silence reads as "everything saved". */
export const SCRAPE_MAX_THREADS = 2000;

/** A bound on the API path, not a limit anyone should meet. `threads.list` pages 100 ids for 10
 * units, so a full one is 500 pages and 5,000 units just to plan, and copying it would take a
 * day. It is here so a runaway page loop cannot allocate without end -- a different job from the
 * scrape's ceiling above, which is why the two are no longer one constant. */
export const API_MAX_THREADS = 50_000;

export const MAX_PAGES = Math.ceil(SCRAPE_MAX_THREADS / PAGE_SIZE);


//===========================
// Exported functions
//===========================

/**
 * Reads the label name out of a navigation link
 *
 * A nested label is one name with a slash in it, and Gmail writes it out in full. Stopping
 * at the first slash named the parent, so a dragged subfolder fetched the folder above it.
 * Only a trailing /p<number>, Gmail's page suffix, comes off.
 *
 * @param href
 * @returns the label, or null when the href is not a label link
 */
export function labelFromHref(href: string): string | null {
  const m = /#label\/([^?#]+)/.exec(href || '');
  if (!m) return null;
  const path = m[1].replace(/\/p\d+$/, '');
  if (!path) return null;
  try {
    return decodeURIComponent(path.replace(/\+/g, ' ')) || null;
  } catch {
    return path;
  }
}

/**
 * Finds the label a drag started on
 *
 * The link wraps the name alone, while the row spans the navigation, so a press beside the
 * name recognised nothing and let the browser start its own drag instead. Ancestors are
 * searched downwards too, and — as with a conversation row — exactly one hit counts.
 *
 * @param el the drag's target element
 * @returns the label, or null when the drag did not start on one
 */
export function labelFromDragTarget(el: DragNode | null): string | null {
  let cur = el;
  for (let depth = 0; cur && depth < 30; depth++) {
    const own = labelFromHref(cur.getAttribute('href') ?? '');
    if (own) return own;
    const inside = cur.querySelectorAll?.('[href]');
    if (inside && inside.length > 0) {
      const names = new Set<string>();
      for (let i = 0; i < inside.length; i++) {
        const name = labelFromHref(inside[i].getAttribute('href') ?? '');
        if (name) names.add(name);
      }
      if (names.size > 1) return null;
      if (names.size === 1) return [...names][0];
    }
    const next: DragNode | null = cur.parentElement;
    if (next === cur) break;
    cur = next;
  }
  return null;
}

/**
 * Every label named in a list of links
 *
 * The navigation links a label more than once -- the row, the paged views -- so a name counts
 * once however often it appears.
 *
 * @param hrefs
 * @returns the label names, in the order first seen
 */
export function labelNamesFromHrefs(hrefs: string[]): string[] {
  const out: string[] = [];
  for (const href of hrefs) {
    const name = labelFromHref(href);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * The URL of one page of a label's list view
 *
 * @param authuser
 * @param label
 * @param page 1-based
 * @returns the URL to navigate the scraping view to
 */
export function labelListUrl(authuser: string, label: string, page: number): string {
  const enc = encodeURIComponent(label).replace(/%2F/gi, '/');
  const suffix = page > 1 ? `/p${page}` : '';
  return `https://mail.google.com/mail/u/${authuser}/#label/${enc}${suffix}`;
}

// Gmail draws a list row by row, so the first scrape of a page answers with whatever had
// rendered in that instant — which is how a label of forty came back as a folder of two. A
// page is only taken once two reads in a row agree, and never while it is still the page
// before it.

/**
 * Whether a scraped page can be taken as the whole page
 *
 * @param before the read before this one, empty on the first try
 * @param now the read just taken
 * @param firstOfPreviousPage the first thread of the page already collected, which a page
 *   that has not been replaced yet still starts with
 * @returns true when the page has stopped changing and is not the previous one
 */
export function scrapeSettled(
  before: LabelThread[],
  now: LabelThread[],
  firstOfPreviousPage: string,
): boolean {
  if (now.length === 0) return false;
  if (now[0].threadId === firstOfPreviousPage) return false;
  if (before.length !== now.length) return false;
  return before.every((t, i) => t.threadId === now[i].threadId);
}

// Gmail re-shows the last page for a too-high page number, so paging stops as soon as a
// page adds nothing new.

/**
 * Adds one label's scraped page to the tree collected so far
 *
 * The cap counts threads, not entries: a thread already collected under another label of the
 * tree gains that label even at the cap, since it costs nothing new to save.
 *
 * @param acc mutated in place
 * @param member the tree label this page was read from
 * @param page
 * @param cap defaults to the scrape's own ceiling, so a caller that never named one keeps
 *   today's behaviour; the API path passes its own, which is a different limit entirely
 * @returns how many threads were new, and the running total
 */
export function mergeTreeThreads(
  acc: TreeThread[],
  member: string,
  page: LabelThread[],
  cap = SCRAPE_MAX_THREADS,
): { added: number; total: number } {
  const byId = new Map(acc.map((t) => [t.threadId, t]));
  let added = 0;
  for (const t of page) {
    if (!t.threadId) continue;
    const known = byId.get(t.threadId);
    if (known) {
      if (!known.labels.includes(member)) known.labels.push(member);
      continue;
    }
    if (acc.length >= cap) continue;
    const fresh: TreeThread = { threadId: t.threadId, subject: t.subject, labels: [member] };
    acc.push(fresh);
    byId.set(t.threadId, fresh);
    added += 1;
  }
  return { added, total: acc.length };
}

// There is no API for listing a label, so pages of Gmail's own list view are scraped,
// reading the same data-legacy-thread-id subject spans as a single-thread drag.
export const LABEL_SCRAPE_JS = `(() => {
  var out = [];
  var seen = {};
  var els = document.querySelectorAll('[data-legacy-thread-id]');
  for (var i = 0; i < els.length; i++) {
    var id = els[i].getAttribute('data-legacy-thread-id');
    if (!id || seen[id]) continue;
    seen[id] = 1;
    out.push({ threadId: id, subject: (els[i].textContent || '').replace(/\\s+/g, ' ').trim() });
  }
  return out;
})()`;

// Gmail's own navigation is the only list of sublabels there is without the API. Nothing is
// expanded to read it -- clicking Gmail's chevrons is exactly what breaks on their next
// release -- so a collapsed parent can hide children. What was found is shown in the picker
// before anything is copied, which is where a missing subfolder has to be visible.
export const SIDEBAR_LABEL_SCRAPE_JS = `(() => {
  var out = [];
  var els = document.querySelectorAll('a[href*="#label/"]');
  for (var i = 0; i < els.length; i++) out.push(els[i].getAttribute('href') || '');
  return out;
})()`;
