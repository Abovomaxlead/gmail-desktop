// Everything the main process tells the interface about itself: the tab rows, the unread
// counts, the settings, which tab is active, the taskbar badge and whether this app is the
// system's mail client.
//
// One module because these are the same job seen from different angles — each is a snapshot
// of runtime state, shaped for the renderer and sent down a channel — and because keeping
// them together is what stops two of them describing different moments. decorate() is the
// only real work here; the rest is a send.
//
// Nothing in here decides anything. A caller that has changed something calls the push for
// it; these functions never call each other except where one genuinely contains the other
// (pushProfiles saves the cache it just built).

import { app } from 'electron';
import { IPC } from './ipc';
import {
  accountCache,
  activeTab,
  authIdx,
  cachedAccounts,
  colors,
  currentLocale,
  keyOf,
  mainWindow,
  prefs,
  profiles,
  removed,
  seedOrder,
  unread,
} from './runtime';
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
  /** False for a mailbox the API found and nobody has opened in Gmail yet: known by address,
   * with no URL to load. The seeded rows below are false for a different reason — they have
   * no ref at all yet — and both mean "do not try to open this". */
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

/** Run after every profile push. Injected rather than imported because the one thing that
 * has to happen here belongs to the OAuth layer — it re-checks the links for the accounts
 * this just published — and importing it would have the two modules import each other. */
let onProfilesPushed: () => void = () => {};


//===========================
// Exported functions
//===========================

export function setOnProfilesPushed(fn: () => void): void {
  onProfilesPushed = fn;
}

export const seedKey = (email: string): string => `${SEED_KEY_PREFIX}${email}`;

export function pushProfiles(): void {
  const rows = decorate([...profiles]);
  mainWindow?.webContents.send(IPC.PROFILES_CHANGED, rows);
  saveAccountCache(rows);
  onProfilesPushed();
}

export function pushUnread(): void {
  mainWindow?.webContents.send(IPC.UNREAD_CHANGED, unread.snapshot());
}

export function pushActive(): void {
  mainWindow?.webContents.send(IPC.ACTIVE_CHANGED, activeTab());
}

// The resolved locale rides along with the prefs push rather than being worked out again
// in the renderer.
export function pushPrefs(): void {
  if (prefs) {
    mainWindow?.webContents.send(IPC.PREFS_CHANGED, { ...prefs.getAll(), locale: currentLocale() });
  }
}

// On Windows the truth lives in UrlAssociations\mailto\UserChoice, not in the legacy
// HKCU\Software\Classes\mailto key, so ask the registry which ProgId actually wins.
export async function pushDefaultMailStatus(): Promise<void> {
  const isDefault =
    process.platform === 'win32'
      ? isOurProgId(await readMailtoProgId())
      : app.isDefaultProtocolClient('mailto');
  mainWindow?.webContents.send(IPC.MAIL_DEFAULT_STATUS, isDefault);
}

export function refreshBadge(): void {
  applyBadge(unread.snapshot(), (n) => app.setBadgeCount(n), excludedBadgeKeys(), () => {
    if (process.platform === 'win32') mainWindow?.setOverlayIcon(null, '');
  });
}


//===========================
// Helper functions
//===========================

/** The tab rows the bar draws: the confirmed accounts, plus the ones remembered from the
 * last run that detection has not reached yet. */
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
    removed: removed?.list() ?? [],
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

/** Never written empty: an empty list usually means detection has confirmed nothing yet,
 * and writing it would throw away the seeds the next start draws its tabs from. */
function saveAccountCache(rows: TabRow[]): void {
  if (!accountCache) return;
  const own = rows.filter((r) => r.kind === 'authuser');
  if (own.length === 0) return;
  accountCache.save(
    own.map((r) => ({ email: r.email, name: r.name, avatarUrl: r.avatarUrl, color: r.color })),
  );
}

/** The accounts whose unread count must not reach the taskbar badge, either because that
 * account has it switched off or because the badge is off altogether. */
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
