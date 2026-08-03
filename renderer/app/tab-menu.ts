import { APP_SURFACES, type Surface } from '../lib/surfaces';

// De rekenwerkjes van het rechtsklikmenu op een tabblad: wat erin komt, en waar
// het opengaat. Puur, zodat het te testen is zonder de balk te tekenen.
//
// Wat er in het menu komt. In de zijbalk stonden deze knoppen zichtbaar naast
// elk account; in de balk zou dat te vol worden.
//
// De renderer kent de AccountRef niet — main stuurt alleen `kind` en
// `hasCalendar` mee — dus dit werkt op die twee velden. De regels zijn dezelfde
// die de zijbalk inline gebruikte.
export interface TabMenuAccount {
  kind: 'authuser' | 'delegated';
  hasCalendar: boolean;
}

export function tabMenuSurfaces(p: TabMenuAccount): Surface[] {
  const out: Surface[] = [];
  // Agenda alleen als er een is: bij een gedelegeerd postvak hangt dat af van
  // wat Google's accountwisselaar heeft prijsgegeven.
  if (p.hasCalendar) out.push('calendar');
  // Drive, Docs en de rest bestaan alleen voor je eigen accounts; voor een
  // gedelegeerd postvak gooit het bouwen van die url's een fout.
  if (p.kind === 'authuser') out.push(...APP_SURFACES);
  // `mail` staat er bewust niet in: daarvoor klik je het tabblad zelf aan.
  return out;
}

// De breedte van het menu, hier in plaats van in een Tailwind-class: de
// plaatsing hieronder rekent ermee, en twee getallen die hetzelfde moeten zijn
// lopen uiteen zodra iemand er één aanpast.
export const TAB_MENU_WIDTH = 208;

// Marge tot de vensterrand, zodat het menu niet tegen de rand aan plakt.
const EDGE_MARGIN = 4;

// Waar het menu horizontaal begint. Een tabblad kan dicht bij de rechterrand
// staan — bij vier accounts is dat zelfs de normale plek — en een menu dat daar
// naar rechts opengaat valt half buiten het venster. Dan klapt het naar links
// open, met de cursor als rechterrand, zoals elk contextmenu doet.
export function tabMenuLeft(
  cursorX: number,
  viewportWidth: number,
  width = TAB_MENU_WIDTH,
  margin = EDGE_MARGIN,
): number {
  if (cursorX + width + margin <= viewportWidth) return cursorX;
  const flipped = cursorX - width;
  if (flipped >= margin) return flipped;
  // Geen ruimte aan beide kanten: het venster is smaller dan het menu. Tegen de
  // linkerrand aan is dan het minst erge — daar is de kop nog leesbaar.
  return Math.max(margin, viewportWidth - width - margin);
}
