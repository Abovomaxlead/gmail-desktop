// Whether the URL a delegated mailbox was opened with still opens that mailbox.
//
// The opaque id in /mail/u/<n>/d/<id>/ rotates, and Google does not say so: the old URL keeps
// answering, with the signed-in account's own mailbox behind it. The view goes on running under
// the delegated profile, so nothing in the app notices -- which is the report this exists for,
// "a delegated mailbox that always worked shows my own inbox".
//
// The signal is the page title, because it is the one thing the app can already read without
// asking Google anything: ProfileViewManager.titleOf(key, 'mail') hands it over, and the badge
// already counts unread out of it for every account the API does not cover. Gmail titles the
// mailbox that is on screen, so a delegated view whose title names another address is a view
// looking at the wrong mailbox.
//
// Matched on shape, never on words. The page part of a title is translated -- "Inbox",
// "Postvak IN" -- so only the address segment and the Gmail suffix are read.
//
// A wrong title has two causes, though, and only one of them is a rotated id. The other is
// a view redirected off a url that is still good: signed out, the delegated url answers with
// a login page, and signing back in continues into the signed-in account's own inbox.
// Scraping the switcher cannot cure that, since it hands back the same url -- what cures it
// is sending the view back where it belongs. delegatedRepairFor tells the two apart.

import { viewLeftItsHome } from '../windows/view-home';


//===========================
// Types
//===========================

/** What the title says about the URL behind a delegated view.
 *
 * 'unknown' is not a soft 'dead' and must never be treated as one: a view still loading, a
 * login page and a signed-out account all land there, and scraping the switcher for those
 * would cost a page load for a URL that was never broken. */
export type UrlVerdict = 'ok' | 'dead' | 'unknown';

/** What to do about a delegated view whose title names another mailbox. */
export type DelegatedRepair = 'send-home' | 'reread-url';


//===========================
// Constants
//===========================

// "<page> - <address> - Gmail" is the shape every loaded mail view has. The address is taken
// from the segment in front of the suffix and never from the page part, which is where a
// subject sits -- and a subject may carry an address of its own.
const TITLE_MAILBOX = /-\s*([^\s@]+@[^\s@]+\.[^\s@]+)\s*-\s*Gmail\s*$/;


//===========================
// Exported functions
//===========================

/**
 * The mailbox a page title says is on screen
 *
 * @param title the view's current page title
 * @returns the address, lowercased, or null when the title names none -- which covers a title
 *   that has not settled yet as well as a page that is not a mailbox at all
 */
export function titleMailbox(title: string | null | undefined): string | null {
  const found = TITLE_MAILBOX.exec(title ?? '');
  return found ? found[1].toLowerCase() : null;
}

/**
 * Whether the URL a delegated view was opened with still opens that mailbox
 *
 * @param email the mailbox the view was opened for
 * @param title the view's current page title
 * @returns 'dead' only when the title names a mailbox and it is a different one
 */
export function mailUrlVerdict(email: string, title: string | null | undefined): UrlVerdict {
  const shown = titleMailbox(title);
  if (!shown) return 'unknown';
  return shown === email.trim().toLowerCase() ? 'ok' : 'dead';
}

/**
 * Which delegated mailboxes are looking at somebody else's mail
 *
 * @param views one entry per delegated mail view, with the title it currently has
 * @returns the addresses whose URL has gone dead, each once, in the order given
 */
export function deadDelegatedUrls(
  views: Array<{ email: string; title: string | null | undefined }>,
): string[] {
  const dead: string[] = [];
  for (const view of views) {
    if (mailUrlVerdict(view.email, view.title) !== 'dead') continue;
    if (dead.some((e) => e.toLowerCase() === view.email.toLowerCase())) continue;
    dead.push(view.email);
  }
  return dead;
}

/**
 * What to do about a delegated view that is showing another mailbox
 *
 * Going home is tried first because it costs one navigation and no page scrape, and it is
 * the answer whenever the view was redirected off a url that still works. It is tried once
 * per url: a title that is still wrong afterwards means the url itself is the wrong one, and
 * only the switcher knows the new one.
 *
 * @param view the mailbox's stored url, where its view currently sits, and the url it was
 *   last sent home to -- null when it never was
 * @returns 'send-home' only when the view has demonstrably left its stored url and has not
 *   already been sent back to that same url; 'reread-url' in every other case, including a
 *   current url that cannot be read
 */
export function delegatedRepairFor(view: {
  mailUrl: string | null;
  currentUrl: string | null | undefined;
  sentHomeFor: string | null;
}): DelegatedRepair {
  if (!view.mailUrl) return 'reread-url';
  if (view.sentHomeFor === view.mailUrl) return 'reread-url';
  return viewLeftItsHome(view.mailUrl, view.currentUrl) ? 'send-home' : 'reread-url';
}
