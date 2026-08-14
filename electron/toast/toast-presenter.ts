// Raising a notification card: the one place that decides where a notification goes, and
// the fallbacks for when the app's own stack cannot draw it.
//
// The app's own stack first, always: it carries the account, honours every setting, and
// opens the mail when clicked. A stack that cannot paint is repaired rather than routed
// around — thrown away and built again, which is the only thing that has ever fixed it.
//
// The Windows shelf is what is left when that fails, and it is a poor stand-in: no account,
// no settings, dead on click. It was taken out entirely once, and that was a step too far —
// a stack that could not paint then meant no notification at all, which is the one outcome
// worse than a poor one. So it is back, but only after the repair has been tried and
// refused, and it says so in the log: a system notification means the stack is broken, and
// the lines above it in notify.log say why.
//
// What a click on a card does is not here. This module only puts them up, which is why it
// needs nothing from the layers above it and they can all reach for showToast.

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

// Called on the way into broken as well as before a raise, because the two cover different
// cards: the cards already in the stack when the page died are past showToast's fork and
// nothing would ever look at them again, and a rebuild alone would not redraw them. The
// window bounds the attempts itself — a page that is broken for a reason rebuilding it
// cannot fix must not turn every notification into a new window — and refresh() is what
// puts the queued stack in front of the window that comes back.
export function repairToastStack(): boolean {
  if (!toastWindow?.rebuild()) return false;
  toasts?.refresh();
  return true;
}

// The end of the line for a stack that has given up.
//
// showToast's fork only ever redirects the *next* notification. The cards already in the
// controller when the page died are past it — they were accepted while the window still
// looked healthy, they are what the rebuild was trying to save, and once the attempts are
// spent nothing would ever look at them again. That is the silence this exists to break:
// mail arrived, the log said the stack drew it, and nothing was on screen. The controller
// hands the stack over and empties itself in one call, so a second attempt finds nothing
// and nothing is raised twice.
//
// A summary has no cards left to raise — each one was released as it was folded into the
// count — so what leaves is the count itself.
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

// The account fields a card needs, resolved once at show time. A toast keeps the colour
// and avatar it was raised with rather than a reference to a profile that may be removed
// while the card is still on screen.
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

// The stand-in itself. Guarded rather than trusted, because the whole reason it is here is
// that a notification must not be lost, and an unguarded throw would lose it just as
// thoroughly as the stack that failed.
function systemNotify(title: string, body: string): void {
  try {
    if (!Notification.isSupported()) return;
    new Notification({ title, body }).show();
  } catch (e) {
    notifyLog(`[toast] even the system notification failed: ${String(e)}`);
  }
}
