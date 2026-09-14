// Everything the main process tells the interface about itself: the tab rows, the unread
// counts, the settings, the active tab, the taskbar badge and the default-mail-client state.
//
// Every window that draws a tab strip is told, not just the main one: a mailbox dragged into
// a window of its own draws the same shell there, off the same pushes. What differs per
// window is which tabs it draws and which one of them is active -- see tab-window-registry.
//
// Nothing here decides anything — a caller that changed something calls the push for it.
// decorate() is the only real work; the rest is a send.

import { app, type BrowserWindow } from 'electron';
import { IPC } from './ipc';
import {
  accountCache,
  activeTabIn,
  authIdx,
  cachedAccounts,
  colors,
  currentLocale,
  hidden,
  keyOf,
  mainWindow,
  prefs,
  profiles,
  seedOrder,
  unread,
} from './runtime';
import { shellWindows, tabsFor } from '../windows/tab-window-registry';
import { notifyLog } from '../notify/notify-log';
import { seedable } from '../accounts/account-cache';
import { sortByOrder } from '../accounts/account-order';
import { applyBadge } from '../unread/badge-controller';
import { accountCountVisible } from '../../renderer/lib/badge-visibility';
import { surfacesForRef } from '../../renderer/lib/surfaces';
import { isOurProgId, readMailtoProgId } from '../system/mail-client-registration';
import type { AccountRef } from '../accounts/account-ref';
import type { Profile } from '../windows/profile-view-manager';


//===========================
// Types
//===========================

export interface TabRow {
  key: string;
  kind: AccountRef['kind'];
  index: number;
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
  hasCalendar: boolean;
  // false for a mailbox known by address with no URL to load: do not try to open it
  hasMail: boolean;
  order?: number;
  label?: string;
  provisional?: boolean;
}


//===========================
// Constants
//===========================

const SEED_KEY_PREFIX = 'seed:';


//===========================
// Module state
//===========================

// injected rather than imported: it belongs to the OAuth layer, which imports this one
let onProfilesPushed: () => void = () => {};

// the last badge trace, so a total that does not move is written once instead of every report
let lastBadgeTrace = '';


//===========================
// Exported functions
//===========================

export function setOnProfilesPushed(fn: () => void): void {
  onProfilesPushed = fn;
}

/**
 * The row key for an account still seeded from cache, not yet confirmed by detection
 *
 * @private
 */
const seedKey = (email: string): string => `${SEED_KEY_PREFIX}${email}`;

export function pushProfiles(): void {
  const rows = decorate([...profiles]);
  for (const win of shellWindows()) win.webContents.send(IPC.PROFILES_CHANGED, rows);
  saveAccountCache(rows);
  // the list of accounts is the only thing that says which counts are still somebody's
  if (unread.retain(profiles.map(keyOf))) {
    pushUnread();
    refreshBadge();
  }
  onProfilesPushed();
}

/**
 * Tells every window which tabs are its own
 *
 * The rows themselves are the same everywhere -- settings still lists every account, however
 * the tabs are spread -- so this is the one push that differs per window.
 */
export function pushWindowTabs(): void {
  for (const win of shellWindows()) win.webContents.send(IPC.WINDOW_TABS, tabsFor(win));
}

/**
 * Tells one window everything it needs at once
 *
 * What a window opened halfway through the session gets instead of the pushes it was not
 * there for.
 *
 * @param win
 */
export function pushWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  win.webContents.send(IPC.PROFILES_CHANGED, decorate([...profiles]));
  win.webContents.send(IPC.UNREAD_CHANGED, unread.snapshot());
  if (prefs) {
    win.webContents.send(IPC.PREFS_CHANGED, { ...prefs.getAll(), locale: currentLocale() });
  }
  win.webContents.send(IPC.WINDOW_TABS, tabsFor(win));
  win.webContents.send(IPC.ACTIVE_CHANGED, activeTabIn(win));
}

/**
 * Tells settings which mailboxes are being kept off the screen
 *
 * The list is not part of the profiles: a hidden mailbox has no row, no view and no key, and
 * the one place it appears is the block in settings that hands it back.
 */
export function pushHidden(): void {
  mainWindow?.webContents.send(IPC.HIDDEN_CHANGED, hidden?.list() ?? []);
}

export function pushUnread(): void {
  const counts = unread.snapshot();
  for (const win of shellWindows()) win.webContents.send(IPC.UNREAD_CHANGED, counts);
}

/** The active tab is per window: each strip marks the mailbox that window is showing. */
export function pushActive(): void {
  for (const win of shellWindows()) win.webContents.send(IPC.ACTIVE_CHANGED, activeTabIn(win));
}

