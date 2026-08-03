// Welke accounts hun Gmail-koppeling kwijt zijn, en hoe groot de melding daarover
// moet zijn. Losse, testbare stukjes; het echte controleren (een verversing
// proberen) staat in main omdat daar het netwerk zit.

export interface HealthInput {
  // Alleen eigen accounts: een delegated mailbox is iemand anders' postvak en
  // heeft geen eigen koppeling nodig.
  ownEmails: string[];
  hasToken: (email: string) => boolean;
  refreshFailed: (email: string) => boolean;
  // Het token bestaat en werkt, maar is gemaakt voordat er een scope bijkwam.
  // Een verversing levert die scope niet op — daarvoor moet de gebruiker
  // opnieuw toestemming geven.
  missingScopes: (email: string) => boolean;
}

// Een account moet opnieuw verbonden worden als het geen token heeft, als het
// verversen ervan is mislukt (in testmodus vervalt een refresh token na zeven
// dagen), of als het token een scope mist die we sindsdien nodig hebben.
export function accountsNeedingReconnect(input: HealthInput): string[] {
  return input.ownEmails.filter(
    (e) => !input.hasToken(e) || input.refreshFailed(e) || input.missingScopes(e),
  );
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
