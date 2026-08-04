// URL predicates deciding whether a Google URL stays inside the app or goes to the
// browser. Pure, so external-links.ts can be reasoned about without a window.
//
// Each predicate exists because of a specific failure. A /popout URL and the ?view=lg
// "View entire message" reader must open as their own windows: routed in-app they load
// into the shared mail view and replace the inbox with no way back, as the reader has
// no opener history. Attachment URLs (?view=att, plus the bytes on
// mail-attachment.googleusercontent.com) are files rather than surfaces, and would
// otherwise map straight back to the mail surface. about:blank must open as a real
// window the opener can drive; handed to shell.openExternal, Windows pops a "no app can
// open this link" dialog and the login window never appears. Any google.com host and
// the federated Microsoft Entra login hosts stay in-app, because externalising a
// federation POST re-issues it as a GET and Entra answers "AADSTS900561".

import { SURFACES, SURFACE_CONFIG } from '../renderer/lib/surfaces';

export function mailUrl(index: number): string {
  return SURFACE_CONFIG.mail.url({ kind: 'authuser', index });
}

export function calendarUrl(index: number): string {
  return SURFACE_CONFIG.calendar.url({ kind: 'authuser', index });
}

export function isPopoutUrl(url: string): boolean {
  try {
    return new URL(url).pathname.includes('/popout');
  } catch {
    return false;
  }
}

export function isFullMessageViewUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase() === 'mail.google.com' && u.searchParams.get('view') === 'lg';
  } catch {
    return false;
  }
}

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

export function isBlankUrl(url: string): boolean {
  const u = url.trim().toLowerCase();
  return u === '' || u.startsWith('about:');
}

const IN_APP_HOSTS = new Set([
  ...SURFACES.map((s) => SURFACE_CONFIG[s].host),
  'accounts.google.com',
]);

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isInAppUrl(url: string): boolean {
  const host = hostOf(url);
  return host !== null && IN_APP_HOSTS.has(host);
}

export function isGoogleUrl(url: string): boolean {
  const host = hostOf(url);
  return host !== null && (host === 'google.com' || host.endsWith('.google.com'));
}

const FEDERATED_LOGIN_HOSTS = new Set([
  'login.microsoftonline.com',
  'login.microsoft.com',
  'login.windows.net',
  'login.live.com',
]);

export function isFederatedLoginUrl(url: string): boolean {
  const host = hostOf(url);
  if (host === null) return false;
  return FEDERATED_LOGIN_HOSTS.has(host) || host.endsWith('.microsoftonline.com');
}

export function addAccountUrl(): string {
  return 'https://accounts.google.com/AddSession?continue=https://mail.google.com/mail/';
}
