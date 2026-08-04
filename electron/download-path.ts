// Waar een download terechtkomt, als naam. Puur: het bestandssysteem komt binnen
// als één functie ("bestaat dit pad?"), zodat dit zonder schijf te testen is.

/** Splits "rapport.tar.gz" in "rapport" en ".tar.gz" — de dubbele extensie blijft heel. */
export function splitName(name: string): { base: string; ext: string } {
  // Een naam die met een punt begint is een naam en geen extensie (".gitignore"),
  // dus de zoektocht naar de punt begint op teken 1.
  const dot = name.indexOf('.', 1);
  if (dot <= 0) return { base: name, ext: '' };
  // Bekende dubbele extensies horen bij elkaar: "archief.tar.gz (1)" is te lezen,
  // "archief.tar (1).gz" niet — en die tweede zou het bestand ook nog van type
  // veranderen in de ogen van Windows.
  const lower = name.toLowerCase();
  for (const combo of ['.tar.gz', '.tar.bz2', '.tar.xz', '.tar.zst']) {
    if (lower.endsWith(combo)) return { base: name.slice(0, -combo.length), ext: name.slice(-combo.length) };
  }
  const last = name.lastIndexOf('.');
  if (last <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, last), ext: name.slice(last) };
}

/**
 * Een naam die in deze map nog niet bestaat: "rapport.pdf", anders
 * "rapport (1).pdf", enzovoort. Dezelfde vorm die Windows en Chrome gebruiken,
 * zodat een tweede download van hetzelfde bestand niet stil de eerste overschrijft.
 *
 * `exists` krijgt de volledige naam (zonder map) en zegt of die er al is. De
 * teller stopt bij 999: is het daarna nog bezet, dan is er iets anders aan de hand
 * dan een dubbele download, en dan is teruggeven wat we hebben beter dan blijven
 * doorzoeken.
 */
export function uniqueFileName(name: string, exists: (candidate: string) => boolean): string {
  const safe = name.trim() || 'download';
  if (!exists(safe)) return safe;
  const { base, ext } = splitName(safe);
  for (let i = 1; i <= 999; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!exists(candidate)) return candidate;
  }
  return safe;
}
