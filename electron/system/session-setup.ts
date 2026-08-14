// What every Electron session gets wired up with: where downloads land, what is recorded
// about them, and the spellchecker's language.
//
// Sessions arrive twice over — once for the default one and again for each partition
// Electron creates — so attachSessionHandlers is called from both and remembers which it has
// already seen. Without that a download would be logged, notified and revealed once per
// registration.
//
// One trap worth keeping in mind: DownloadItem.getStartTime() is in seconds, not
// milliseconds, and a zero means Electron has no start time to give.

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

// A download card carries its path in threadId — the only field on a Toast that is a free
// string, and reusing it beats widening the type for one kind. The action is remembered
// here rather than on the card, so a preference changed between download and click is the
// one that applies.
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
        // getStartTime is in seconds, and 0 means Electron has none to give.
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

/** Reveal and open accept only paths the log already knows, so neither can be pointed at an
 * arbitrary file by whatever sent the message. */
export function knownDownloadPath(path: string): boolean {
  return downloadHistory?.all().some((r) => r.path === path) === true;
}

/** What clicking this download's card should do, consumed in the taking: a card is spent
 * once clicked, and a second click must not open the file again. */
export function takeDownloadClickAction(path: string): DownloadClickAction | undefined {
  const action = downloadClickPaths.get(path);
  downloadClickPaths.delete(path);
  return action;
}

/** Releases a card's remembered action when it leaves the stack without being clicked. */
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

// The spellchecker follows the system language and nothing else - there is no setting
// for it. Setting it explicitly rather than leaving it to Electron matters: its default
// is en-US, which would underline every Dutch word in a compose window.
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
