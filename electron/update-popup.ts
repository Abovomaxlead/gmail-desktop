// Pure derivation of the little "check for updates" dialog shown after a
// tray-initiated check. Intermediate states return null so the caller waits for a
// terminal result before popping anything up.
import type { NativeLabels } from './native-labels';

export interface UpdateStatusLike {
  state: string;
  version?: string;
  currentVersion?: string;
  percent?: number;
  message?: string;
}

export interface UpdatePopup {
  message: string;
  detail?: string;
  buttons: string[];
  downloadButtonIndex?: number;
}

export function updateCheckPopup(status: UpdateStatusLike, L: NativeLabels): UpdatePopup | null {
  switch (status.state) {
    case 'dev':
      return {
        message: L.updateDevOnly,
        buttons: [L.ok],
      };
    case 'available':
      return {
        message: L.updateAvailableMessage(status.version),
        detail: status.currentVersion ? L.updateInstalledDetail(status.currentVersion) : undefined,
        buttons: [L.download, L.later],
        downloadButtonIndex: 0,
      };
    case 'not-available':
      return {
        message: L.updateLatestMessage(status.currentVersion),
        buttons: [L.ok],
      };
    case 'error':
      return {
        message: L.updateCheckFailed,
        detail: status.message ? String(status.message) : undefined,
        buttons: [L.ok],
      };
    default:
      return null;
  }
}
