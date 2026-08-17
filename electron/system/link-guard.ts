// Whether to ask before a link leaves for the browser, and where it wants to go. Pure, so
// the decision is testable without a window; main attaches the dialog.
//
// This is the "Phishing Protection" tab: one look at the host, no judgement about whether
// it is malicious and nothing looked up. A trusted host covers its subdomains, which is why
// the comparison ends with ".host" — "example.com" must not trust "example.com.phish.test".
//
// Everything is decided on the unwrapped URL, since Gmail rewrites every outgoing link to
// `google.com/url?q=<target>`: judging it as-is would show "www.google.com" for all of
// them, and one "always allow" would silence the question for every link in every mail.

import { SURFACES, SURFACE_CONFIG } from '../../renderer/lib/surfaces';

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
