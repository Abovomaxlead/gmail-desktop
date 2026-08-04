// The delegation contract: the Gmail URL forms and account-switcher DOM shape for
// delegated mailboxes. Pure and DOM-free, so it stays unit-testable.
//
// Rules that govern everything here: no OAuth or API, only the logged-in web session;
// match href structure and never UI text, since the "Gemachtigd"/"Delegated" badge is
// translated; and adopt Google's own URLs verbatim, because the token in `/d/<token>/`
// is opaque and cannot be derived from the email. SWITCHER_SCRAPE_JS must run inside
// the ogs.google.com widget frame via WebFrameMain.executeJavaScript — the mail view's
// own executeJavaScript is walled off cross-origin — and reads the email from the leaf
// element whose whole text is an email, since the anchor's concatenated textContent has
// no delimiters. delegatedCalendarUrl and isCalendarNoAccessUrl are stubs: those URL
// forms are not observed yet, and null/false there means "calendar unavailable".

export interface DelegatedEntry {
  email: string;
  mailUrl: string;
}

export function parseDelegatedEntries(
  raw: Array<{ email: string; href: string }>,
): DelegatedEntry[] {
  return raw
    .filter((r) => r.email && r.href)
    .map((r) => ({ email: r.email.trim().toLowerCase(), mailUrl: r.href }));
}

export function delegatedMailUrl(entry: DelegatedEntry): string {
  return entry.mailUrl;
}

export function isDelegatedMailUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'mail.google.com' && /^\/mail\/u\/\d+\/d\/[^/]+/.test(u.pathname);
  } catch {
    return false;
  }
}

export function delegatedCalendarUrl(_entry: DelegatedEntry): string | null {
  return null;
}

export function isCalendarNoAccessUrl(_finalUrl: string): boolean {
  return false;
}

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
