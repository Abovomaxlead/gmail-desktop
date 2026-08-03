// Welke accounts hun Gmail-koppeling kwijt zijn, en hoe groot de melding daarover
// moet zijn. Losse, testbare stukjes; het echte controleren (een verversing
// proberen) staat in main omdat daar het netwerk zit.

// Waarom een account opnieuw verbonden moet worden. De melding zegt niet
// hetzelfde in beide gevallen, en dat is de hele reden dat dit onderscheid
// bestaat: bij 'expired' is de koppeling écht weg en werkt het verplaatsen van
// mail niet meer, bij 'push' werkt alles behalve de meldingen. Die twee door
// elkaar halen levert een blijvende melding op die iets beweert wat niet waar is.
export type ReconnectReason = 'expired' | 'push';

export interface ReconnectAccount {
  email: string;
  reason: ReconnectReason;
}

export interface HealthInput {
  // Alleen eigen accounts: een delegated mailbox is iemand anders' postvak en
  // heeft geen eigen koppeling nodig.
  ownEmails: string[];
  hasToken: (email: string) => boolean;
  refreshFailed: (email: string) => boolean;
  // Staat push niet ingesteld (geen relayUrl/pushTopic), dan is er geen enkel
  // push-probleem dat de gebruiker kan of hoeft op te lossen. Zonder deze
  // schakelaar kreeg élke machine na de update een blijvende melding, want elk
  // bestaand token is ouder dan de scope die alleen push nodig heeft.
  pushConfigured: boolean;
  // Het token bestaat en werkt, maar is gemaakt voordat er een scope bijkwam.
  // Een verversing levert die scope niet op — daarvoor moet de gebruiker
  // opnieuw toestemming geven.
  missingScopes: (email: string) => boolean;
  // De relay heeft dit token definitief geweigerd (4401, ook na een verse
  // verversing). Push staat daarmee uit tot er nieuwe toestemming is, en zonder
  // deze reden zou niets dat vertellen.
  pushRefused: (email: string) => boolean;
}

// Een account moet opnieuw verbonden worden als het geen token heeft of het
// verversen ervan is mislukt (in testmodus vervalt een refresh token na zeven
// dagen) — en, alleen als push is ingesteld, ook als het token een scope mist die
// push nodig heeft of de relay het definitief heeft geweigerd.
//
// De reden die het zwaarst weegt wint: een account zonder werkend token is een
// groter probleem dan een account waarvan alleen de meldingen stilstaan.
export function accountsNeedingReconnect(input: HealthInput): ReconnectAccount[] {
  const out: ReconnectAccount[] = [];
  for (const email of input.ownEmails) {
    if (!input.hasToken(email) || input.refreshFailed(email)) {
      out.push({ email, reason: 'expired' });
    } else if (input.pushConfigured && (input.missingScopes(email) || input.pushRefused(email))) {
      out.push({ email, reason: 'push' });
    }
  }
  return out;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const WIDTH = 380;
const HEADER = 62;
const ROW = 46;
const PADDING = 14;
const MARGIN = 16;

// Rechtsonder, precies zo groot als de melding zelf. Zo blijft de rest van Gmail
// bruikbaar: een view over het hele venster zou alle klikken opvangen.
export function bannerBounds(win: { width: number; height: number }, rows: number): Rect {
  const width = Math.min(WIDTH, Math.max(240, win.width - MARGIN * 2));
  const wanted = HEADER + Math.max(1, rows) * ROW + PADDING;
  const height = Math.min(wanted, Math.max(120, Math.round(win.height * 0.6)));
  return {
    x: Math.max(0, win.width - width - MARGIN),
    y: Math.max(0, win.height - height - MARGIN),
    width,
    height,
  };
}
