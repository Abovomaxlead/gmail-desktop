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

// Drie bestemmingen, en niet een boolean per instelling. Een aanroeper die zelf
// `openInApp && !alwaysNewWindow` moet uitrekenen komt vroeg of laat op een andere
// uitkomst dan de aanroeper ernaast; met één naam per bestemming kan dat niet.
export type GoogleAppTarget = 'in-app' | 'new-window' | 'external';

/**
 * De bestemming van één Google-app. De volgorde van de regels hieronder ís de
 * beslissing — hij staat daarom expliciet in de opmerkingen erbij.
 */
export function googleAppTarget(
  surface: string,
  prefs: Pick<GoogleAppsPrefs, 'openInApp' | 'alwaysNewWindow' | 'excluded'>,
): GoogleAppTarget {
  // De uitzondering per app gaat vóór de algemene stand. Wie één app op de lijst
  // zet, zegt iets specifieker dan wie de hoofdschakelaar omzet, en het omgekeerde
  // zou de lijst zinloos maken: bij `openInApp: true` (de standaard) zou er dan
  // nooit iets naar de browser gaan en leek de lijst stuk.
  if (prefs.excluded.includes(surface)) return 'external';
  // De hoofdschakelaar staat uit: alles naar de browser. Dit gaat vóór
  // `alwaysNewWindow`, want dat veld gaat over vensters van déze app — een app die
  // de app helemaal niet in mag, mag ook geen eigen venster van ons krijgen. Zonder
  // deze rangorde zou "niet in de app" met "altijd nieuw venster" alsnog een venster
  // van de app opleveren, precies wat de gebruiker uitzette.
  if (!prefs.openInApp) return 'external';
  if (prefs.alwaysNewWindow) return 'new-window';
  // De stand van nu, en dus de standaard: in het venster dat er al is.
  return 'in-app';
}

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
  const out: string[] = [];
  for (const key of pinned) {
    if (!known.includes(key)) continue;
    if (out.includes(key)) continue;
    out.push(key);
  }
  return out;
}
