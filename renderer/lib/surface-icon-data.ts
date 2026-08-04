// The icon per surface, in one place: the bar draws them as <img>, main turns them
// into a NativeImage for the OS menus. All PNG - nativeImage reads only PNG and
// JPEG, so an icon in another format vanishes silently from the menu.

import { APP_ICON_DATA_URIS } from './app-icon-data';
import { CALENDAR_ICON_DATA_URI } from './calendar-icon-data';
import { APP_SURFACES, type Surface } from './surfaces';

export const SURFACE_ICON_DATA_URIS: Partial<Record<Surface, string>> = {
  mail: APP_ICON_DATA_URIS.mail,
  calendar: CALENDAR_ICON_DATA_URI,
  ...Object.fromEntries(APP_SURFACES.map((s) => [s, APP_ICON_DATA_URIS[s]])),
};
