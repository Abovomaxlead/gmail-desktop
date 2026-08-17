// What each Gmail view is allowed to raise, and the sound and privacy replacements with it.
// notification-policy.ts holds the decisions; this applies them and pushes them into views.
//
// A view told to keep quiet is indistinguishable from mail not arriving, so every change of
// that answer goes to notify.log — only the changes, since this runs every minute.

import { IPC } from '../core/ipc';
import { pushUnread, pushPrefs, refreshBadge } from '../core/broadcast';
import {
  coverage,
  keyOf,
  mainWindow,
  manager,
  prefs,
  profiles,
  unread,
} from '../core/runtime';
import { notificationsAllowed, notificationSilent } from './notification-policy';
import { notifyLog } from './notify-log';
import { SURFACES } from '../../renderer/lib/surfaces';
import { soundNameOrDefault } from '../../renderer/lib/notification-sound';
import type { Prefs } from '../core/prefs-store';


//===========================
// Types
//===========================

export interface NotifyGatingHooks {
  onDndCleared(): void;
}


//===========================
// Constants
//===========================

const NOTIFY_HIDDEN_SENDER = 'New email';
const NOTIFY_HIDDEN_SUBJECT = 'You have new mail.';
const SOUND_GAP_MS = 1500;


//===========================
// Module state
//===========================

let hooks: NotifyGatingHooks = { onDndCleared: () => {} };

let lastSoundAt = 0;
let notifyTimer: ReturnType<typeof setInterval> | null = null;

const notifyAllowedLast = new Map<string, boolean>();


//===========================
// Exported functions
//===========================

export function setNotifyGatingHooks(h: NotifyGatingHooks): void {
  hooks = h;
}

export function playNotificationSound(p: Prefs): void {
  if (p.notifications.sound === false) return;
  const name = soundNameOrDefault(p.notifications.soundName);
  const now = Date.now();
  if (now - lastSoundAt < SOUND_GAP_MS) return;
  lastSoundAt = now;
  mainWindow?.webContents.send(IPC.NOTIFY_SOUND_PLAY, { name, volume: p.notifications.volume });
}

export function resetSoundThrottle(): void {
  lastSoundAt = 0;
}

export function hiddenNotificationText(p: Prefs): {
  hiddenSender?: string;
  hiddenSubject?: string;
} {
  return {
    ...(p.notifications.showSender === false ? { hiddenSender: NOTIFY_HIDDEN_SENDER } : {}),
    ...(p.notifications.showSubject === false ? { hiddenSubject: NOTIFY_HIDDEN_SUBJECT } : {}),
  };
}

export function refreshNotifyAllowed(): void {
  if (!prefs) return;
  let p = prefs.getAll();
  const now = new Date();
  if (p.notifications.dndUntil && now.getTime() >= p.notifications.dndUntil) {
    prefs.setNotifications({ ...p.notifications, dndUntil: undefined });
    p = prefs.getAll();
    pushPrefs();
    hooks.onDndCleared();
  }
  for (const profile of profiles) {
    for (const surface of SURFACES) {
      const show = notificationsAllowed(p, profile.email, now, surface, coverage.has(profile.email));

      if (surface === 'mail' && notifyAllowedLast.get(profile.email) !== show) {
        notifyAllowedLast.set(profile.email, show);
        notifyLog(
          `[notify] mail view for ${profile.email} may notify: ${show}` +
            (show
              ? ''
              : ` (dnd=${p.notifications.dnd} quiet=${p.notifications.quietHours.enabled} account=${p.accounts[profile.email]?.notify !== false} push=${coverage.has(profile.email)})`),
        );
      }
      manager?.pushNotifyAllowed(keyOf(profile), surface, {
        show,
        silent: notificationSilent(p, profile.email, surface),
      });
    }
  }
}

export function startNotifyTimer(): void {
  if (notifyTimer) return;
  notifyTimer = setInterval(refreshNotifyAllowed, 60_000);
}

// the inbox count as the API counts it, for an account the relay delivers for
//
// the gate stays because the two sources count different mailboxes: threadsUnread counts
// every unread conversation, the page title counts the tab Gmail is showing, and letting
// both write would swap the badge between two numbers every five minutes
export function reportApiUnread(email: string, count: number | null): void {
  if (count === null) return;
  if (!coverage.has(email)) return;
  const profile = profiles.find((p) => p.email === email);
  if (!profile) return;
  unread.report(keyOf(profile), count);
  pushUnread();
  refreshBadge();
}
