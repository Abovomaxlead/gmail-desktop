// Bitmaps for native OS menu items: the renderer sends a name and this turns it into an
// image. Cached, since every menu that opens asks for the same ones.
//
// `undefined` drops into MenuItemConstructorOptions as "no icon", which beats a blank
// square or taking down the main process for a decoration.

import { nativeImage, type NativeImage } from 'electron';
import { SURFACE_ICON_DATA_URIS } from '../../renderer/lib/surface-icon-data';


//===========================
// Constants
//===========================

const MENU_ICON_SIZE = 16;

const cache = new Map<string, NativeImage | null>();


//===========================
// Exported functions
//===========================

/**
 * The bitmap for an icon name
 *
 * @param name as the renderer sends it; see NativeMenuItem.icon
 * @returns {NativeImage|undefined} undefined for an unknown name or an unreadable format,
 *   which drops into MenuItemConstructorOptions as "no icon"
 */
export function menuIcon(name: string | undefined): NativeImage | undefined {
  if (!name) return undefined;
  if (!cache.has(name)) {
    const dataUrl = SURFACE_ICON_DATA_URIS[name as keyof typeof SURFACE_ICON_DATA_URIS];
    cache.set(name, dataUrl ? build(dataUrl) : null);
  }
  return cache.get(name) ?? undefined;
}


//===========================
// Helper functions
//===========================

/**
 * Scales one source icon down to menu size
 *
 * A 32px representation is added alongside, without which Windows would blow the 16px
 * bitmap up on a 200% display.
 *
 * @param dataUrl
 * @returns {NativeImage|null} null when nativeImage could not read the format
 * @private
 */
function build(dataUrl: string): NativeImage | null {
  const source = nativeImage.createFromDataURL(dataUrl);
  if (source.isEmpty()) return null;
  const image = source.resize({ width: MENU_ICON_SIZE, height: MENU_ICON_SIZE, quality: 'best' });
  try {
    image.addRepresentation({
      scaleFactor: 2,
      buffer: source
        .resize({ width: MENU_ICON_SIZE * 2, height: MENU_ICON_SIZE * 2, quality: 'best' })
        .toPNG(),
    });
  } catch {
  }
  return image;
}