export function pushPrefs(): void {
  if (!prefs) return;
  const payload = { ...prefs.getAll(), locale: currentLocale() };
  for (const win of shellWindows()) win.webContents.send(IPC.PREFS_CHANGED, payload);
}

export async function pushDefaultMailStatus(): Promise<void> {
  const isDefault =
    process.platform === 'win32'
      ? isOurProgId(await readMailtoProgId())
      : app.isDefaultProtocolClient('mailto');
  mainWindow?.webContents.send(IPC.MAIL_DEFAULT_STATUS, isDefault);
}

export function refreshBadge(): void {
  // A view that opened for an account which never became a profile -- a probe during
  // detection, a delegation scan that came up empty -- reports a count under a key nothing
  // will ever zero. pushProfiles prunes those, but a report arriving after the last push
  // would otherwise sit in the total for the rest of the session. Only once there is a
  // profile to compare against: before that, a count belongs to an account detection has
  // not confirmed yet, and dropping it would leave the badge behind until the page speaks
  // again.
  if (profiles.length > 0) unread.retain(profiles.map(keyOf));
  const counts = unread.snapshot();
  const excluded = excludedBadgeKeys();
  const total = applyBadge(counts, (n) => app.setBadgeCount(n), excluded, () => {
    if (process.platform === 'win32') mainWindow?.setOverlayIcon(null, '');
  });
  traceBadge(total, counts, excluded);
}


//===========================
// Helper functions
//===========================

function decorate(list: Profile[]): TabRow[] {
  const confirmed: TabRow[] = list.map((p) => {
    const ap = prefs?.getAccount(p.email) ?? {};
    return {
      key: keyOf(p),
      kind: p.ref.kind,
      index: authIdx(p),
      email: p.email,
      name: p.name,
      avatarUrl: p.avatarUrl,
      color: p.color,
      hasCalendar: surfacesForRef(p.ref).includes('calendar'),
      hasMail: surfacesForRef(p.ref).includes('mail'),
      order: ap.order ?? seedOrder.get(p.email.toLowerCase()),
      label: ap.label,
    };
  });
  const seeds: TabRow[] = seedable(cachedAccounts, {
    confirmed: profiles.map((p) => p.email),
  }).map((c) => {
    const ap = prefs?.getAccount(c.email) ?? {};
    return {
      key: seedKey(c.email),
      kind: 'authuser',
      index: -1,
      email: c.email,
      name: c.name,
      avatarUrl: c.avatarUrl,
      color: colors?.get(c.email) ?? c.color,
      hasCalendar: false,
      hasMail: false,
      order: ap.order ?? seedOrder.get(c.email),
      label: ap.label,
      provisional: true,
    };
  });
  return sortByOrder([...confirmed, ...seeds]);
}

function saveAccountCache(rows: TabRow[]): void {
  if (!accountCache) return;
  const own = rows.filter((r) => r.kind === 'authuser');
  if (own.length === 0) return;
  accountCache.save(
    own.map((r) => ({ email: r.email, name: r.name, avatarUrl: r.avatarUrl, color: r.color })),
  );
}

/**
 * Records what the badge total was summed from
 *
 * The number itself says nothing about where it went wrong: every account brings its own
 * count from its own source, so the line names the source per key. A key no live profile
 * owns is the one thing that cannot be right — nothing will ever report it to zero again.
 *
 * @param total what went to the OS
 * @param counts unread per accountKey
 * @param excluded the keys the user left out of the badge
 * @private
 */
function traceBadge(total: number, counts: Record<string, number>, excluded: Set<string>): void {
  const live = new Map(profiles.map((p) => [keyOf(p), p]));
  const parts = Object.entries(counts).map(([key, n]) => {
    const profile = live.get(key);
    if (!profile) return `${key}=${n}(orphan)`;
    const source = unread.ownedByPage(key) ? 'title' : 'api';
    return `${key}=${n}(${profile.email},${source}${excluded.has(key) ? ',excluded' : ''})`;
  });
  const line = `[badge] total=${total} ${parts.join(' ') || '(nothing counted)'}`;
  if (line === lastBadgeTrace) return;
  lastBadgeTrace = line;
  notifyLog(line);
}

function excludedBadgeKeys(): Set<string> {
  const keys = new Set<string>();
  for (const p of profiles) {
    if (
      !accountCountVisible(
        prefs?.getAccount(p.email).badgeCount,
        prefs?.getAll().appearance.showUnreadBadges,
      )
    ) {
      keys.add(keyOf(p));
    }
  }
  return keys;
}
