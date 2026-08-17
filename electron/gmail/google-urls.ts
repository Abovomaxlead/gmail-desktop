// URL predicates deciding whether a Google URL stays inside the app or goes to the browser.
// Pure, so external-links.ts can be reasoned about without a window.
//
// Each predicate exists because of a specific failure: a pop-out or the ?view=lg reader
// routed in-app replaces the inbox with no way back; an attachment URL is a file rather than
// a surface; about:blank handed to shell.openExternal pops a Windows dialog instead of the
// login window; and externalising a federation POST re-issues it as a GET, which Entra
// answers with AADSTS900561.

import { SURFACES, SURFACE_CONFIG } from '../../renderer/lib/surfaces';



//===========================
// Constants
//===========================

const MIN_SEARCH_TERM = 3;

const IN_APP_HOSTS = new Set([
  ...SURFACES.map((s) => SURFACE_CONFIG[s].host),
  'accounts.google.com',
]);

const FEDERATED_LOGIN_HOSTS = new Set([
  'login.microsoftonline.com',
  'login.microsoft.com',
  'login.windows.net',
  'login.live.com',
]);


//===========================
// Exported functions
//===========================

/**
 * The mail URL for an account position
 *
 * @param index the authuser index
 * @returns the surface URL
 */
export function mailUrl(index: number): string {
  return SURFACE_CONFIG.mail.url({ kind: 'authuser', index });
}

/**
 * The calendar URL for an account position
 *
 * @param index the authuser index
 * @returns the surface URL
 */
export function calendarUrl(index: number): string {
  return SURFACE_CONFIG.calendar.url({ kind: 'authuser', index });
}

/**
 * Builds the hash that searches Gmail for a subject as a phrase
 *
 * @param subject
 * @returns the hash, or null when too little is left to mean anything
 */
export function mailSearchHash(subject: string): string | null {
  let text = subject.replace(/["]/g, ' ').replace(/\s+/g, ' ').trim();
  const cut = /(?:…|\.\.\.)$/.exec(text);
  if (cut) {
    text = text.slice(0, -cut[0].length).trim();
    const lastSpace = text.lastIndexOf(' ');
    text = lastSpace === -1 ? '' : text.slice(0, lastSpace).trim();
  }
  if (text.length < MIN_SEARCH_TERM) return null;
  return `#search/${encodeURIComponent(`"${text}"`)}`;
}

/**
 * Recognises Gmail's pop-out URL
 *
 * @param url
 * @returns true when it must open as its own window
 */
export function isPopoutUrl(url: string): boolean {
  try {
    return new URL(url).pathname.includes('/popout');
  } catch {
    return false;
  }
}

/**
 * Recognises the "View entire message" reader
 *
 * @param url
 * @returns true when it must open as its own window; it has no opener history
 */
export function isFullMessageViewUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase() === 'mail.google.com' && u.searchParams.get('view') === 'lg';
  } catch {
    return false;
  }
}

/**
 * Recognises an attachment URL
 *
 * @param url
 * @returns true for a file rather than a surface
 */
export function isAttachmentUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === 'mail-attachment.googleusercontent.com') return true;
    if (host !== 'mail.google.com') return false;
    return u.searchParams.get('view') === 'att';
  } catch {
    return false;
  }
}

/**
 * Recognises about:blank and friends
 *
 * @param url
 * @returns true when it must become a real window the opener can drive
 */
export function isBlankUrl(url: string): boolean {
  const u = url.trim().toLowerCase();
  return u === '' || u.startsWith('about:');
}

/**
 * Whether a URL belongs to a surface the app draws itself
 *
 * @param url
 * @returns true for the surface hosts and the Google account pages
 */
export function isInAppUrl(url: string): boolean {
  const host = hostOf(url);
  return host !== null && IN_APP_HOSTS.has(host);
}

/**
 * Whether a URL is on google.com at all
 *
 * @param url
 * @returns true for google.com and any subdomain of it
 */
export function isGoogleUrl(url: string): boolean {
  const host = hostOf(url);
  return host !== null && (host === 'google.com' || host.endsWith('.google.com'));
}

// Externalising a federation POST re-issues it as a GET, and Entra answers "AADSTS900561",
// so these hosts stay in-app.

/**
 * Whether a URL is a federated Microsoft login
 *
 * @param url
 * @returns true for the Entra and Microsoft account login hosts
 */
export function isFederatedLoginUrl(url: string): boolean {
  const host = hostOf(url);
  if (host === null) return false;
  return FEDERATED_LOGIN_HOSTS.has(host) || host.endsWith('.microsoftonline.com');
}

/**
 * Where the "+" flow sends the user to sign in
 *
 * @returns Google's add-session URL, continuing into Gmail
 */
export function addAccountUrl(): string {
  return 'https://accounts.google.com/AddSession?continue=https://mail.google.com/mail/';
}


//===========================
// Helper functions
//===========================

/**
 * The hostname of a URL
 *
 * @param url
 * @returns the lowercased host, or null when the URL is unparseable
 * @private
 */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
