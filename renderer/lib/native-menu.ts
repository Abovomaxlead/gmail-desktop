// The seam between the bar and the main process for dropdown menus. The bar sits below the
// native Gmail view, so a menu it draws itself falls behind it and main opens a real OS
// menu instead. Pure data — no Electron, no DOM.
//
// `icon` is the name of a bitmap main already holds, not the image. A menu with no
// clickable item is an empty box, and both sides of the seam refuse one.

export type NativeMenuItem =
  | { kind: 'item'; id: string; label: string; icon?: string }
  | { kind: 'separator' }
  | { kind: 'text'; label: string };

/**
 * Whether a menu is worth opening
 *
 * @param items
 * @returns false for a menu of separators and labels, which is an empty box
 */
export function hasClickableItem(items: readonly NativeMenuItem[]): boolean {
  return items.some((i) => i.kind === 'item');
}
