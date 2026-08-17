// The delegation contract: the Gmail URL forms and account-switcher DOM shape for delegated
// mailboxes. Pure and DOM-free, so it stays unit-testable.
//
// Three rules hold throughout: the logged-in web session only, never OAuth; match href
// structure and never UI text, since the "Gemachtigd"/"Delegated" badge is translated; and
// adopt Google's URLs verbatim, because the token in `/d/<token>/` cannot be derived.



//===========================
// Types
//===========================

export interface DelegatedEntry {
  email: string;
  mailUrl: string;
}


//===========================
// Exported functions
//===========================

/**
 * Normalises what the switcher scrape returned
 *
 * @param raw email and href pairs, straight from the widget frame
 * @returns the usable entries, addresses lowercased
 */
export function parseDelegatedEntries(
  raw: Array<{ email: string; href: string }>,
): DelegatedEntry[] {
  return raw
    .filter((r) => r.email && r.href)
    .map((r) => ({ email: r.email.trim().toLowerCase(), mailUrl: r.href }));
}

/**
 * The URL a delegated mailbox opens at
 *
 * @param entry
 * @returns Google's own URL, adopted verbatim because its token cannot be derived
 */
export function delegatedMailUrl(entry: DelegatedEntry): string {
  return entry.mailUrl;
}

/**
 * Recognises a delegated mailbox URL by its shape
 *
 * @param url
 * @returns true for /mail/u/<n>/d/<token>/ on mail.google.com
 */
export function isDelegatedMailUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'mail.google.com' && /^\/mail\/u\/\d+\/d\/[^/]+/.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * The calendar URL for a delegated mailbox
 *
 * @param _entry
 * @returns always null; this URL form is not observed yet, and null means unavailable
 */
export function delegatedCalendarUrl(_entry: DelegatedEntry): string | null {
  return null;
}

/**
 * Whether a calendar navigation landed on a no-access page
 *
 * @param _finalUrl
 * @returns always false; the URL form is not observed yet
 */
export function isCalendarNoAccessUrl(_finalUrl: string): boolean {
  return false;
}


//===========================
// Constants
//===========================

// Runs inside the ogs.google.com widget frame via WebFrameMain.executeJavaScript — the mail
// view's own executeJavaScript is walled off cross-origin. The email is read off the leaf
// element whose whole text is an address, because the anchor's concatenated textContent has
// no delimiters.
export const SWITCHER_SCRAPE_JS = `(() => {
  var emailRe = /^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$/i;
  var out = [];
  var seen = {};
  var anchors = document.querySelectorAll('a[href]');
  for (var i = 0; i < anchors.length; i++) {
    var a = anchors[i];
    var href;
    try { href = new URL(a.href, location.href).href; } catch (e) { continue; }
    var path;
    try { path = new URL(href).pathname; } catch (e) { continue; }
    if (!/^\\/mail\\/u\\/\\d+\\/d\\/[^/]+/.test(path)) continue;
    var email = null;
    var leaves = a.querySelectorAll('*');
    for (var j = 0; j < leaves.length; j++) {
      if (leaves[j].children.length) continue;
      var txt = (leaves[j].textContent || '').trim();
      if (emailRe.test(txt)) { email = txt.toLowerCase(); break; }
    }
    if (!email || seen[email]) continue;
    seen[email] = 1;
    out.push({ email: email, href: href });
  }
  return out;
})()`;
