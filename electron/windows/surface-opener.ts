// Where a click actually opens something: a Google surface in the app, in a window of its
// own or in the browser, and a link out of Gmail.
//
// An external link is shown as the host it really goes to, not the google.com/url wrapper
// Gmail puts around it -- but the browser still gets the URL as Gmail handed it over, since
// that wrapper redirects to the very host the user just approved.

import { BrowserWindow, dialog, shell } from 'electron';
import { pushPrefs } from '../core/broadcast';
import { accountKey, type AccountRef } from '../accounts/account-ref';
import { activeView, currentLocale, mainWindow, prefs, profiles } from '../core/runtime';
import { showAccount } from './view-surfaces';
import { hiddenNotificationText, playNotificationSound, resetSoundThrottle } from '../notify/notify-gating';
import { showToast, toastAccountFor } from '../toast/toast-presenter';
import { nativeLabels } from '../menus/native-labels';
import { googleAppTarget } from '../gmail/google-apps-open';
import { hostOf, needsLinkConfirm, unwrapRedirect } from '../system/link-guard';
import { attachExternalLinkHandling } from '../system/external-links';
import { SURFACE_CONFIG } from '../../renderer/lib/surfaces';
import type { Surface } from './profile-view-manager';


//===========================
// Exported functions
//===========================

export function showTestNotification(): void {
  if (!prefs) return;
  const p = prefs.getAll();
  const hidden = hiddenNotificationText(p);
  const L = nativeLabels(currentLocale(), p.reneMode === true);
  const first = profiles[0];
  showToast({
    kind: 'test',
    title: hidden.hiddenSender ?? 'Gmail Desktop',
    body: hidden.hiddenSubject ?? L.testNotificationBody,
    ...(first ? { account: toastAccountFor(first.email) } : {}),
    persist: true,
  });

  resetSoundThrottle();
  playNotificationSound(p);
}

export function openSurfaceForAccount(ref: AccountRef, surface: Surface): void {
  if (surface === 'mail' || !prefs) {
    showAccount(ref, surface);
    return;
  }
  const target = googleAppTarget(surface, prefs.getAll().googleApps);
  if (target === 'in-app') {
    showAccount(ref, surface);
    return;
  }
  const url = SURFACE_CONFIG[surface].url(ref);
  if (target === 'external') {
    openExternalGuarded(url);
    const visible = activeView();
    if (!visible) showAccount(ref, 'mail');
    return;
  }
  openGoogleAppWindow(url, ref, surface);
}

function openGoogleAppWindow(url: string, ref: AccountRef, surface: Surface): void {
  const email = profiles.find((p) => accountKey(p.ref) === accountKey(ref))?.email ?? '';
  const account = email ? prefs?.getAccount(email) : undefined;
  const g = prefs?.getAll().googleApps;
  const label = (account?.label || email || '').trim();
  const showLabel = g?.showAccountLabel !== false && profiles.length > 1 && label;
  const title = showLabel
    ? `${SURFACE_CONFIG[surface].label} — ${label}`
    : SURFACE_CONFIG[surface].label;
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    title,
    backgroundColor:
      g?.showAccountColor !== false && profiles.find((p) => p.email === email)?.color
        ? profiles.find((p) => p.email === email)!.color
        : '#ffffff',
    webPreferences: { partition: 'persist:google', contextIsolation: true },
  });
  win.on('page-title-updated', (e) => {
    if (showLabel) e.preventDefault();
  });
  attachExternalLinkHandling(win.webContents);
  void win.loadURL(url);
}

export function openExternalGuarded(url: string): void {
  const p = prefs?.getAll();
  if (!p || !needsLinkConfirm(url, p.phishing)) {
    void shell.openExternal(url);
    return;
  }

  const target = unwrapRedirect(url);
  const host = hostOf(target) ?? target;
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const shown = target.length > 200 ? `${target.slice(0, 200)}…` : target;
  const L = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true);
  const box = {
    type: 'question' as const,
    noLink: true,
    buttons: [L.linkOpenButton, L.cancel],
    defaultId: 1,
    cancelId: 1,
    message: L.linkMessage(host),
    detail: L.linkDetail(shown),
    checkboxLabel: L.linkAlwaysAllow(host),
    checkboxChecked: false,
  };
  const done = (res: { response: number; checkboxChecked: boolean }) => {
    if (res.response !== 0) return;
    if (res.checkboxChecked && prefs) {
      const current = prefs.getAll().phishing.trustedHosts;
      prefs.setPhishing({ trustedHosts: [...current, host] });
      pushPrefs();
    }
    void shell.openExternal(url);
  };
  if (parent) void dialog.showMessageBox(parent, box).then(done);
  else void dialog.showMessageBox(box).then(done);
}
