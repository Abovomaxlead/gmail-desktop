// Single source of truth for the Google surfaces the app hosts, shared by the
// Electron main process, the preloads and the sidebar renderer. Everything under
// renderer/lib/ lives there for that reason: Next.js cannot compile imports from
// outside its own root, while esbuild and vitest can import from anywhere. Keep
// these modules pure data - no Electron or DOM imports.
//
// Delegated mailboxes offer only mail, plus calendar when Google's switcher exposed
// one; other combinations throw rather than hand out a URL that would end up in
// webContents.loadURL(null) and kill the main process.

import type { AccountRef } from './account-ref';

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

export interface SurfaceConfig {
  label: string;
  host: string;
  path?: string;
  url(ref: AccountRef): string;
  backgroundThrottling: boolean;
}

function ownedIndex(ref: AccountRef, surface: string): number {
  if (ref.kind !== 'authuser') {
    throw new Error(`surface "${surface}" is not available for delegated mailboxes`);
  }
  return ref.index;
}

function delegatedCalendarUrl(ref: { email: string; calendarUrl: string | null }): string {
  if (!ref.calendarUrl) {
    throw new Error(`no calendar url captured for delegated mailbox ${ref.email}`);
  }
  return ref.calendarUrl;
}

export const SURFACE_CONFIG: Record<Surface, SurfaceConfig> = {
  mail: {
    label: 'Mail',
    host: 'mail.google.com',
    url: (ref) =>
      ref.kind === 'delegated' ? ref.mailUrl : `https://mail.google.com/mail/u/${ref.index}/`,
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

export function surfacesForRef(ref: AccountRef): Surface[] {
  if (ref.kind === 'authuser') return [...SURFACES];
  return ref.calendarUrl ? ['mail', 'calendar'] : ['mail'];
}

// The same rule as surfacesForRef, for callers that only have what the renderer knows
// about an account - it never sees an AccountRef. Anything not on this list would end in
// a throw from ownedIndex or delegatedCalendarUrl, so a control that opens a surface has
// to ask here first. A provisional tab (remembered bar, identity not settled yet) has no
// url for anything, not even its own mail.
export interface AccountSurfaces {
  kind: AccountRef['kind'];
  hasCalendar: boolean;
  provisional?: boolean;
}

export function openableSurfaces(account: AccountSurfaces): Surface[] {
  if (account.provisional) return [];
  if (account.kind === 'authuser') return [...SURFACES];
  return account.hasCalendar ? ['mail', 'calendar'] : ['mail'];
}

export const APP_SURFACES: readonly Surface[] = SURFACES.filter(
  (s) => s !== 'mail' && s !== 'calendar',
);

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
