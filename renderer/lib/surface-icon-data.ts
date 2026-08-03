import { APP_ICON_DATA_URIS } from './app-icon-data';
import { CALENDAR_ICON_DATA_URI } from './calendar-icon-data';
import { APP_SURFACES, type Surface } from './surfaces';

// Het plaatje per surface, op één plek. De balk tekent ze als <img>, main maakt er
// een NativeImage van voor de OS-menu's — dus staat de kaart hier in lib/ en niet
// in app/: Next.js compileert niets van buiten zijn eigen map, esbuild en vitest
// wel overal vandaan.
//
// Allemaal PNG. Dat is geen willekeur: nativeImage leest alleen PNG en JPEG, dus
// een icoon in een ander formaat verdwijnt stil uit het menu.
//
// Mail hoort erbij: in het tabmenu staat de weg terug naar de post, en dan mag die
// regel niet de enige zonder icoontje zijn. In de balk zelf draagt een mailtabblad
// nog steeds de avatar van het account, niet dit logo.
export const SURFACE_ICON_DATA_URIS: Partial<Record<Surface, string>> = {
  mail: APP_ICON_DATA_URIS.mail,
  calendar: CALENDAR_ICON_DATA_URI,
  ...Object.fromEntries(APP_SURFACES.map((s) => [s, APP_ICON_DATA_URIS[s]])),
};
