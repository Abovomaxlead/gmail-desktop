import { APP_SURFACES, type Surface } from '../lib/surfaces';

// Wat er in het rechtsklikmenu van een tabblad komt. In de zijbalk stonden deze
// knoppen zichtbaar naast elk account; in de balk zou dat te vol worden.
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
