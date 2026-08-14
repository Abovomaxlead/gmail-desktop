// Dragging a label from Gmail's left navigation onto the dropzone. Recognition goes
// through the navigation link's href (`#label/<name>`), never Gmail's obfuscated
// class names or visible text, so it is language-independent and survives a rebuild
// of the navigation; only real labels have such an href, the inbox and sent items do
// not. That link covers the name alone, so the row around it is searched downwards as
// well — a press beside the name is still a press on that label.
//
// There is no API for listing a label, so pages of Gmail's own list view are scraped,
// reading the same data-legacy-thread-id subject spans as a single-thread drag. Gmail
// re-shows the last page for a too-high page number, so paging stops as soon as a
// page adds nothing new, and MAX_THREADS caps the total — reported when it bites,
// since truncating silently reads as "everything saved".

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

// Caps the total, and is reported when it bites: truncating silently reads as
// "everything saved".
export const MAX_THREADS = 200;
export const MAX_PAGES = Math.ceil(MAX_THREADS / PAGE_SIZE);


//===========================
// Exported functions
//===========================

/**
 * Reads the label name out of a navigation link
 *
 * @param href
 * @returns the label, or null when the href is not a label link
 */
export function labelFromHref(href: string): string | null {
  const m = /#label\/([^/?#]+)/.exec(href || '');
  if (!m) return null;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, ' ')) || null;
  } catch {
    return m[1] || null;
  }
}

/**
 * Finds the label a drag started on
 *
 * The link wraps the name and nothing else, while the row it sits in is the full width of
 * the navigation: the unread count, the hover menu and the space around the name are all
 * outside the anchor. A press there recognised no label, so the strip stayed away — and
 * the browser was free to start its own drag of the link, which swallows the mouse moves
 * the strip is armed by. Ancestors are therefore searched downwards too, and — as with a
 * conversation row — a hit counts only when exactly one label is found: two mean the
 * search climbed past the row into the navigation.
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
