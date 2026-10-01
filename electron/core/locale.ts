// The language the interface speaks. 'system' asks Windows, via app.getLocale() at the
// call site, so this stays a pure function. Only Dutch and English exist; anything else
// Windows reports lands on English. The tag is matched on its language subtag alone, so
// nl, nl-NL and nl-BE all count as Dutch while nld does not.

export type LanguagePref = 'system' | 'en' | 'nl';
export type Locale = 'en' | 'nl';

/**
 * Resolves the stored preference against the OS locale
 *
 * @param pref
 * @param systemLocale BCP 47 tag, as app.getLocale() reports it
 * @returns the locale the interface renders in
 */
export function resolveLocale(pref: LanguagePref, systemLocale: string): Locale {
  if (pref === 'en' || pref === 'nl') return pref;
  if (typeof systemLocale !== 'string') return 'en';
  return systemLocale.toLowerCase().split('-')[0] === 'nl' ? 'nl' : 'en';
}

/**
 * Picks the label set for a locale, with Rene mode taking precedence over the locale
 *
 * @param locale
 * @param reneMode
 * @param variants
 * @returns the variant every label set must agree on
 */
export function pickVariant<T>(
  locale: Locale,
  reneMode: boolean,
  variants: { en: T; nl: T; rene: T },
): T {
  if (reneMode) return variants.rene;
  return locale === 'nl' ? variants.nl : variants.en;
}
