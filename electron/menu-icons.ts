import { nativeImage, type NativeImage } from 'electron';
import { SURFACE_ICON_DATA_URIS } from '../renderer/lib/surface-icon-data';

// De plaatjes voor de items van een OS-menu. De renderer stuurt alleen een naam
// mee (zie NativeMenuItem.icon); hier wordt dat een bitmap.

// Menu-items willen een icoon van 16 punten. De bron is 96px, dus verkleinen we —
// en leveren er meteen een 32px-versie bij: op een 200%-scherm zou Windows anders
// een 16px-bitmap moeten opblazen, en dan is het icoontje wazig.
const MENU_ICON_SIZE = 16;

// Eén keer omzetten en bewaren: elk menu dat opengaat vraagt dezelfde plaatjes
// opnieuw, en decoderen + tweemaal verkleinen per rechtsklik is zonde.
const cache = new Map<string, NativeImage | null>();

function build(dataUrl: string): NativeImage | null {
  const source = nativeImage.createFromDataURL(dataUrl);
  // Leeg betekent: nativeImage kon het formaat niet lezen (het leest alleen PNG en
  // JPEG). Dan liever geen icoontje dan een leeg vlak naast het item.
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
    // Geen tweede resolutie: het menu krijgt de 16px-versie. Een scherp icoontje is
    // een verfraaiing, geen reden om het main-proces om te laten vallen.
  }
  return image;
}

// Het plaatje bij een naam, of undefined als er geen is — een onbekende naam, of een
// plaatje dat niet te lezen bleek. `undefined` past rechtstreeks in een
// MenuItemConstructorOptions: geen icoon.
export function menuIcon(name: string | undefined): NativeImage | undefined {
  if (!name) return undefined;
  if (!cache.has(name)) {
    const dataUrl = SURFACE_ICON_DATA_URIS[name as keyof typeof SURFACE_ICON_DATA_URIS];
    cache.set(name, dataUrl ? build(dataUrl) : null);
  }
  return cache.get(name) ?? undefined;
}
