// Opening a compose window, and deciding which account it should be from.
//
// A mailto: link can arrive before there is anything to compose with, so those are queued
// until a mail view is actually showing; showAccount releases them in arrival order. With
// more than one account signed in the user is asked, in a window created per ask and
// destroyed on settle.

import { IPC } from '../core/ipc';
import { DEV_URL, SIDEBAR_PRELOAD_PATH } from '../core/paths';
import { RENE_ZOOM_FACTOR } from '../core/rene';
import {
  authIdx,
  currentLocale,
  mainWindow,
  manager,
  pendingMailtos,
  prefs,
  profiles,
} from '../core/runtime';
import { nativeLabels } from '../menus/native-labels';
import { parseMailto, type MailtoFields } from '../mail/mailto';
import { ComposePicker } from './compose-picker';
import { openCompose } from './compose-window';
import {
  openComposeAccountWindow,
  resizeAndShowComposeAccountWindow,
} from './compose-account-window';
import type { BrowserWindow } from 'electron';
import type { ComposeAccountAsk, ComposeAccountChoice } from '../../renderer/lib/compose-account';

//===========================
// Module state
//===========================

let composeAccountWindow: BrowserWindow | null = null;

const composePicker = new ComposePicker<ComposeAccountAsk, string>({
  open: (ask) => showComposeAccountWindow(ask),
  close: () => closeComposeAccountWindow(),
  redispatch: (url) => void dispatchMailto(url),
});


//===========================
// Exported functions
//===========================

export function cancelComposeAsk(): void {
  composePicker.settle(null);
}

export function applyComposeAskSize(sender: Electron.WebContents, width: number, height: number): void {
  const win = composeAccountWindow;
  if (!win || win.isDestroyed() || sender !== win.webContents) return;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return;
  const applied = resizeAndShowComposeAccountWindow(win, width, height);
  if (DEV_URL) {
    console.log(
      `[picker] measured ${width}x${height} css, setContentSize ${applied.width}x${applied.height}`,
    );
  }
}

export function settleComposeAsk(index: number | null): void {
  composePicker.settle(index);
}

export async function dispatchMailto(mailtoUrl: string): Promise<void> {
  const fields = parseMailto(mailtoUrl);
  if (!fields) return;
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
  const ready = manager?.activeKey() != null && profiles.some((p) => p.ref.kind === 'authuser');
  if (!ready) {
    pendingMailtos.push(mailtoUrl);
    return;
  }
  const index = await chooseComposeAccount(fields, mailtoUrl);
  if (index == null) return;
  openComposeWindow(index, fields);
}

export function flushPendingMailto(): void {
  if (pendingMailtos.length === 0) return;
  if (manager?.activeKey() == null) return;
  const queued = pendingMailtos.splice(0, pendingMailtos.length);
  for (const url of queued) {
    void dispatchMailto(url).catch((e) => console.warn(`[mailto] dispatch failed: ${e}`));
  }
}

export function openComposeWindow(index: number, fields?: MailtoFields): void {
  const title = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true).composeTitle;
  openCompose(index, title, fields);
}


//===========================
// Helper functions
//===========================

/**
 * Closes the compose account window, if one is open
 *
 * @private
 */
function closeComposeAccountWindow(): void {
  const win = composeAccountWindow;
  composeAccountWindow = null;
  if (win && !win.isDestroyed()) win.destroy();
}

function showComposeAccountWindow(ask: ComposeAccountAsk): void {
  closeComposeAccountWindow();
  const win = openComposeAccountWindow(
    mainWindow!,
    SIDEBAR_PRELOAD_PATH,
    DEV_URL ? `${DEV_URL}/compose-account` : 'app://bundle/compose-account.html',
    ask.accounts.length,
    prefs?.getAll().reneMode ? RENE_ZOOM_FACTOR : 1,
  );
  composeAccountWindow = win;
  win.webContents.on('did-finish-load', () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.COMPOSE_ACCOUNT_ASK, ask);
  });
  win.on('closed', () => {
    if (composeAccountWindow === win) composeAccountWindow = null;
    composePicker.settle(null);
  });
}

function chooseComposeAccount(fields: MailtoFields, mailtoUrl: string): Promise<number | null> {
  const authusers = profiles.filter((p) => p.ref.kind === 'authuser');
  if (authusers.length === 0) return Promise.resolve(null);
  if (authusers.length === 1) return Promise.resolve(authIdx(authusers[0]));
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve(null);

  const accounts: ComposeAccountChoice[] = authusers.map((p) => ({
    index: authIdx(p),
    email: p.email,
    label: prefs?.getAccount(p.email).label ?? p.name ?? p.email,
    color: p.color,
    avatarUrl: p.avatarUrl,
  }));
  const ask: ComposeAccountAsk = {
    to: fields.to,
    subject: fields.subject,
    accounts,
    locale: currentLocale(),
    reneMode: prefs?.getAll().reneMode === true,
  };

  return composePicker.ask(ask, mailtoUrl);
}
