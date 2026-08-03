import type { HistoryMessage } from './gmail-api';

// Gmail's tabbladen. Een nieuwsbrief onder Reclame of een melding van een sociaal
// netwerk is geen mail waarvoor je je werk onderbreekt. De andere categorieën
// (PERSONAL, UPDATES, FORUMS) melden wel: daar zit echte post tussen.
export const SKIP_LABELS = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL'];

// Welke van de toegevoegde berichten een melding verdienen. Ontdubbeld, want
// hetzelfde bericht kan in meerdere history-records opduiken, en in de volgorde
// die Gmail geeft, zodat de meldingen op tijd van aankomst binnenkomen.
export function notifiableIds(added: HistoryMessage[]): string[] {
  const out: string[] = [];
  for (const message of added) {
    if (!message.labelIds.includes('INBOX')) continue;
    if (message.labelIds.some((l) => SKIP_LABELS.includes(l))) continue;
    if (!out.includes(message.id)) out.push(message.id);
  }
  return out;
}

// De hele meldingsregel van het ontwerp, op één plek:
//
//   Meld alleen mail die binnenkwam terwijl dit account door push gedekt was.
//
// Dat dekt drie gevallen met één vergelijking. Bij het opstarten begint de
// dekking pas als de eerste watch lukt, dus de achterstand zwijgt. Na een korte
// breuk is de mail nieuwer dan dat moment en meldt hij gewoon — precies waar de
// catch-up voor is. En na een teruggave en overname schuift het moment mee, dus
// het storingsvenster zwijgt: de webview heeft die mail toen al gemeld.
export function shouldNotify(internalDate: number, coveredSince: number | null): boolean {
  if (coveredSince === null) return false;
  return internalDate >= coveredSince;
}
