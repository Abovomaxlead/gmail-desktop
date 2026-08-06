// The language the interface speaks. 'system' asks Windows, via app.getLocale() at the
// call site, so this stays a pure function. Only Dutch and English exist; anything else
// Windows reports lands on English. The tag is matched on its language subtag alone, so
// nl, nl-NL and nl-BE all count as Dutch while nld does not.

export type LanguagePref = 'system' | 'en' | 'nl';
export type Locale = 'en' | 'nl';

export function resolveLocale(pref: LanguagePref, systemLocale: string): Locale {
  if (pref === 'en' || pref === 'nl') return pref;
  if (typeof systemLocale !== 'string') return 'en';
  return systemLocale.toLowerCase().split('-')[0] === 'nl' ? 'nl' : 'en';
}
