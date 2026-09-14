// Tabs in windows of their own: dragging a mailbox out of the strip gives it a window, and
// dropping it back on another window's strip puts it there. What travels is the view itself
// -- a WebContentsView survives being reparented -- so a mailbox keeps its page, its scroll
// position and its half-written reply on the way out and on the way back.
//
// A window made this way draws the same shell as the main one, told by IPC which tabs are
// its own. It owns nothing else: settings, the tour and the update button stay with the main
// window, because there is one of each and they are not per-window questions.
//
// Nothing is remembered across a restart. The app starts with every mailbox in the main
// window, which is also where they all end up when a torn-off window is closed -- an account
// is not a document, so closing its window may not take it away.

import { BrowserWindow, nativeTheme, screen } from 'electron';
import { pushActive, pushTabDrag, pushWindowState, pushWindowTabs } from '../core/broadcast';
import { DEV_URL, ICON_PATH, SIDEBAR_PRELOAD_PATH } from '../core/paths';
import { RENE_ZOOM_FACTOR } from '../core/rene';
import { isQuitting, keyOf, mainWindow, manager, prefs, profiles } from '../core/runtime';
import { SURFACES, type Surface } from '../../renderer/lib/surfaces';
import { overlayOptions, supportsOverlay, windowBackground } from './titlebar';
import { clampBoundsToDisplays } from './window-bounds';
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, handleInput } from './window-chrome';
import { showAccount } from './view-surfaces';
import {
  accountsClaimedBy,
  claimAccount,
  claimedAccounts,
  forgetTabWindow,
  isTabWindow,
  registerTabWindow,
  windowForAccount,
} from './tab-window-registry';
import type { KeyInput } from '../menus/shortcuts';


//===========================
// Constants
//===========================

/** Where the new window's corner goes relative to the cursor, so the tab that was let go of
 * lands roughly under the pointer rather than the window's middle or its title. */
const DROP_OFFSET = { x: -140, y: -12 };

const DEFAULT_TAB_WINDOW = { width: 1100, height: 760 };

/** How long a drag that left a window still counts as the drag that started it. A drop and
 * the dragend that follows it arrive from two different renderer processes, so the order is
 * near-certain but not promised; anything older than this is a drag nobody finished. */
const DRAG_TTL_MS = 10_000;


//===========================
// Module state
//===========================

let drag: { accountKey: string; at: number } | null = null;
/** The floor under a drag nobody ended, matching the repo's other timer handles. */
let dragTimer: ReturnType<typeof setTimeout> | null = null;

//===========================
// Exported functions
//===========================

/**
 * Remembers which tab is being dragged, and says so in every window
 *
 * The drag itself is the renderer's, and the two ends of it are in different windows: the
 * bar that receives the drop does not learn what was dropped from the drag data (that
 * crosses windows only on some platforms), it says "something was dropped on me" and this is
 * what answers with what.
 *
 * Every window is told, because a window that does not know a drag is happening cannot be
 * dropped on: the empty stretch of its bar is the window's own drag region, which swallows
 * the pointer before the page ever sees it. The bars turn that off while this is true.
 *
 * @param accountKey
 */
export function noteTabDrag(accountKey: string): void {
  drag = { accountKey, at: Date.now() };
  pushTabDrag(true);
  // A drag whose window went away never ends, and the bars would hold the window's drag
  // region open for the rest of the session -- no dragging the app around by its bar. The
  // timer is the floor under that; an ordinary drag clears it on dragend, long before.
  clearTimeout(dragTimer ?? undefined);
  dragTimer = setTimeout(() => clearTabDrag(), DRAG_TTL_MS);
}

/**
 * The tab currently being dragged, if the drag is still fresh
 *
 * @returns the account key, or null when nothing is in flight
 */
export function draggingAccount(): string | null {
  if (!drag) return null;
  if (Date.now() - drag.at > DRAG_TTL_MS) {
    clearTabDrag();
    return null;
  }
  return drag.accountKey;
}

export function clearTabDrag(): void {
  if (!drag) return;
  drag = null;
  pushTabDrag(false);
}

/**
 * Gives one mailbox a window of its own, at the pointer
 *
 * @param accountKey
 * @returns the new window, or null when the tab is already alone in its own window and
 *   moving it would only swap one window for another
 */
export function tearOffAccount(accountKey: string): BrowserWindow | null {
  const profile = profiles.find((p) => keyOf(p) === accountKey);
  if (!profile) return null;
  const from = windowForAccount(accountKey);
  if (from && isTabWindow(from) && accountsClaimedBy(from).length <= 1) return null;
  // The main window may be left with no tabs at all -- it is still the window settings and
  // the account list live in -- but a mailbox that is the only one anywhere would leave
  // nothing behind at all, and the way back would be a strip with no tab to drop onto.
  if (!isTabWindow(from) && visibleInMain().length <= 1) return null;

  const win = createTabWindow();
  moveAccount(accountKey, win);
  return win;
}

/**
 * Moves one mailbox into a window that already exists
 *
 * The way back: dropping a tab on another window's strip, and what closing a torn-off window
 * does with everything it held.
 *
 * @param accountKey
 * @param target
 */
export function adoptAccount(accountKey: string, target: BrowserWindow): void {
  if (target.isDestroyed()) return;
  const current = windowForAccount(accountKey);
  if (current && current.id === target.id) return;
  moveAccount(accountKey, target);
}

