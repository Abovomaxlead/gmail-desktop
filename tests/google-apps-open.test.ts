import { describe, expect, it } from 'vitest';
import { googleAppTarget, pinnedSurfaces } from '../electron/google-apps-open';

// De standaardstand: precies wat de app deed voordat deze instellingen bestonden.
// Elke test hieronder zet er één veld in af, zodat te zien is welk veld welke
// uitkomst veroorzaakt en niet een combinatie van drie.
const BASE = { openInApp: true, alwaysNewWindow: false, excluded: [] as string[] };

describe('googleAppTarget', () => {
  it('opens in the existing window by default', () => {
    expect(googleAppTarget('calendar', BASE)).toBe('in-app');
    expect(googleAppTarget('drive', BASE)).toBe('in-app');
  });

  it('opens a separate window when asked to', () => {
    expect(googleAppTarget('drive', { ...BASE, alwaysNewWindow: true })).toBe('new-window');
  });

  it('sends everything to the browser when the app is switched off', () => {
    expect(googleAppTarget('drive', { ...BASE, openInApp: false })).toBe('external');
    expect(googleAppTarget('calendar', { ...BASE, openInApp: false })).toBe('external');
  });

  it('sends an excluded app to the browser', () => {
    expect(googleAppTarget('keep', { ...BASE, excluded: ['keep'] })).toBe('external');
  });

  // De lijst geldt per app en niet voor alles: stond hier `external` voor beide, dan
  // zou één uitzondering de hele stand omgooien en was de lijst onbruikbaar.
  it('leaves the apps that are not on the list alone', () => {
    const prefs = { ...BASE, excluded: ['keep'] };
    expect(googleAppTarget('keep', prefs)).toBe('external');
    expect(googleAppTarget('drive', prefs)).toBe('in-app');
  });

  // Rangorde 1 — de kern van deze module. De uitzondering per app is specifieker dan
  // de algemene stand, dus hij wint. Zou `alwaysNewWindow` voorgaan, dan kwam een
  // app van de lijst alsnog in een venster van de app terecht en leek de lijst stuk:
  // bij `openInApp: true` (de standaard) zou er dan nooit iets naar de browser gaan.
  it('lets the per-app exception beat "always a new window"', () => {
    expect(googleAppTarget('keep', { openInApp: true, alwaysNewWindow: true, excluded: ['keep'] })).toBe(
      'external',
    );
  });

  // Rangorde 2 — een app die de app helemaal niet in mag, mag ook geen eigen venster
  // van ons krijgen. Zonder deze volgorde levert "niet in de app" plus "altijd nieuw
  // venster" een venster van de app op: precies wat de gebruiker uitzette.
  it('lets "not in the app" beat "always a new window"', () => {
    expect(googleAppTarget('drive', { openInApp: false, alwaysNewWindow: true, excluded: [] })).toBe(
      'external',
    );
  });

  // Alle drie tegelijk aan: één uitkomst, en het is dezelfde als bij elk van de twee
  // regels erboven. Zo staat vast dat er geen vierde stand bij komt als iemand later
  // een `if` verplaatst.
  it('still says browser when every reason to say so is set', () => {
    expect(
      googleAppTarget('keep', { openInApp: false, alwaysNewWindow: true, excluded: ['keep'] }),
    ).toBe('external');
  });
});

// De sleutels die de app kent. Kort en herkenbaar: de test gaat over het schonen,
// niet over welke apps er zijn.
const KNOWN = ['calendar', 'drive', 'docs', 'keep'];

describe('pinnedSurfaces', () => {
  it('keeps the known keys in the order given', () => {
    expect(pinnedSurfaces(['keep', 'calendar', 'docs'], KNOWN)).toEqual(['keep', 'calendar', 'docs']);
  });

  // De volgorde is die van de gebruiker en niet die van de app: hij bepaalt waar de
  // iconen in de balk staan. Alfabetisch of in de volgorde van `known` sorteren zou
  // die keuze bij elke herstart wissen.
  it('does not fall back to the order of the known list', () => {
    expect(pinnedSurfaces(['docs', 'calendar'], KNOWN)).toEqual(['docs', 'calendar']);
    expect(pinnedSurfaces(['calendar', 'docs'], KNOWN)).toEqual(['calendar', 'docs']);
  });

  // Waarom dit er is: het voorkeurenbestand overleeft de app-versie. Een sleutel van
  // een app die een latere versie niet meer heeft, laat de balk een icoon zoeken dat
  // er niet is — een lege knop, of een exception in de kaart met surfaces.
  it('drops keys the app does not know', () => {
    expect(pinnedSurfaces(['drive', 'tasks', 'photos'], KNOWN)).toEqual(['drive']);
    expect(pinnedSurfaces(['nope'], KNOWN)).toEqual([]);
  });

  // Dezelfde app twee keer in de balk is twee knoppen naar hetzelfde tabblad; de
  // tweede voegt niets toe behalve breedte. De eerste plek blijft staan, want dat is
  // waar de gebruiker hem neerzette.
  it('removes duplicates and keeps the first position', () => {
    expect(pinnedSurfaces(['drive', 'docs', 'drive'], KNOWN)).toEqual(['drive', 'docs']);
  });

  // Leeg is de standaard (niets vastgezet) en mag dus geen uitzondering zijn — en een
  // lege `known` hoort alles weg te gooien in plaats van alles door te laten, want
  // dan kent de app geen enkele app.
  it('handles empty input on either side', () => {
    expect(pinnedSurfaces([], KNOWN)).toEqual([]);
    expect(pinnedSurfaces(['drive'], [])).toEqual([]);
    expect(pinnedSurfaces([], [])).toEqual([]);
  });

  // Geeft een nieuwe lijst terug en raakt de opgeslagen lijst niet aan: de aanroeper
  // in main geeft hier zijn eigen `prefs.googleApps.pinned` in, en die mag niet
  // stiekem korter worden zonder dat er iets is geschreven.
  it('leaves the given list untouched', () => {
    const stored = ['drive', 'nope', 'drive'];
    expect(pinnedSurfaces(stored, KNOWN)).toEqual(['drive']);
    expect(stored).toEqual(['drive', 'nope', 'drive']);
  });
});
