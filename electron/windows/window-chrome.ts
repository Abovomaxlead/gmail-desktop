// The main window's own chrome: its remembered size and position, the title-bar overlay, the
// keyboard shortcuts, and the two zoom levels.
//
// Rene mode is a zoom, not a theme. It scales the interface and every Gmail view together,
// which is why applying it has to reach the window, the views and the title bar in one pass.
//
// Bounds are saved on a delay because resize and move fire continuously while dragging, and
// writing prefs.json on each event would be hundreds of writes per drag.

import { nativeTheme } from 'electron';
import { RENE_ZOOM_FACTOR, RENE_ZOOM_LEVEL } from '../core/rene';
import { authIdx, idxOfKey, keyOf, mainWindow, manager, prefs, profiles } from '../core/runtime';
import { openComposeWindow } from '../compose/mailto-controller';
import { showAccount } from './view-surfaces';
import { resolveShortcut, type KeyInput } from '../menus/shortcuts';
import { overlayOptions, supportsOverlayUpdate } from './titlebar';
import { grownToMinimum } from './window-bounds';
import { shellWindows } from './tab-window-registry';


//===========================
// Constants
//===========================

// The floor the "do not make it too small" switch enforces. Height matters as much as
// width: the topbar is 40px (80 in Rene mode) and everything below it is the mail view,
// so without a minimum height the window can be squashed to a bare strip of chrome.
export const MIN_WINDOW_WIDTH = 800;
export const MIN_WINDOW_HEIGHT = 600;


//===========================
// Module state
//===========================

let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null;


//===========================
// Exported functions
//===========================

export function saveWindowBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !prefs) return;
  const maximized = mainWindow.isMaximized();
  const b = mainWindow.getNormalBounds();
  prefs.setWindow({ width: b.width, height: b.height, x: b.x, y: b.y, maximized });
}
/** Drops a save that has not fired yet, for a window that is going away. */
export function cancelPendingBoundsSave(): void {
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
}

export function scheduleSaveBounds(): void {
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(saveWindowBounds, 400);
}

export function handleInput(input: KeyInput): void {
  const action = resolveShortcut(input);
  if (!action) return;
  if (action.type === 'devtools') {
    manager?.toggleDevTools();
  } else if (action.type === 'reload') {
    manager?.reloadActive();
  } else if (action.type === 'switch') {
    const orderOf = (p: (typeof profiles)[number]): number => prefs?.getAccount(p.email).order ?? authIdx(p);
    const ordered = [...profiles].sort((a, b) => orderOf(a) - orderOf(b));
    const target = ordered[action.n - 1];
    if (target) showAccount(target.ref, 'mail');
  } else if (action.type === 'compose') {
    const activeKey = manager?.activeKey();
    const active = activeKey ? idxOfKey(activeKey) : null;
    if (active != null) openComposeWindow(active);
  } else if (action.type === 'zoom') {
    if (prefs?.getAll().reneMode) return;
    const activeKey = manager?.activeKey();
    if (activeKey == null) return;
    const current = manager!.getActiveZoomLevel();
    const level = action.dir === 'reset' ? 0 : current + (action.dir === 'in' ? 0.5 : -0.5);
    const clamped = Math.max(-3, Math.min(3, level));
    manager!.setZoomForKey(activeKey, clamped);
    const email = profiles.find((p) => keyOf(p) === activeKey)?.email;
    if (email) prefs!.setAccount(email, { zoom: clamped });
  }
}

/** The title-bar overlay is per window, so every shell window gets the new colours. */
export function applyTitleBarOverlay(): void {
  if (!prefs) return;
  if (!supportsOverlayUpdate(process.platform)) return;
  const p = prefs.getAll();
  const options = overlayOptions(p.theme, nativeTheme.shouldUseDarkColors, p.reneMode);
  for (const win of shellWindows()) win.setTitleBarOverlay(options);
}

export function applyReneZoom(): void {
  if (!prefs) return;
  const on = prefs.getAll().reneMode;
  for (const win of shellWindows()) win.webContents.setZoomFactor(on ? RENE_ZOOM_FACTOR : 1);
  applyTitleBarOverlay();
  for (const p of profiles) {
    manager?.setZoomForKey(keyOf(p), on ? RENE_ZOOM_LEVEL : prefs.getAccount(p.email).zoom ?? 0);
  }
  manager?.relayout();
}

export function applyMinWindowSize(): void {
  const on = prefs?.getAll().appearance.restrictMinWindowSize !== false;
  for (const win of shellWindows()) {
    win.setMinimumSize(on ? MIN_WINDOW_WIDTH : 0, on ? MIN_WINDOW_HEIGHT : 0);
    if (!on || win.isMaximized() || win.isFullScreen()) continue;
    const bounds = win.getBounds();
    const grown = grownToMinimum(bounds, { width: MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT });
    if (grown.width === bounds.width && grown.height === bounds.height) continue;
    win.setBounds({ ...bounds, ...grown });
  }
}
