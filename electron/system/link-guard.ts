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
//
// Everything is decided on the unwrapped URL, never on what Gmail hands over. Gmail
// rewrites every outgoing link to `google.com/url?q=<real target>`, so judging the URL
// as-is would show "www.google.com" for all of them and — worse — a single tick of
// "always allow" would put that host on the trusted list and silence the question for
// every link in every mail from then on. Only google.com's own `/url` path is unwrapped,
// and only to an absolute http(s) target: a `/url` path on another host is that host's
// business, and a `javascript:` target must never be handed to a browser as a
// destination the user appeared to approve.

import { SURFACES, SURFACE_CONFIG } from '../../renderer/lib/surfaces';

// Google's own apps are never asked about: the app opens them itself, and a question
// about Drive on the way to Drive is noise, not protection. This list is deliberately its
// own thing rather than a reuse of IN_APP_HOSTS - that set decides what opens inside the
// app, and a host added there for a routing reason must not silently widen what phishing
// protection waves through. Matching is on the whole host, never a suffix, so
// "drive.google.com.phish.test" is still a question. The rest of google.com is not on the
// list: sites.google.com and friends carry whatever a stranger put there.
const GOOGLE_APP_HOSTS: readonly string[] = [
  ...SURFACES.map((s) => SURFACE_CONFIG[s].host),
  'accounts.google.com',
];

const REDIRECT_HOSTS = new Set(['google.com', 'www.google.com']);
const REDIRECT_PARAMS = ['q', 'url'];
const MAX_UNWRAP_HOPS = 3;


//===========================
// Types
//===========================

export interface LinkGuardState {
  confirmExternalLinks: boolean;
  trustedHosts: readonly string[];
}


//===========================
// Exported functions
//===========================

/**
 * Whether a host is one of Google's own apps
 *
 * @param host
 * @returns true on a whole-host match, never a suffix one
 */
export function isGoogleAppHost(host: string): boolean {
  return GOOGLE_APP_HOSTS.includes(host.toLowerCase());
}

/**
 * Follows Gmail's google.com/url wrapper to the real target
 *
 * @param url
 * @returns the unwrapped URL, or the input when it is not wrapped
 */
export function unwrapRedirect(url: string): string {
  let current = url;
  for (let hop = 0; hop < MAX_UNWRAP_HOPS; hop++) {
    const next = unwrapOnce(current);
    if (next === null) break;
    current = next;
  }
  return current;
}

/**
 * The host a URL points at
 *
 * @param url
 * @returns the lowercased host, or null when there is none to show
 */
export function hostOf(url: string): string | null {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h || null;
  } catch {
    return null;
  }
}

// A trusted host covers its subdomains, which is why the comparison ends with ".host"
// rather than using includes: "example.com" on the list must not make
// "example.com.phish.test" trusted.

/**
 * Whether the user put this host on the trusted list
 *
 * @param host
 * @param trusted
 * @returns true for the host itself and its subdomains
 */
export function isTrustedHost(host: string, trusted: readonly string[]): boolean {
  const h = host.toLowerCase();
  return trusted.some((t) => {
    const entry = t.trim().toLowerCase().replace(/^\.+/, '');
    if (!entry) return false;
    return h === entry || h.endsWith(`.${entry}`);
  });
}

/**
 * Whether to ask before this link leaves for the browser
 *
 * @param url as Gmail hands it over; it is unwrapped first
 * @param state
 * @returns true when the user should see the host first
 */
export function needsLinkConfirm(url: string, state: LinkGuardState): boolean {
  if (!state.confirmExternalLinks) return false;
  const host = hostOf(unwrapRedirect(url));
  if (!host) return false;
  if (isGoogleAppHost(host)) return false;
  return !isTrustedHost(host, state.trustedHosts);
}


//===========================
// Helper functions
//===========================

/**
 * Unwraps one redirect layer
 *
 * Only google.com's own /url path is unwrapped, and only to an absolute http(s) target:
 * a /url path on another host is that host's business, and a javascript: target must
 * never be handed to a browser as a destination the user appeared to approve.
 *
 * @param url
 * @returns the target, or null when there is nothing to unwrap
 * @private
 */
function unwrapOnce(url: string): string | null {
  let wrapper: URL;
  try {
    wrapper = new URL(url);
  } catch {
    return null;
  }
  if (!REDIRECT_HOSTS.has(wrapper.hostname.toLowerCase())) return null;
  if (wrapper.pathname !== '/url') return null;
  for (const param of REDIRECT_PARAMS) {
    const value = wrapper.searchParams.get(param);
    if (!value) continue;
    let target: URL;
    try {
      target = new URL(value);
    } catch {
      continue;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') continue;
    return target.href;
  }
  return null;
}