/**
 * Hands every mailbox in one window back to the main window
 *
 * @param win
 */
export function returnAccountsToMain(win: BrowserWindow): void {
  const main = mainWindow;
  if (!main || main.isDestroyed()) return;
  for (const accountKey of accountsClaimedBy(win)) moveAccount(accountKey, main, { focus: false });
}


//===========================
// Helper functions
//===========================

/**
 * The accounts the main window draws, which is everything nobody else claimed
 *
 * @private
 */
function visibleInMain(): string[] {
  const elsewhere = claimedAccounts();
  return profiles.map(keyOf).filter((key) => !elsewhere.includes(key));
}

/**
 * Which surface of an account is the one on screen
 *
 * @param accountKey
 * @returns the surface showing now, or mail -- which is what a tab that was never opened
 *   opens on
 * @private
 */
function shownSurface(accountKey: string): Surface {
  return SURFACES.find((s) => manager?.isShowing(accountKey, s)) ?? 'mail';
}

/**
 * Moves a mailbox, its views and its tab into another window
 *
 * @param accountKey
 * @param target
 * @param opts.focus whether the window it arrives in should be raised, which is right for a
 *   drag and wrong for a window emptying itself as it closes
 * @private
 */
function moveAccount(
  accountKey: string,
  target: BrowserWindow,
  opts: { focus?: boolean } = {},
): void {
  const profile = profiles.find((p) => keyOf(p) === accountKey);
  if (!profile || target.isDestroyed()) return;
  const from = windowForAccount(accountKey);
  const surface = shownSurface(accountKey);

  // Claimed before the views move: the manager asks the registry which window an account
  // belongs to whenever it builds one, so a mailbox that has never been opened lands in the
  // right window by being built there.
  claimAccount(accountKey, target);
  manager?.moveAccountToWindow(accountKey, target);
  showAccount(profile.ref, surface);
  if (opts.focus !== false && !target.isDestroyed()) target.focus();

  if (from && !from.isDestroyed() && from.id !== target.id) fillEmptyWindow(from);
  pushWindowTabs();
  pushActive();
}

/**
 * Puts something on screen in a window whose tab just left
 *
 * A torn-off window with nothing left in it has no reason to exist and is closed, which is
 * also the last step of dragging a window's only tab back to the main window.
 *
 * @param win
 * @private
 */
function fillEmptyWindow(win: BrowserWindow): void {
  const remaining = isTabWindow(win) ? accountsClaimedBy(win) : visibleInMain();
  if (remaining.length === 0) {
    if (isTabWindow(win)) win.close();
    return;
  }
  if (manager?.activeKeyIn(win)) return;
  const profile = profiles.find((p) => keyOf(p) === remaining[0]);
  if (profile) showAccount(profile.ref, shownSurface(remaining[0]));
}

/**
 * Builds a window for a tab that was dragged out
 *
 * The same chrome as the main window, at the pointer, sized like the window it left so the
 * mailbox is not suddenly reading at a different width.
 *
 * @private
 */
function createTabWindow(): BrowserWindow {
  const store = prefs?.getAll();
  const source = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
  const cursor = screen.getCursorScreenPoint();
  const size = {
    width: source?.width ?? DEFAULT_TAB_WINDOW.width,
    height: source?.height ?? DEFAULT_TAB_WINDOW.height,
  };
  const bounds = clampBoundsToDisplays(
    { ...size, x: cursor.x + DROP_OFFSET.x, y: cursor.y + DROP_OFFSET.y },
    screen.getAllDisplays().map((d) => ({ bounds: d.bounds })),
  );
  const frameless = supportsOverlay(process.platform)
    ? {
        titleBarStyle: 'hidden' as const,
        titleBarOverlay: overlayOptions(
          store?.theme ?? 'system',
          nativeTheme.shouldUseDarkColors,
          store?.reneMode ?? false,
        ),
      }
    : {};
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    backgroundColor: windowBackground(store?.theme ?? 'system', nativeTheme.shouldUseDarkColors),
    icon: ICON_PATH,
    minWidth: store?.appearance.restrictMinWindowSize === false ? 0 : MIN_WINDOW_WIDTH,
    minHeight: store?.appearance.restrictMinWindowSize === false ? 0 : MIN_WINDOW_HEIGHT,
    ...frameless,
    webPreferences: { preload: SIDEBAR_PRELOAD_PATH, contextIsolation: true },
  });
  registerTabWindow(win);

  win.webContents.on('did-finish-load', () => {
    if (store?.reneMode) win.webContents.setZoomFactor(RENE_ZOOM_FACTOR);
    pushWindowState(win);
    manager?.relayout(win);
  });
  win.on('focus', () => manager?.focusActiveSurface());
  win.webContents.on('before-input-event', (_e, input) => handleInput(input as unknown as KeyInput));
  // Before the window is gone, while its views can still be handed over: a child of a
  // destroyed window is destroyed with it, and that would close the mailbox rather than move
  // it. On quit there is nowhere to hand them to and the app is going down anyway.
  win.on('close', () => {
    if (!isQuitting) returnAccountsToMain(win);
  });
  win.on('closed', () => {
    forgetTabWindow(win);
    pushWindowTabs();
    pushActive();
  });

  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadURL('app://bundle/');
  return win;
}
