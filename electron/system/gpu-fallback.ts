// Switches a machine whose GPU keeps crashing over to software rendering.
//
// Windows takes the graphics context away on a driver reset, a resume, a dock or a display
// change; Chromium's GPU process then exits (code 34, context lost) and starts again. On some
// machines that keeps happening, and a window opened in between -- Gmail's own pop-out, say --
// comes up white until the app restarts. Hardware acceleration is read once, before "ready"
// (main.ts), so the switch can only take effect on the next start; the user is offered that
// restart rather than having it done to them, since they may be halfway through a mail.

import { app, dialog } from 'electron';
import { pushPrefs } from '../core/broadcast';
import { currentLocale, mainWindow, prefs, setIsQuitting } from '../core/runtime';
import { nativeLabels } from '../menus/native-labels';
import { notifyLog } from '../notify/notify-log';


//===========================
// Exported functions
//===========================

/**
 * Turns hardware acceleration off for the next start and offers that start now
 *
 * Called on a GPU-crash streak. Does nothing when the setting is already off, so a machine
 * the user already switched over -- or that this switched earlier in the session -- is not
 * asked twice.
 */
export function fallBackToSoftwareRendering(): void {
  if (!prefs || prefs.getAll().advanced.hardwareAcceleration === false) return;
  prefs.setAdvanced({ hardwareAcceleration: false });
  pushPrefs();
  notifyLog('[crash] the GPU process keeps crashing; hardware acceleration is off from the next start');

  const L = nativeLabels(currentLocale(), prefs.getAll().reneMode === true);
  const box = {
    type: 'warning' as const,
    noLink: true,
    buttons: [L.restartNow, L.later],
    defaultId: 0,
    cancelId: 1,
    message: L.gpuFallbackMessage,
    detail: L.gpuFallbackDetail,
  };
  const parent = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : undefined;
  const shown = parent ? dialog.showMessageBox(parent, box) : dialog.showMessageBox(box);
  void shown
    .then(({ response }) => {
      if (response !== 0) return;
      notifyLog('[crash] restarting for software rendering');
      setIsQuitting(true);
      app.relaunch();
      app.quit();
    })
    .catch(() => {});
}
