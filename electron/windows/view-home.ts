// Whether a view still sits on the URL the app opened it with.
//
// A view's identity is that URL and nothing else, and it used to be forgotten the moment
// loadURL was called: reload went through webContents.reload(), which reloads wherever the
// page has since ended up. That is fine for a page the user navigated, and wrong for a page
// Google redirected. Signed out, a delegated /mail/u/<n>/d/<id>/ answers with a login page,
// and signing back in continues into the signed-in account's own inbox -- so the delegated
// view was left showing the wrong mail, and a reload cemented it rather than recovering it.
//
// Home is only ever set by the app itself, never by the page: ensureView records the URL a
// view was built from, and a deliberate in-app navigation moves it. A redirect the app did
// not ask for therefore reads as having left home, which is exactly the case to recover.


//===========================
// Exported functions
//===========================

/**
 * Whether a view has been taken off the URL the app opened it with
 *
 * @param home the URL the view was opened with, or last deliberately navigated to
 * @param current where the view is now
 * @returns true only when both URLs are readable and current is no longer inside home --
 *   an unreadable or missing URL answers false, since it must never cost the user the page
 *   they are on
 */
export function viewLeftItsHome(
  home: string | null | undefined,
  current: string | null | undefined,
): boolean {
  const from = placeOf(home);
  const at = placeOf(current);
  if (!from || !at) return false;
  if (from.origin !== at.origin) return true;
  return !startsWithSegments(at.segments, from.segments);
}


//===========================
// Helper functions
//===========================

/**
 * Where a URL points, with everything that does not move a view stripped off
 *
 * The hash goes because Gmail routes a whole mailbox through it -- a thread open at
 * #inbox/<id> has not left its mailbox -- and the query goes because Google appends its own.
 *
 * @param url
 * @returns the origin and path segments, or null when the URL is missing or unparseable
 * @private
 */
function placeOf(url: string | null | undefined): { origin: string; segments: string[] } | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return {
      origin: parsed.origin.toLowerCase(),
      segments: parsed.pathname.split('/').filter(Boolean),
    };
  } catch {
    return null;
  }
}

/**
 * Whether one path is inside another
 *
 * Compared segment by segment and never as a string, so /mail/u/1/ is not read as the home
 * of /mail/u/10/.
 *
 * @param at where the view is now
 * @param from where it belongs
 * @returns true when at is from, or a page below it
 * @private
 */
function startsWithSegments(at: string[], from: string[]): boolean {
  if (at.length < from.length) return false;
  return from.every((segment, i) => at[i] === segment);
}
