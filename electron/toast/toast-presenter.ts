// Raising a notification card: the one place that decides where a notification goes, and
// the fallbacks for when the app's own stack cannot draw it.
//
// The app's own stack first, always: it carries the account, honours every setting, and
// opens the mail when clicked. A stack that cannot paint is repaired rather than routed
// around — thrown away and built again, which is the only thing that has ever fixed it.

import { Notification, app } from 'electron';
import { currentLocale, keyOf, prefs, profiles, toastWindow, toasts } from '../core/runtime';
import { nativeLabels } from '../menus/native-labels';
import { notifyLog } from '../notify/notify-log';
import type { ToastInput } from './toast-controller';
import type { ToastAccount } from '../../renderer/lib/toast';


//===========================
// Exported functions
//===========================

/**
 * Puts a card up, wherever it can be put
 *
 * A null controller happens twice in the app's life, before createWindow and after the main
 * window closes; there is no stack to put a card in then and nothing to repair.
 */
export function showToast(input: ToastInput): void {
  if (!toasts) {
    notifyLog(`[toast] no stack at all to show "${input.title}" in — falling back to Windows`);
    systemNotify(input.title, input.body);
    return;
  }
  if (toastWindow?.isBroken() && !repairToastStack()) {
    notifyLog(`[toast] stack cannot be repaired — "${input.title}" goes to Windows instead`);
    systemNotify(input.title, input.body);
    return;
  }
  notifyLog(`[toast] stack draws "${input.title}"`);
  toasts.show(input);
}

export function repairToastStack(): boolean {
  if (!toastWindow?.rebuild()) return false;
  toasts?.refresh();
  return true;
}

export function drainToSystem(): void {
  const held = toasts?.drain();
  if (!held) return;
  for (const toast of held.toasts) {
    notifyLog(`[toast] draining "${toast.title}" to Windows — the stack cannot paint`);
    systemNotify(toast.title, toast.body);
  }
  if (!held.summary) return;
  const L = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true);
  notifyLog(`[toast] draining a summary of ${held.summary.count} to Windows`);
  systemNotify(app.getName(), L.collapsedNotifications(held.summary.count));
}

export function toastAccountFor(email: string): ToastAccount | undefined {
  const profile = profiles.find((p) => p.email === email);
  if (!profile) return undefined;
  return {
    key: keyOf(profile),
    email: profile.email,
    label: prefs?.getAccount(email).label ?? profile.name ?? email,
    color: profile.color,
    avatarUrl: profile.avatarUrl,
  };
}


//===========================
// Helper functions
//===========================

function systemNotify(title: string, body: string): void {
  try {
    if (!Notification.isSupported()) return;
    new Notification({ title, body }).show();
  } catch (e) {
    notifyLog(`[toast] even the system notification failed: ${String(e)}`);
  }
}
