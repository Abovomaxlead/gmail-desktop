// The panel that "add a delegated mailbox" opens, and what comes back out of it.
//
// Adding used to be a side effect of asking: the button ran the same relay sweep the app runs
// by itself, and everything the relay named was written into the store. One press dragged in
// every mailbox the domain had ever delegated to you, and there was no way to say which ones
// you wanted. So the two halves are split -- delegated-controller.ts discovers without
// writing, this shows the list, and only a pick writes anything.
//
// An overlay rather than a window, the same way the mail-drop panel is one: it belongs to the
// app that is already open, and it takes the keyboard because it is a list you tick through.

import { OverlayView } from '../windows/overlay-view';
import { IPC } from '../core/ipc';
import { DEV_URL, SIDEBAR_PRELOAD_PATH } from '../core/paths';
import { currentLocale, delegatedPicker, mainWindow, manager, prefs, setDelegatedPicker } from '../core/runtime';
import { addDelegatedMailboxes, discoverDelegatedMailboxes } from './delegated-controller';
import { notifyLog } from '../notify/notify-log';
import type { DelegatedPickerAsk } from '../../renderer/lib/delegated-picker';


//===========================
// Exported functions
//===========================

/**
 * Opens the picker and fills it in once the relay has answered
 *
 * Shown before the answer is in, because the ask takes a second or two and a button that does
 * nothing visible for that long is a button people press twice.
 */
export function openDelegatedPicker(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const overlay =
    delegatedPicker ??
    new OverlayView(
      mainWindow,
      SIDEBAR_PRELOAD_PATH,
      DEV_URL ? `${DEV_URL}/delegated-picker` : 'app://bundle/delegated-picker.html',
      IPC.DELEGATED_PICK_ASK,
      undefined,
      // Takes the keyboard: Esc closes the panel and the rows are tickable with the keyboard,
      // neither of which reaches a view that was never focused
      true,
      () => manager?.focusActiveSurface(),
    );
  setDelegatedPicker(overlay);
  overlay.open(ask({ scanning: true, candidates: [], answered: false }));

  void discoverDelegatedMailboxes()
    .then(({ candidates, answered }) => {
      notifyLog(
        `[delegated] asked to add: ${candidates.length} candidate(s)${answered ? '' : ', relay gave no answer'}`,
      );
      // A panel the user closed while the relay was thinking stays closed
      if (!overlay.isOpen()) return;
      overlay.update(ask({ scanning: false, candidates, answered }));
    })
    .catch(() => undefined);
}

export function closeDelegatedPicker(): void {
  delegatedPicker?.close();
}

/**
 * Adds what was ticked and puts the panel away
 *
 * @param emails the addresses the user picked; an empty pick is a cancel by another name
 */
export function applyDelegatedPick(emails: string[]): void {
  closeDelegatedPicker();
  addDelegatedMailboxes(emails);
}


//===========================
// Helper functions
//===========================

/**
 * Completes a payload with the two things the page cannot ask for itself
 *
 * @param partial what this round of the ask knows
 * @returns the payload as the page expects it
 * @private
 */
function ask(partial: Omit<DelegatedPickerAsk, 'locale' | 'reneMode'>): DelegatedPickerAsk {
  return {
    ...partial,
    locale: currentLocale(),
    reneMode: prefs?.getAll().reneMode === true,
  };
}
