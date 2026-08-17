// The delegation contract: the account-switcher DOM shape for delegated mailboxes.
// Pure and DOM-free, so it stays unit-testable.
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
