// Pops an OS menu for the tab bar. The choices and labels are built in the renderer
// (plus-menu.ts, tab-menu.ts); only the native work sits here. On Windows
// 'menu-will-close' fires before the click of the chosen item, so a dismissal is
// reported after a short grace period or every choice would count as aborted.
//
// A right-click positions itself: leaving x and y off puts the menu at the cursor, which is
// where the user just clicked and therefore always right. An anchor is for the one caller
// that has no cursor to go by -- the tour, which pops this menu to show what it looks like --
// and it is given in the renderer's own CSS pixels. Those are not window points: the page is
// drawn at the webContents zoom factor, which is 2 in Rene mode, so an unconverted rect would
// land the menu at half the height it belongs at. Converting here rather than asking the
// renderer to do it keeps the one place that knows about the zoom factor the one place that
// applies it.

import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { hasClickableItem, type NativeMenuItem } from '../../renderer/lib/native-menu';
import { menuIcon } from './menu-icons';

// how long a close is given to be followed by the click of the chosen item
const DISMISS_GRACE_MS = 100;


//===========================
// Types
//===========================

/** Where to put the menu, in the renderer's CSS pixels. */
export interface MenuAnchor {
  x: number;
  y: number;
}


//===========================
// Exported functions
//===========================

/**
 * Pops an OS menu for the tab bar
 *
 * @param win the window the menu belongs to
 * @param items as the renderer built them
 * @param anchor where to put it in CSS pixels; omit to use the cursor, which is what a
 *   right-click wants
 * @returns {Promise<string|null>} the id of the chosen item, or null when the menu was
 *   dismissed or held nothing to click
 */
export function popupNativeMenu(
  win: BrowserWindow,
  items: readonly NativeMenuItem[],
  anchor?: MenuAnchor,
): Promise<string | null> {
  if (!hasClickableItem(items)) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const settle = (id: string | null): void => {
      if (settled) return;
      settled = true;
      resolve(id);
    };

    const template: MenuItemConstructorOptions[] = items.map((item) => {
      if (item.kind === 'separator') return { type: 'separator' };
      if (item.kind === 'text') return { label: item.label, enabled: false };
      return {
        label: item.label,
        icon: menuIcon(item.icon),
        click: () => settle(item.id),
      };
    });

    const menu = Menu.buildFromTemplate(template);
    menu.once('menu-will-close', () => setTimeout(() => settle(null), DISMISS_GRACE_MS));
    menu.popup(anchor ? { window: win, ...windowPoint(win, anchor) } : { window: win });
  });
}


//===========================
// Helper functions
//===========================

/**
 * Turns a rect the renderer measured into the window points menu.popup expects
 *
 * @param win the window whose zoom factor scales its page
 * @param anchor in CSS pixels
 * @returns {{x: number, y: number}} rounded, because popup takes integers
 * @private
 */
function windowPoint(win: BrowserWindow, anchor: MenuAnchor): { x: number; y: number } {
  let scale = 1;
  try {
    scale = win.webContents.getZoomFactor();
  } catch {
  }
  return { x: Math.round(anchor.x * scale), y: Math.round(anchor.y * scale) };
}
