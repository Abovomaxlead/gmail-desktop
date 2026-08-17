// What every Electron session gets wired up with: where downloads land, what is recorded
// about them, and the spellchecker's language.
//
// Sessions arrive twice over, so attachSessionHandlers remembers which it has seen; without
// that a download is logged, notified and revealed once per registration.
//
// One trap: DownloadItem.getStartTime() is in seconds, and zero means Electron has none.

import { app, shell } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { IPC } from '../core/ipc';
import { currentLocale, downloadHistory, mainWindow, prefs } from '../core/runtime';
import { nativeLabels } from '../menus/native-labels';
import { playNotificationSound } from '../notify/notify-gating';
import { showToast } from '../toast/toast-presenter';
import { uniqueFileName } from './download-path';
import type { DownloadClickAction } from '../core/prefs-store';


//===========================
// Module state
//===========================

const sessions = new Set<Electron.Session>();

// Download card path stored in threadId; action remembered here so changed prefs apply on click.
const downloadClickPaths = new Map<string, DownloadClickAction>();


//===========================
// Exported functions
//===========================

export function attachSessionHandlers(s: Electron.Session): void {
  if (sessions.has(s)) return;
  sessions.add(s);
  applySpellcheckTo(s);
  s.on('will-download', (_e, item) => {
    const d = prefs?.getAll().downloads;
    if (!d) return;
    if (!d.saveAsDialog) {
      const dir = downloadFolder();
      try {
        mkdirSync(dir, { recursive: true });
        const name = uniqueFileName(item.getFilename(), (c) => existsSync(join(dir, c)));
        item.setSavePath(join(dir, name));
      } catch {
      }
    }
    item.once('done', (_ev, state) => {
      const path = item.getSavePath();
      const started = item.getStartTime();
      downloadHistory?.add({
        filename: item.getFilename(),
        path,
        url: item.getURL(),
        bytes: item.getReceivedBytes() || item.getTotalBytes(),
        startedAt: started > 0 ? Math.round(started * 1000) : Date.now(),
        state,
      });
      mainWindow?.webContents.send(IPC.DOWNLOAD_HISTORY_CHANGED);
      if (state === 'completed' && d.openFolderWhenDone && path) shell.showItemInFolder(path);
      if (d.notify) notifyDownloadDone(item.getFilename(), path, state, d.notifyClick);
    });
  });
}

export function downloadFolder(): string {
  const chosen = prefs?.getAll().downloads.folder?.trim();
  return chosen || app.getPath('downloads');
}

export function knownDownloadPath(path: string): boolean {
  return downloadHistory?.all().some((r) => r.path === path) === true;
}

export function takeDownloadClickAction(path: string): DownloadClickAction | undefined {
  const action = downloadClickPaths.get(path);
  downloadClickPaths.delete(path);
  return action;
}

export function forgetDownloadClickPath(path: string): void {
  downloadClickPaths.delete(path);
}


//===========================
// Helper functions
//===========================

function notifyDownloadDone(
  filename: string,
  path: string,
  state: 'completed' | 'cancelled' | 'interrupted',
  onClick: DownloadClickAction,
): void {
  const done = state === 'completed';
  const L = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true);
  if (done && path && onClick !== 'nothing') downloadClickPaths.set(path, onClick);
  showToast({
    kind: 'download',
    title: done
      ? L.downloadCompleteTitle
      : state === 'cancelled'
        ? L.downloadCancelledTitle
        : L.downloadFailedTitle,
    body: filename,
    ...(done && path && onClick !== 'nothing' ? { threadId: path } : {}),
    persist: true,
  });
  if (prefs) playNotificationSound(prefs.getAll());
}

function spellcheckLanguagesFor(s: Electron.Session): string[] {
  const available = s.availableSpellCheckerLanguages;
  const locale = app.getLocale();
  const prefix = locale.split('-')[0]?.toLowerCase() ?? '';
  const system =
    available.find((c) => c.toLowerCase() === locale.toLowerCase()) ??
    available.find((c) => c.toLowerCase() === prefix) ??
    available.find((c) => c.toLowerCase().startsWith(`${prefix}-`));
  return system ? [system] : [];
}

function applySpellcheckTo(s: Electron.Session): void {
  try {
    s.setSpellCheckerLanguages(spellcheckLanguagesFor(s));
  } catch {
  }
}
