// Where the app meets the operating system: starting with it, registering as a mail client,
// and the permissions its Google session may ask for.
//
// Windows picks the mailto: handler from a UserChoice hash it signs itself, so all an app
// can do is register the capability and open the page where the user picks it. Other
// platforms still let us claim it outright.
//
// setAppUserModelId is not optional: without it Windows drops every notification silently.

import { app, session, shell } from 'electron';
import { pushDefaultMailStatus, pushPrefs } from '../core/broadcast';
import { SESSION_PARTITION } from '../core/session-partition';
import { prefs } from '../core/runtime';
import { refreshTray } from '../menus/tray-setup';
import { sessionPermissionAllowed } from '../notify/notification-policy';
import { MAIL_APP_NAME, registerMailClient } from './mail-client-registration';


//===========================
// Exported functions
//===========================

export function setAutoStart(v: boolean): void {
  prefs!.setAutoStart(v);
  app.setLoginItemSettings({ openAtLogin: v });
  pushPrefs();
  refreshTray();
}
export function setLaunchMinimized(v: boolean): void {
  prefs!.setLaunchMinimized(v);
  pushPrefs();
}

export function ensureMailClientRegistered(): Promise<void> {
  if (process.platform !== 'win32' || !app.isPackaged) return Promise.resolve();
  return registerMailClient(process.execPath);
}


export function requestDefaultMail(): void {
  if (process.platform !== 'win32') {
    app.setAsDefaultProtocolClient('mailto');
    void pushDefaultMailStatus();
    return;
  }
  void ensureMailClientRegistered().then(() =>
    shell.openExternal(`ms-settings:defaultapps?registeredAppUser=${encodeURIComponent(MAIL_APP_NAME)}`),
  );
}

export function setupNotifications(): void {
  if (process.platform === 'win32') app.setAppUserModelId('com.gmaildesktop.app');
  const ses = session.fromPartition(SESSION_PARTITION);
  ses.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(sessionPermissionAllowed(permission)),
  );
  ses.setPermissionCheckHandler((_wc, permission) => sessionPermissionAllowed(permission));
}
