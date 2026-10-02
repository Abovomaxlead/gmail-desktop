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
//
// The id changes every session, but an old one usually keeps working for a while. So a view
// opens straight away on the id it has, and the fresh one is only stored. Only a view that
// shows the wrong mailbox gets moved to the fresh id.

import { createHash } from 'node:crypto';
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
export type DelegatedRepair = 'load-stored' | 'send-home' | 'reread-url' | 'give-up';


//===========================
// Constants
//===========================

// "<page> - <address> - Gmail" is the shape every loaded mail view has. The address is taken
// from the segment in front of the suffix and never from the page part, which is where a
// subject sits -- and a subject may carry an address of its own.
const TITLE_MAILBOX = /-\s*([^\s@]+@[^\s@]+\.[^\s@]+)\s*-\s*Gmail\s*$/;

// Repairs a view gets before it says it cannot open the mailbox. Reset as soon as the view
// shows the right mailbox again, so the limit only stops a loop and never a later repair.
export const MAX_DELEGATED_REPAIRS = 4;

// Least time between two switcher reads for the same mailbox. One read loads a hidden Gmail
// page and waits on Google's widget frame, so a read that found nothing new is retried, but
// not on every sample.
export const REREAD_GAP_MS = 15_000;


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
 * What to do about a delegated view that is showing another mailbox
 *
 * A fresh url that is already stored comes first: the view was opened with an older one,
 * and moving it costs one navigation. Going home is next, the answer whenever the view was
 * redirected off a url that still works, and it is tried once per url. What is left needs a
 * new url from the switcher.
 *
 * @param view the mailbox's stored url, the url its view was opened with, where the view
 *   now sits, the url it was last sent home to, and how many repairs it has had since it
 *   last showed the right mailbox
 * @returns 'give-up' once the repairs have run out; 'load-stored' when a newer url is stored
 *   than the view has; 'send-home' when the view has left its url and was not yet sent back
 *   to it; 'reread-url' in every other case, including a current url that cannot be read
 */
export function delegatedRepairFor(view: {
  mailUrl: string | null;
  homeUrl: string | null;
  currentUrl: string | null | undefined;
  sentHomeFor: string | null;
  attempts: number;
}): DelegatedRepair {
  if (view.attempts >= MAX_DELEGATED_REPAIRS) return 'give-up';
  if (!view.mailUrl) return 'reread-url';
  if (view.homeUrl && view.homeUrl !== view.mailUrl) return 'load-stored';
  if (view.sentHomeFor === view.mailUrl) return 'reread-url';
  return viewLeftItsHome(view.mailUrl, view.currentUrl) ? 'send-home' : 'reread-url';
}

/**
 * Whether the switcher may be read again for one mailbox
 *
 * @param lastAt when it was last read for this mailbox, null when never
 * @param now
 * @returns true when it was never read, or at least REREAD_GAP_MS ago
 */
export function mayRereadSwitcher(lastAt: number | null, now: number): boolean {
  return lastAt === null || now - lastAt >= REREAD_GAP_MS;
}

/**
 * A short print of a mailbox url, for the log
 *
 * Says whether the id changed without ever writing the id, which is account data in a log
 * people send around.
 *
 * @param url
 * @returns eight hex characters, or 'none' when there is no url
 */
export function urlFingerprint(url: string | null): string {
  if (!url) return 'none';
  return createHash('sha256').update(url).digest('hex').slice(0, 8);
}
