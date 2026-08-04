import { APP_SURFACES, SURFACE_CONFIG, type Surface } from './surfaces';

// Welke Google-apps de gebruiker vast in de balk kan zetten, en welke daar dan
// staan. Onder `renderer/lib/` omdat zowel de balk (Next.js) als het hoofdproces
// (esbuild) dit moet kunnen lezen: Next compileert niets van buiten zijn eigen map,
// esbuild en vitest wel overal vandaan — dezelfde reden als bij `surfaces.ts`.
// Houd deze module pure data en logica: geen Electron- en geen DOM-import.

// De apps die je kan vastzetten: alles behalve de post zelf. Mail vastzetten zou een
// knop naast het tandwiel geven die je naar het postvak brengt dat je al open hebt —
// daar staat de accountbalk zelf al voor.
export const PINNABLE_SURFACES: readonly Surface[] = ['calendar', ...APP_SURFACES];

export type GoogleAppTarget = 'in-app' | 'new-window' | 'external';

/**
 * De bestemming van één Google-app: in de app, in een eigen venster, of in de
 * browser. De volgorde van de regels hieronder ís de beslissing.
 *
 * Staat hier en niet in `electron/`, omdat de balk hem óók nodig heeft: die mag zijn
 * actieve tabblad niet omzetten naar een app die buiten de app opengaat. Deed hij dat
 * wel, dan wees de balk een tabblad aan waar geen weergave bij hoort en bleef er een
 * leeg venster achter terwijl de browser de app opende. `electron/google-apps-open.ts`
 * exporteert deze functie door, zodat main en de balk dezelfde regel volgen.
 */
export function googleAppTarget(
  surface: string,
  prefs: { openInApp: boolean; alwaysNewWindow: boolean; excluded: readonly string[] },
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

/** De leesbare naam van een app, zoals hij ook in het rechtsklikmenu staat. */
export function surfaceLabel(surface: Surface): string {
  return SURFACE_CONFIG[surface].label;
}

/**
 * De vastgezette apps, in de volgorde waarin ze in de balk komen te staan.
 *
 * Filtert weg wat niet vast te zetten is. Dat is niet overdreven voorzichtig: het
 * voorkeurenbestand kan een app noemen die een latere versie niet meer heeft, en de
 * balk mag daar geen knop voor tekenen die naar niets wijst. Ontdubbelen om dezelfde
 * reden — twee keer hetzelfde icoon is geen keuze maar een fout.
 */
export function pinnedSurfaces(pinned: readonly string[]): Surface[] {
  return filterPinned(pinned, PINNABLE_SURFACES) as Surface[];
}

/**
 * Hetzelfde filter, maar met de lijst bekende sleutels als argument.
 *
 * Deze vorm bestaat omdat het hoofdproces dezelfde regel nodig heeft en daar met een
 * andere lijst werkt (`SURFACES`, inclusief de post). Eén implementatie voor beide:
 * `electron/google-apps-open.ts` exporteert deze functie door in plaats van hem na te
 * maken, want twee keer dezelfde regel is twee keer de kans dat er één verandert.
 */
export function filterPinned(pinned: readonly string[], known: readonly string[]): string[] {
  const out: string[] = [];
  for (const key of pinned) {
    if (!known.includes(key)) continue;
    if (out.includes(key)) continue;
    out.push(key);
  }
  return out;
}
