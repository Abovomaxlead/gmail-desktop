// Pops an OS menu for the tab bar. The choices and labels are built in the renderer
// (plus-menu.ts, tab-menu.ts); only the native work sits here. On Windows
// 'menu-will-close' fires before the click of the chosen item, so a dismissal is
// reported after a short grace period or every choice would count as aborted. The
// menu is never positioned by us: page CSS pixels and window points diverge at the
// 200% zoom of Rene mode.
import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { hasClickableItem, type NativeMenuItem } from '../renderer/lib/native-menu';
import { menuIcon } from './menu-icons';

const DISMISS_GRACE_MS = 100;

export function popupNativeMenu(
  win: BrowserWindow,
  items: readonly NativeMenuItem[],
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
    menu.popup({ window: win });
  });
}
