// Waar een Google-app opengaat als je hem aanklikt: in de app, in een eigen
// venster, of in de browser van het systeem.
//
// Puur, zonder Electron en zonder DOM. Dat is geen netheid maar noodzaak: dit is de
// enige plek waar de rangorde tussen drie instellingen staat, en die rangorde is
// alleen te controleren als hij te testen is zonder een venster te openen. Main mag
// hem dus nergens anders nog eens naspelen — één afwijkende `if` daar en de app
// doet iets anders dan wat het instellingenpaneel belooft.
//
// `import type` en niet een gewone import: `prefs-store.ts` leest en schrijft
// bestanden, en die zou dit bestand met een echte import de test in trekken (en een
// kring maken zodra main-code de andere kant op wil kijken). Een type verdwijnt bij
// het compileren, dus er blijft niets van over.
import type { GoogleAppsPrefs } from './prefs-store';
import { filterPinned } from '../renderer/lib/google-apps';

// Drie bestemmingen, en niet een boolean per instelling. Een aanroeper die zelf
// `openInApp && !alwaysNewWindow` moet uitrekenen komt vroeg of laat op een andere
// uitkomst dan de aanroeper ernaast; met één naam per bestemming kan dat niet.
// De beslissing zelf staat in `renderer/lib/google-apps.ts`. Daar en niet hier, omdat
// de balk hem ook nodig heeft en Next.js niets van buiten `renderer/` compileert —
// zie de opmerking bij die functie. Deze twee regels houden de naam waaronder het
// hoofdproces hem kent.
export type { GoogleAppTarget } from '../renderer/lib/google-apps';
export { googleAppTarget } from '../renderer/lib/google-apps';

/**
 * De vastgezette apps, geschoond tegen wat er in het voorkeurenbestand kan staan.
 * Houdt alleen sleutels die `known` kent, in de volgorde van `pinned`, ontdubbeld.
 */
export function pinnedSurfaces(pinned: readonly string[], known: readonly string[]): string[] {
  // Waarom schonen: het bestand overleeft de app-versie. Een gebruiker die 'keep'
  // vastzette en daarna een versie krijgt waarin die app niet meer bestaat, houdt
  // die sleutel op schijf. De balk zou er dan een icoon voor zoeken dat er niet is
  // en op een tabblad uitkomen dat nergens naar wijst — een lege knop, of een
  // exception in `SURFACE_CONFIG[key]`. Een hand-geschreven bestand kan er ook
  // gewoon onzin in hebben staan.
  //
  // De volgorde is die van `pinned` en niet die van `known`: dat is de volgorde
  // waarin de iconen in de balk staan, en die heeft de gebruiker zelf gezet.
  // Ontdubbelen omdat dezelfde app twee keer in de balk twee knoppen naar hetzelfde
  // tabblad is, en de tweede niets toevoegt behalve breedte.
  //
  // De regel zelf staat in `renderer/lib/google-apps.ts` en niet hier. De balk heeft
  // hem óók nodig, en Next.js compileert niets van buiten `renderer/` — dus zou een
  // eigen kopie hier betekenen dat dezelfde regel op twee plekken staat, met twee
  // kansen dat er één verandert. Deze functie blijft bestaan als de naam waaronder
  // het hoofdproces hem kent, en geeft het werk door.
  return filterPinned(pinned, known);
}
