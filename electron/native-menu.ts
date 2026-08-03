import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { hasClickableItem, type NativeMenuItem } from '../renderer/lib/native-menu';

// Het openen van een OS-menu voor de balk. De keuzelogica en de teksten zitten in
// de renderer (plus-menu.ts, tab-menu.ts); hier staat alleen het native werk, net
// zoals context-menu.ts planContextMenu van attachContextMenu scheidt.

// Electron stuurt 'menu-will-close' op Windows vóór de klik van het gekozen item.
// Meteen "weggeklikt" antwoorden zou dus elke keuze als afgebroken bestempelen;
// even wachten laat de klik voorgaan. Wie echt wegklikt merkt de vertraging niet,
// want dan gebeurt er hoe dan ook niets.
const DISMISS_GRACE_MS = 100;

// Geen coördinaten: het menu komt op de cursor, zoals elk OS-menu. Zelf plaatsen
// zou betekenen dat we CSS-pixels van de pagina naar vensterpunten omrekenen, en
// die twee lopen in Rene-modus (200% zoom op deze webContents) uiteen.
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
        // Alleen het actieve item wordt een vinkje: gaf elk item `type: 'checkbox'`,
        // dan stond er voor alle regels een leeg hokje.
        ...(item.checked ? { type: 'checkbox' as const, checked: true } : {}),
        click: () => settle(item.id),
      };
    });

    const menu = Menu.buildFromTemplate(template);
    // Zonder dit blijft de belofte hangen bij wegklikken, en daarmee het menu zelf.
    menu.once('menu-will-close', () => setTimeout(() => settle(null), DISMISS_GRACE_MS));
    menu.popup({ window: win });
  });
}
