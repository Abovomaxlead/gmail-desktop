// Of er iets gevraagd moet worden voordat een link naar de browser gaat, en waar
// die link dan naartoe wil. Puur: geen Electron, geen dialoog — main hangt de
// vraag eraan. Zo is de beslissing te testen zonder een venster.
//
// Dit is de "Phishing Protection"-tab. Wat het wél doet: je een keer laten kijken
// naar de host waar je heen gestuurd wordt, voordat je browser hem opent. Wat het
// niet doet: bepalen of die host kwaadaardig is. Er zit geen lijst achter en er
// wordt niets opgezocht — de gebruiker is degene die de host leest en beslist.
// Daarom is het ook geen belofte die verkeerd kan uitpakken: het voegt een blik
// toe, geen oordeel.

/** De hostnaam uit een URL, in kleine letters. `null` als het geen URL is. */
export function hostOf(url: string): string | null {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h || null;
  } catch {
    return null;
  }
}

// Een vertrouwde host dekt ook zijn subdomeinen: zet je "abovomaxlead.nl" op de
// lijst, dan is "mail.abovomaxlead.nl" het ook. Andersom niet — "example.com" op de
// lijst maakt "example.com.phish.test" niet vertrouwd, want die eindigt niet op
// ".example.com" maar bevat het alleen. Dat onderscheid is het hele punt van deze
// vergelijking, en de reden dat het geen `includes` is.
export function isTrustedHost(host: string, trusted: readonly string[]): boolean {
  const h = host.toLowerCase();
  return trusted.some((t) => {
    const entry = t.trim().toLowerCase().replace(/^\.+/, '');
    if (!entry) return false;
    return h === entry || h.endsWith(`.${entry}`);
  });
}

export interface LinkGuardState {
  confirmExternalLinks: boolean;
  trustedHosts: readonly string[];
}

/**
 * Moet er eerst iets gevraagd worden voor deze link?
 *
 * Nee als de bescherming uit staat, als de host op de vertrouwde lijst staat, of
 * als er geen host uit de URL te halen valt — dat laatste omdat een `mailto:` of
 * een pad geen bestemming heeft om te laten zien, en een vraag zonder antwoord
 * erin alleen maar in de weg staat.
 */
export function needsLinkConfirm(url: string, state: LinkGuardState): boolean {
  if (!state.confirmExternalLinks) return false;
  const host = hostOf(url);
  if (!host) return false;
  return !isTrustedHost(host, state.trustedHosts);
}
