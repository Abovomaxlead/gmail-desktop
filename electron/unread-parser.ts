// Gmail zet de ongelezen-teller tussen haakjes in de paginatitel, geschreven in
// de taal van de gebruiker. Vanaf duizend groepeert die de duizendtallen, en het
// scheidingsteken verschilt per locale: "(1.324)" in het Nederlands, "(1,324)"
// in het Engels, "(1 324)" in het Frans of Russisch (een vaste of smalle spatie),
// "(1'324)" in het Zwitsers-Duits.
//
// Daarom worden hier twee vormen herkend: een reeks cijfers zonder meer, of
// groepen van precies drie cijfers achter een scheidingsteken. Die eis van drie
// is er met opzet — hij houdt "(1.5)" buiten de deur, dat anders als 15 gelezen
// zou worden en een verzonnen teller op de badge zou zetten.
//
// Punt en komma staan er allebei in, en welke van de twee het duizendtal scheidt
// verschilt per taal. Onderscheiden hoeft niet: bij een groep van drie cijfers
// is het hoe dan ook een scheidingsteken en nooit een decimaal, want een
// ongelezen-teller is een geheel getal.
const GROUP_SEP = "[.,\\u0020\\u00A0\\u202F\\u2009'\\u2019]";
const COUNT = new RegExp(`\\((\\d{1,3}(?:${GROUP_SEP}\\d{3})+|\\d+)\\)`);
const SEPS = new RegExp(GROUP_SEP, 'g');

export function parseUnreadCount(title: string | null | undefined): number {
  if (!title) return 0;
  const match = title.match(COUNT);
  if (!match) return 0;
  // De scheidingstekens eruit: alleen de cijfers vormen het getal.
  const n = parseInt(match[1].replace(SEPS, ''), 10);
  return Number.isFinite(n) ? n : 0;
}
