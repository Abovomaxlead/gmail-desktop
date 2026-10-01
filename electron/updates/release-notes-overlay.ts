// The modal that shows what a new version says about itself, the moment the app finds one.
//
// Until this existed, a found update was a card in the corner naming a version number, and
// "Wat is er nieuw" could only ever show the notes of the version already installed -- so
// nobody could read what they were about to install before installing it. The notes are on
// the release itself, and electron-updater hands them over with the version, so there is
// nothing to fetch.
//
// An overlay rather than a window, the same way the copy picker is one: a modal drawn inside
// the sidebar page would sit behind the Gmail view. It takes the keyboard, because Esc has to
// close it -- and it hands focus back to the mail view on the way out.
//
// Nothing here downloads or installs anything: the page sends the ordinary update:download
// the settings panel already sends, and closing is a decision, not a postponement the app
// keeps nagging about.

import { OverlayView } from '../windows/overlay-view';
import { IPC } from '../core/ipc';
import { DEV_URL, SIDEBAR_PRELOAD_PATH } from '../core/paths';
import {
  currentLocale,
  currentlyDark,
  mainWindow,
  manager,
  prefs,
  releaseNotesOverlay,
  setReleaseNotesOverlay,
} from '../core/runtime';
import { notifyLog } from '../notify/notify-log';
import { parseReleaseNotes } from './changelog';
import type { ReleaseNotesAsk } from '../../renderer/lib/release-notes';


//===========================
// Exported functions
//===========================

/**
 * Puts the notes of a newly found version on screen
 *
 * @param version the version that was found
 * @param markdown the release body, as the updater hands it over; may be empty
 * @param downloading whether the download is already running, which the page draws instead of
 *   offering a button
 * @returns true when the modal is up, false when there was nothing to show -- a release with
 *   no notes is left to the card in the corner rather than shown as an empty box
 */
export function openReleaseNotes(
  version: string,
  markdown: string,
  downloading = false,
): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const notes = parseReleaseNotes(version, markdown);
  if (!notes) {
    notifyLog(`[update] ${version} carries no release notes, no modal`);
    return false;
  }
  const overlay =
    releaseNotesOverlay ??
    new OverlayView(
      mainWindow,
      SIDEBAR_PRELOAD_PATH,
      DEV_URL ? `${DEV_URL}/release-notes` : 'app://bundle/release-notes.html',
      IPC.RELEASE_NOTES_ASK,
      undefined,
      // Takes the keyboard: Esc is one of the three ways out, and it never reaches a view
      // that was not focused.
      true,
      () => manager?.focusActiveSurface(),
    );
  setReleaseNotesOverlay(overlay);
  notifyLog(`[update] showing the notes of ${version}`);
  overlay.open({
    version,
    notes,
    downloading,
    locale: currentLocale(),
    reneMode: prefs?.getAll().reneMode === true,
    dark: currentlyDark(),
  } satisfies ReleaseNotesAsk);
  return true;
}

export function closeReleaseNotes(): void {
  releaseNotesOverlay?.close();
}
