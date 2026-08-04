// The seam between the bar and the main process for dropdown menus. The bar is a
// page below the native Gmail view, so a menu it draws itself falls behind it;
// main opens a real OS menu instead. The renderer sends what should be in the menu
// and main reports back what was chosen. Pure data - no Electron, no DOM.
//
// `icon` is the name of a bitmap main already holds (menu-icons.ts), not the image:
// sending base64 over IPC on every right-click would be wasteful. An unknown name
// simply yields no icon.
//
// A menu with no clickable item is an empty box, and both sides of the seam refuse
// one: a delegated mailbox without a calendar URL used to leave an empty window.
export type NativeMenuItem =
  | { kind: 'item'; id: string; label: string; icon?: string }
  | { kind: 'separator' }
  | { kind: 'text'; label: string };

export function hasClickableItem(items: readonly NativeMenuItem[]): boolean {
  return items.some((i) => i.kind === 'item');
}
