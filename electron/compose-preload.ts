// De preload van een opstelvenster, en niets meer dan dat.
//
// Een eigen, minimale preload en niet die van de mailweergave. Dat is geen
// netheid: `preload.ts` telt ongelezen post, vangt Gmail's meldingen af, hangt de
// dropzone op en herschrijft `window.open`. In een opstelvenster is dat allemaal
// verkeerd — het zou de teller van het account overschrijven met wat een leeg
// opstelvenster in zijn paginatitel heeft staan.
//
// Het enige dat hier gebeurt: kijken of er op Verzenden is gedrukt, en dat melden.
// Sluiten doet main, want een venster hoort zichzelf niet op te ruimen terwijl de
// pagina er nog in bezig is.
import { IPC } from './ipc';

// Waaraan Gmail's Verzenden-knop te herkennen is.
//
// `[data-tooltip*="Send"]` en de `aria-label`-varianten zijn de haken die Gmail zelf
// op die knop zet. Ze zijn taalafhankelijk — in een Nederlandse Gmail staat er
// "Verzenden" — dus staan beide woorden erin. `[role=button][id$=":s"]` is Gmail's
// eigen id-achtervoegsel voor de verzendknop in een opstelvenster en werkt in elke
// taal; die staat vooraan omdat hij het minst afhangt van wat er op de knop staat.
//
// Vindt hij de knop niet, dan gebeurt er niets: de mail gaat gewoon weg en het
// venster blijft staan. Dat is de goede kant om in om te vallen — de instelling werkt
// dan stil niet, in plaats van dat verzenden kapot is.
export const SEND_BUTTON_SELECTOR = [
  '[role="button"][id$=":s"]',
  '[data-tooltip^="Send"]',
  '[data-tooltip^="Verzenden"]',
  '[aria-label^="Send"]',
  '[aria-label^="Verzenden"]',
].join(', ');

/** Is er op Verzenden geklikt? Loopt omhoog, want de klik landt in de knop. */
export function isSendClick(
  target: { closest?: (selector: string) => unknown } | null | undefined,
): boolean {
  if (!target || typeof target.closest !== 'function') return false;
  return target.closest(SEND_BUTTON_SELECTOR) != null;
}

// Alleen in een echt venster. Zo blijft dit bestand importeerbaar onder Node, en kan
// `isSendClick` getest worden zonder een pagina.
if (typeof document !== 'undefined') {
  const { ipcRenderer } = require('electron') as typeof import('electron');
  // In de bubbelfase en niet in capture: Gmail moet de klik éérst gewoon krijgen,
  // anders is de mail niet verzonden op het moment dat wij het venster laten sluiten.
  // Er wordt hier dus niets tegengehouden — alleen meegekeken.
  document.addEventListener('click', (e) => {
    const target = e.target as (Element & { closest?: (s: string) => Element | null }) | null;
    if (isSendClick(target)) ipcRenderer.send(IPC.COMPOSE_SENT);
  });
}
