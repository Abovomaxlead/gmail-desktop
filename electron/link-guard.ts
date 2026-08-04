// Whether to ask before a link leaves for the browser, and where that link wants to
// go. Pure — no Electron, no dialog, main attaches the question — so the decision is
// testable without a window.
//
// This is the "Phishing Protection" tab. It gives the user one look at the host they
// are being sent to; it does not judge whether that host is malicious, and nothing is
// looked up. A trusted host covers its subdomains, which is why the comparison ends
// with ".host" rather than using `includes`: "example.com" on the list must not make
// "example.com.phish.test" trusted. No host in the URL means no question, since a
// `mailto:` or a bare path has no destination to show.

export function hostOf(url: string): string | null {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h || null;
  } catch {
    return null;
  }
}

export function isTrustedHost(host: string, trusted: readonly string[]): boolean {
  const h = host.toLowerCase();
  return trusted.some((t) => {
    const entry = t.trim().toLowerCase().replace(/^\.+/, '');
    if (!entry) return false;
    return h === entry || h.endsWith(`.${entry}`);
  });
}

export interface LinkGuardState {
  confirmExternalLinks: boolean;
  trustedHosts: readonly string[];
}

export function needsLinkConfirm(url: string, state: LinkGuardState): boolean {
  if (!state.confirmExternalLinks) return false;
  const host = hostOf(url);
  if (!host) return false;
  return !isTrustedHost(host, state.trustedHosts);
}
