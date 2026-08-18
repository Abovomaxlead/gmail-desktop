// Dragging a label from Gmail's left navigation onto the dropzone. Recognised by the link's
// href (`#label/<name>`), which is language-independent and which only real labels have;
// the row around it is searched too, since a press beside the name still means that label.
//
// No API lists a label, so pages of Gmail's own list view are scraped. Gmail re-shows the
// last page for a too-high number, so paging stops when a page adds nothing new, and
// MAX_THREADS caps the total — reported when it bites, since truncating silently reads as
// "everything saved".

import type { DragNode } from './dropzone';



//===========================
// Types
//===========================

export interface LabelThread {
  threadId: string;
  subject: string;
}


//===========================
// Constants
//===========================

export const PAGE_SIZE = 50;

export const MAX_THREADS = 200;
export const MAX_PAGES = Math.ceil(MAX_THREADS / PAGE_SIZE);


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
 * Adds a scraped page to what has been collected
 *
 * @param acc mutated in place
 * @param page
 * @returns how many were new, and the running total
 */
export function mergeThreads(
  acc: LabelThread[],
  page: LabelThread[],
): { added: number; total: number } {
  const seen = new Set(acc.map((t) => t.threadId));
  let added = 0;
  for (const t of page) {
    if (!t.threadId || seen.has(t.threadId)) continue;
    if (acc.length >= MAX_THREADS) break;
    seen.add(t.threadId);
    acc.push(t);
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
