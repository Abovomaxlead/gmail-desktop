// Single source of truth for the Google surfaces the app hosts, shared by main, the
// preloads and the sidebar. Everything under renderer/lib/ lives there because Next.js
// cannot compile imports from outside its own root. Pure data — no Electron or DOM.
//
// A delegated mailbox offers mail only once a URL has been captured, and calendar only when
// Google's switcher exposed one; other combinations throw rather than hand out a URL that
// would end up in webContents.loadURL(null) and kill the main process.

import type { AccountRef } from './account-ref';


//===========================
// Types
//===========================

export interface SurfaceConfig {
  label: string;
  host: string;
  path?: string;
  url(ref: AccountRef): string;
  backgroundThrottling: boolean;
}

/** The same rule as surfacesForRef, for callers that only have what the renderer knows
 * about an account - it never sees an AccountRef. Anything not on this list would end in
 * a throw from ownedIndex, delegatedMailUrl or delegatedCalendarUrl, so a control that
 * opens a surface has to ask here first. */
export interface AccountSurfaces {
  kind: AccountRef['kind'];
  hasCalendar: boolean;
  /** False for a mailbox the API found and nobody has opened in Gmail yet. Defaults to true
   * so every existing caller keeps its meaning. */
  hasMail?: boolean;
  /** A tab from the remembered bar whose identity is not settled yet: it has no url for
   * anything, not even its own mail. */
  provisional?: boolean;
}


//===========================
// Constants
//===========================

export const SURFACES = [
  'mail',
  'calendar',
  'drive',
  'docs',
  'sheets',
  'slides',
  'keep',
  'contacts',
  'chat',
] as const;

export type Surface = (typeof SURFACES)[number];

export const SURFACE_CONFIG: Record<Surface, SurfaceConfig> = {
  mail: {
    label: 'Mail',
    host: 'mail.google.com',
    url: (ref) =>
      ref.kind === 'delegated' ? delegatedMailUrl(ref) : `https://mail.google.com/mail/u/${ref.index}/`,
    backgroundThrottling: true,
  },
  calendar: {
    label: 'Calendar',
    host: 'calendar.google.com',
    url: (ref) =>
      ref.kind === 'delegated'
        ? delegatedCalendarUrl(ref)
        : `https://calendar.google.com/calendar/u/${ref.index}/r`,
    backgroundThrottling: false,
  },
  drive: {
    label: 'Drive',
    host: 'drive.google.com',
    url: (ref) => `https://drive.google.com/drive/u/${ownedIndex(ref, 'drive')}/my-drive`,
    backgroundThrottling: true,
  },
  docs: {
    label: 'Docs',
    host: 'docs.google.com',
    path: 'document',
    url: (ref) => `https://docs.google.com/document/u/${ownedIndex(ref, 'docs')}/`,
    backgroundThrottling: true,
  },
  sheets: {
    label: 'Sheets',
    host: 'docs.google.com',
    path: 'spreadsheets',
    url: (ref) => `https://docs.google.com/spreadsheets/u/${ownedIndex(ref, 'sheets')}/`,
    backgroundThrottling: true,
  },
  slides: {
    label: 'Slides',
    host: 'docs.google.com',
    path: 'presentation',
    url: (ref) => `https://docs.google.com/presentation/u/${ownedIndex(ref, 'slides')}/`,
    backgroundThrottling: true,
  },
  keep: {
    label: 'Keep',
    host: 'keep.google.com',
    url: (ref) => `https://keep.google.com/u/${ownedIndex(ref, 'keep')}/`,
    backgroundThrottling: true,
  },
  contacts: {
    label: 'Contacts',
    host: 'contacts.google.com',
    url: (ref) => `https://contacts.google.com/u/${ownedIndex(ref, 'contacts')}/`,
    backgroundThrottling: true,
  },
  chat: {
    label: 'Chat',
    host: 'chat.google.com',
    url: (ref) => `https://chat.google.com/u/${ownedIndex(ref, 'chat')}/`,
    backgroundThrottling: true,
  },
};

export const APP_SURFACES: readonly Surface[] = SURFACES.filter(
  (s) => s !== 'mail' && s !== 'calendar',
);


//===========================
// Exported functions
//===========================

/**
 * The surfaces an account can open
 *
 * @param ref
 * @returns {Surface[]} everything for an owned account; for a delegated mailbox only what
 *   a URL was captured for
 */
export function surfacesForRef(ref: AccountRef): Surface[] {
  if (ref.kind === 'authuser') return [...SURFACES];
  if (!ref.mailUrl) return [];
  return ref.calendarUrl ? ['mail', 'calendar'] : ['mail'];
}

/**
 * The same rule as surfacesForRef, for a caller that has no AccountRef
 *
 * @param account
 * @returns {Surface[]} empty for an account nothing can be opened for
 */
export function openableSurfaces(account: AccountSurfaces): Surface[] {
  if (account.provisional) return [];
  if (account.kind === 'authuser') return [...SURFACES];
  if (account.hasMail === false) return [];
  return account.hasCalendar ? ['mail', 'calendar'] : ['mail'];
}

/**
 * The surface a URL belongs to
 *
 * @param url
 * @returns the surface, or null for a host the app does not host
 */
export function surfaceForUrl(url: string): Surface | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const firstSegment = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
  for (const s of SURFACES) {
    const cfg = SURFACE_CONFIG[s];
    if (cfg.host !== host) continue;
    if (cfg.path === undefined || cfg.path === firstSegment) return s;
  }
  return null;
}


//===========================
// Helper functions
//===========================

/**
 * The account index a surface URL is built from
 *
 * @param ref
 * @param surface
 * @returns the index
 * @throws when the surface is not one a delegated mailbox has
 * @private
 */
function ownedIndex(ref: AccountRef, surface: string): number {
  if (ref.kind !== 'authuser') {
    throw new Error(`surface "${surface}" is not available for delegated mailboxes`);
  }
  return ref.index;
}

/**
 * The mail URL captured for a delegated mailbox
 *
 * @param ref
 * @returns the URL
 * @throws rather than hand out a URL that would end up in webContents.loadURL(null)
 * @private
 */
function delegatedMailUrl(ref: { email: string; mailUrl: string | null }): string {
  if (!ref.mailUrl) {
    throw new Error(`no mail url captured for delegated mailbox ${ref.email}`);
  }
  return ref.mailUrl;
}

/**
 * The calendar URL captured for a delegated mailbox
 *
 * @param ref
 * @returns the URL
 * @throws when Google's switcher exposed none
 * @private
 */
function delegatedCalendarUrl(ref: { email: string; calendarUrl: string | null }): string {
  if (!ref.calendarUrl) {
    throw new Error(`no calendar url captured for delegated mailbox ${ref.email}`);
  }
  return ref.calendarUrl;
}
