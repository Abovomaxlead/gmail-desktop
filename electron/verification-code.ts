// Het vinden van een verificatiecode in één bericht. Puur: geen electron, geen
// DOM, geen netwerk, geen klok en geen willekeur — dezelfde mail levert altijd
// hetzelfde antwoord. Dat is geen netheid maar een eis: hierachter hangt een
// instelling die de mail wéggooit nadat de code is gekopieerd, en iets dat
// onomkeerbaar is moet reproduceerbaar zijn. Een fout die je niet kan naspelen
// kan je ook niet repareren.
//
// De hele module kiest precisie boven volledigheid. Een code die we missen kost
// de gebruiker één keer overtypen; een getal dat we ten onrechte voor een code
// aanzien kost hem een echte mail — een factuur, een boekingsbevestiging, een
// bericht van school. Daarom staat er hieronder meer code die dingen wégstuurt
// dan code die dingen aanwijst, en daarom mag elke twijfel "nee" betekenen.
//
// De opbouw, in de volgorde waarin een bericht er doorheen gaat:
//   1. normaliseren  — HTML eruit, entiteiten terug, witruimte plat;
//   2. ruis blanken   — url's, adressen, bedragen, datums, telefoonnummers…
//                       worden vervangen door evenveel spaties, zodat elke
//                       positie in de tekst blijft kloppen;
//   3. trefwoorden    — waar staat de bedoeling ("verificatiecode") opgeschreven;
//   4. kandidaten     — welke stukjes tekst hébben de vorm van een code;
//   5. kiezen         — het hardste bewijs, en bij gelijk bewijs de eerste.

import type { CodeConfidence } from './prefs-store';

// Wat één vondst is. `confidence` is niet de instelling maar de hardheid van het
// bewijs: 'high' betekent "er staat een trefwoord bij", 'medium' betekent "alleen
// de vorm van het getal pleit ervoor". De instelling bepaalt welke hardheid nog
// meegaat; zie `accepts` in `findVerificationCode`.
export interface CodeCandidate {
  code: string;
  confidence: CodeConfidence;
}

// Intern houden we er ook bij waar de kandidaat stond en of er letters in zaten:
// de plek beslist wie er bij gelijk bewijs wint, en letters mogen alleen in de
// strenge stand.
interface ScoredCandidate extends CodeCandidate {
  index: number;
  alnum: boolean;
}

interface Span {
  start: number;
  end: number;
}

// Vier is de kortste code die diensten sturen (pinachtige codes van banken), acht
// de langste die nog een code is. Alles daarboven is in de praktijk een
// ordernummer, een klantnummer of een bedrag zonder scheidingsteken.
const MIN_LENGTH = 4;
const MAX_LENGTH = 8;

// Hoeveel tekens er tussen het trefwoord en de code mogen zitten. Ruim genoeg
// voor "Uw verificatiecode voor Gmail Desktop is 483920" en te krap voor een
// getal dat drie zinnen verderop in dezelfde alinea staat. Geldt naar beide
// kanten: "483920 is je verificatiecode" komt net zo vaak voor als het omgekeerde.
const KEYWORD_WINDOW = 60;

// Hoe ver we vóór de kandidaat naar een tégenwoord kijken. Korter dan het venster
// hierboven, want een tegenwoord is altijd een label dat direct aan zijn nummer
// vastzit ("Factuurnummer 483920").
const NEGATIVE_WINDOW = 40;

// De bedoeling, opgeschreven. Zonder één van deze woorden bestaat er in de strenge
// stand geen code — dit is de kern van "high".
//
// De rekbare stukjes (`\s*`) zijn er omdat dezelfde dienst het los, vast of met
// een streepje schrijft: "verificatie code", "verificatiecode". Een trefwoord
// toevoegen is één regel; dat is met opzet de goedkoopste ingreep in dit bestand.
//
// "one-time" staat er niet los in maar altijd met zijn zelfstandig naamwoord
// erachter. "One-time offer — bestel nu, 20% korting" is een reclamemail, en die
// zou met het losse woord een getal in de buurt tot code promoveren.
const KEYWORD_SOURCE = [
  'verification\\s*code',
  'security\\s*code',
  'confirmation\\s*code',
  'authentication\\s*code',
  'pass\\s*code',
  'one[\\s-]*time\\s+(?:code|password|passcode|pin)',
  '\\botp\\b',
  '\\b2fa\\b',
  'two[\\s-]*factor',
  'verificatie\\s*code',
  'beveiligings?\\s*code',
  'eenmalige\\s*code',
  'bevestigings?\\s*code',
  'inlog\\s*code',
].join('|');

// Woorden die vlak vóór een getal staan en zeggen dat het géén code is. Dit is de
// vangnet-laag onder het blanken: een factuurnummer van zes cijfers heeft precies
// de vorm van een code, dus alleen zijn label verraadt hem. Zonder deze lijst zou
// "Uw verificatiecode volgt. Trackingnummer 3SABCD123456" het trackingnummer
// kunnen opleveren omdat het binnen het venster van het trefwoord valt.
const NEGATIVE_SOURCE = [
  'factuur\\w*',
  'invoice',
  'order\\s*(?:nummer|number|nr)',
  'ordernummer',
  'klant\\s*nummer|klantnummer',
  'customer\\s*(?:number|id)',
  'rekening\\s*nummer|rekeningnummer',
  'account\\s*number',
  'referentie\\w*',
  'reference',
  'tracking\\w*',
  'track\\s*&\\s*trace',
  'zending\\w*',
  'pakket',
  'ticket\\w*',
  'polis\\w*',
  'lidnummer',
  '\\biban\\b',
  '\\bbsn\\b',
  '\\bkvk\\b',
  '\\bbtw\\b',
  '\\bvat\\b',
  'bedrag',
  'amount',
  'totaal',
  '\\btotal\\b',
  'postcode',
  'telefoon\\w*',
  '\\bphone\\b',
].join('|');

// Losser dan de trefwoorden hierboven: dit zijn de woorden die een onderwerp
// *verdenken* in plaats van bewijzen. Alleen voor `subjectSuggestsCode`, zie de
// uitleg daar.
const HINT_SOURCE = [
  '\\bcodes?\\b',
  '\\bpin\\b',
  'verif\\w*',
  'bevestig\\w*',
  'confirm\\w*',
  'authenticat\\w*',
  'aanmeld\\w*',
  'inlog\\w*',
  'log\\s*in',
  'sign\\s*in',
  'security',
  'beveilig\\w*',
  'eenmalig\\w*',
  '\\b2fa\\b',
  '\\botp\\b',
  'two[\\s-]*factor',
].join('|');

// Een jaartal. Vier cijfers tussen 1900 en 2099 zijn in een mail bijna altijd een
// jaar in een voettekst ("© 2026") of in een datum die het blanken hierboven niet
// als datum herkende.
const YEAR = /^(?:19|20)\d{2}$/;

// Een getal met een eenheid eraan vast. Deze staan er alleen voor de stand die ook
// letters toestaat: "100MB" en "1080P" zijn daar anders geldige kandidaten.
const UNIT = /^\d{1,4}(?:KB|MB|GB|TB|PX|PT|AM|PM|EUR|USD|GBP)$/;

// Een kandidaat mag hier niet direct naast staan. `_` maakt van een getal een
// bestandsnaam of een sleutel (`bestand_483920_v2`), en de rest is geld, een
// percentage, een graad of een nummerteken. Het blanken haalt de meeste hiervan al
// weg; dit is de tweede rij, voor de vorm die één regex miste.
const FORBIDDEN_BEFORE = '_#$€£¥+';
const FORBIDDEN_AFTER = '_%°';

// Tags die midden in een woord kunnen staan. Een HTML-mail zet een code soms in
// stukken (`<b>48</b><b>3920</b>`, of een letterspatiëring per teken); staat zo'n
// tag tússen twee cijfers, dan hoort daar geen woordgrens en plakken de cijfers
// aan elkaar. Buiten die ene plek wordt elke tag gewoon een spatie — een tag is
// normaal wél een grens.
const INLINE_TAG = 'b|strong|i|em|u|span|font|small|big|sub|sup|wbr|mark|tt|code';
const DIGIT_GLUE = new RegExp(`(?<=\\d)(?:</?(?:${INLINE_TAG})\\b[^>]*>)+(?=\\d)`, 'gi');

// Ruis. Elk patroon hier wordt vervangen door evenveel spaties: de tekst houdt zijn
// lengte, dus de plaats van een trefwoord en de plaats van een kandidaat blijven
// vergelijkbaar. Zou ik de ruis wegknippen, dan zou het venster van 60 tekens over
// een tekst rekenen die de gebruiker nooit gezien heeft.
//
// De volgorde is niet vrij: het langste patroon moet eerst. `1234567890` mag geen
// datum worden voordat de "negen cijfers of meer"-regel hem gezien heeft, en een
// url moet weg vóórdat zijn querystring als losse getallen achterblijft.
const NOISE: readonly RegExp[] = [
  // Url's. Een code in een link is geen code om te kopiëren maar een parameter,
  // en juist die staat er vaak in ("?code=483920") — precies de vorm die we
  // zoeken, precies de plek waar hij niks betekent.
  /(?:https?:\/\/|mailto:|www\.)\S+/gi,
  // Mailadressen. Cijfers in een adres zijn deel van een naam of een domein.
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  // Alles achter een `#`: een kleurcode (`#a3f9c2`) of een nummerteken
  // ("Order #123456"). Beide zijn nooit een verificatiecode.
  /#[A-Za-z0-9]{3,8}\b/g,
  /\b0x[A-Fa-f0-9]+\b/gi,
  // Geld. Zowel het teken vóór het getal als de code erachter, en het Nederlandse
  // "12,-".
  /[€$£¥]\s*\d[\d.,]*/g,
  /\b\d[\d.,]*\s*(?:eur|usd|gbp|euro'?s?|dollars?|cent)\b/gi,
  /\b\d[\d.,]*\s*,-/g,
  // Percentages.
  /\b\d[\d.,]*\s*%/g,
  // Telefoonnummers. Internationaal (met + of 00) en Nederlands met
  // scheidingstekens. De nationale patronen eisen tien cijfers, dus ze kunnen
  // nooit een code van vier tot acht opeten.
  /(?:\+|\b00)\d[\d\s().-]{5,}\d/g,
  /\(\d{2,4}\)\s*[\d\s.-]{5,}\d/g,
  /\b0\d[\s.-]?\d{4}[\s.-]?\d{4}\b/g,
  /\b0\d{2}[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
  /\b0\d{3}[\s.-]?\d{3}[\s.-]?\d{3}\b/g,
  // Twee of meer cijfergroepen met een scheidingsteken ertussen. Dit ene patroon
  // dekt datums (12-03-2022, 03/12/2022, 2022-03-12), tijden (14:30:00),
  // versienummers (1.2.3), duizendtallen (1.234), decimalen (12,50), ip-adressen
  // en met streepjes geschreven telefoonnummers. Een code staat in één stuk; twee
  // groepen met iets ertussen is iets anders.
  /\d+(?:[.,:/\-\u2013]\d+)+/g,
  // Duizendtallen met spaties: "1 234 567".
  /\b\d{1,3}(?:\s\d{3})+\b/g,
  // Negen cijfers of meer, samen met de letters die eraan vastzitten. Dat laatste
  // is bewust: een trackingnummer (`3SABCD1234567890`) of een IBAN
  // (`NL91ABNA0417164300`) zou anders als brokstuk (`3SABCD`, `NL91ABNA`)
  // achterblijven, en dat brokstuk heeft de vorm van een lettercode.
  /[A-Za-z0-9]*\d{9,}[A-Za-z0-9]*/g,
];

const blanks = (m: string): string => ' '.repeat(m.length);

function looksLikeHtml(text: string): boolean {
  return /<\/?(?:html|body|head|div|table|tbody|tr|td|th|p|br|span|a|img|style|script|meta|font|center|b|strong|i|em|ul|ol|li|h[1-6])\b[^>]*>/i.test(
    text,
  );
}

// Entiteiten terug naar tekens. `&amp;` als laatste, anders wordt `&amp;lt;`
// eerst `&lt;` en dan `<` — en dat stond er niet.
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

// HTML eruit. Moet gebeuren voordat er iets gezocht wordt: in een HTML-mail zit de
// code tussen de opmaak (`<td ...><b>483920</b></td>`) en zit de opmaak vol met
// getallen die er precies zo uitzien (`width="600"`, `bgcolor="#f5f5f5"`,
// `font-size:12px`, een tijdstempel in een tracking-pixel). Zoek je zonder te
// strippen, dan concurreert de vormgeving van de mail met zijn inhoud — en de
// vormgeving staat bovenaan.
//
// `script` en `style` gaan met inhoud en al weg: daar staat per definitie geen
// tekst voor de lezer in, maar wel cijfers.
function stripHtml(text: string): string {
  return text
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(DIGIT_GLUE, '')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<\/(?:p|div|tr|td|table|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
}

// Witruimte plat. Eén spatie voor elke reeks, want het venster van 60 tekens moet
// over leesbare tekst rekenen en niet over de honderdvijftig spaties en
// regeleindes die een HTML-mail tussen twee tabelcellen zet.
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clean(text: string): string {
  const withoutTags = looksLikeHtml(text) ? stripHtml(text) : text;
  return flatten(decodeEntities(withoutTags));
}

// Onderwerp en tekst achter elkaar, met één regeleinde ertussen. Dat regeleinde is
// de grens: alles vóór `subjectEnd` stond in het onderwerp. Ze staan in één tekst
// omdat het onderwerp en de eerste regel van een bericht in de praktijk één zin
// vormen ("Onderwerp: uw verificatiecode" + "483920"), en het venster van 60 tekens
// hoort daar dan overheen te kunnen kijken.
function haystack(input: { subject: string; body: string }): { text: string; subjectEnd: number } {
  const subject = clean(input.subject ?? '');
  const body = clean(input.body ?? '');
  return { text: `${subject}\n${body}`, subjectEnd: subject.length };
}

function blankNoise(text: string): string {
  let out = text;
  for (const pattern of NOISE) out = out.replace(pattern, blanks);
  return out;
}

function keywordSpans(text: string): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(new RegExp(KEYWORD_SOURCE, 'gi'))) {
    if (m.index === undefined) continue;
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

function gap(span: Span, start: number, end: number): number {
  if (start >= span.end) return start - span.end;
  if (end <= span.start) return span.start - end;
  return 0;
}

// Geen letter of cijfer ernaast — dat kan niet, want een kandidaat is een hele
// reeks letters en cijfers — maar wel geen teken dat er een ander soort getal van
// maakt.
function boundaryOk(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : '';
  const after = end < text.length ? text[end] : '';
  if (before && FORBIDDEN_BEFORE.includes(before)) return false;
  if (after && FORBIDDEN_AFTER.includes(after)) return false;
  return true;
}

function negativeNear(text: string, start: number): boolean {
  const before = text.slice(Math.max(0, start - NEGATIVE_WINDOW), start);
  return new RegExp(NEGATIVE_SOURCE, 'i').test(before);
}

// Alles wat de vorm van een code heeft, in de volgorde waarin het in de tekst
// staat. Wat hier uit komt is nog niet geaccepteerd: `findVerificationCode`
// beslist welke hardheid van bewijs bij de gekozen stand hoort.
function collect(text: string, subjectEnd: number, keywords: Span[]): ScoredCandidate[] {
  const out: ScoredCandidate[] = [];
  for (const m of text.matchAll(/[A-Za-z0-9]+/g)) {
    const token = m[0];
    const start = m.index;
    if (start === undefined) continue;
    const end = start + token.length;
    if (token.length < MIN_LENGTH || token.length > MAX_LENGTH) continue;

    const digitsOnly = /^\d+$/.test(token);
    // Alleen hoofdletters, en er moet én een letter én een cijfer in zitten.
    // Kleine letters horen bij gewone tekst, en een reeks zonder cijfer is een
    // woord ("PLEASE", "GMAIL").
    const alnum = !digitsOnly && /^(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]+$/.test(token);
    if (!digitsOnly && !alnum) continue;
    if (alnum && UNIT.test(token)) continue;
    if (!boundaryOk(text, start, end)) continue;
    if (negativeNear(text, start)) continue;

    const adjacent = keywords.some((k) => gap(k, start, end) <= KEYWORD_WINDOW);
    // Een code in het onderwerp mag ook zonder trefwoord ernáást, zolang de mail
    // ergens wél zegt dat het om een code gaat: "Actie vereist: 194837" met
    // "vul de verificatiecode in" in de tekst is één bericht met één bedoeling.
    const backed = adjacent || (start < subjectEnd && keywords.length > 0);
    // Letters alleen als een trefwoord het dekt. Een losse `ABC123` is te vaak een
    // productcode, een zaalnummer of een couponcode.
    if (alnum && !backed) continue;
    // Een jaartal alleen als het trefwoord er pal naast staat. "Uw verificatiecode
    // is 2024" mag; "© 2024" in een voettekst van een mail die verderop over een
    // code gaat, mag niet.
    if (YEAR.test(token) && !adjacent) continue;

    out.push({ code: token, confidence: backed ? 'high' : 'medium', index: start, alnum });
  }
  return out;
}

/**
 * De code uit een bericht, of `null`. `confidence` is de instelling van de
 * gebruiker, niet een uitkomst.
 *
 * - `'high'`: er moet een trefwoord in het bericht staan, en de code moet daar
 *   binnen 60 tekens van staan of in het onderwerp. Cijfers en hoofdlettercodes.
 * - `'medium'`: hetzelfde, plus een losstaande groep van vier tot acht cijfers
 *   zónder trefwoord. Alleen cijfers — letters toestaan in een stand die al geen
 *   trefwoord eist zou van elke productcode een kandidaat maken.
 *
 * `from` wordt niet doorzocht. Een afzenderadres bestaat uit een naam en een
 * domein, en dat is precies de vorm die we elders wegblanken; er staat nooit een
 * code in. Het veld staat in de invoer omdat de aanroeper het toch al heeft en
 * een latere lijst met vertrouwde afzenders hier hoort te wonen.
 */
export function findVerificationCode(
  input: { subject: string; body: string; from?: string },
  confidence: CodeConfidence,
): string | null {
  const { text, subjectEnd } = haystack(input);
  const scanned = blankNoise(text);
  const candidates = collect(scanned, subjectEnd, keywordSpans(scanned));

  const accepts = (c: ScoredCandidate): boolean =>
    c.alnum ? confidence === 'high' && c.confidence === 'high' : c.confidence === 'high' || confidence === 'medium';

  // Eerst het harde bewijs, en daarbinnen de eerste. Twee doorlopen in plaats van
  // sorteren: sorteren op een gelijke sleutel is niet gegarandeerd stabiel, en
  // deze functie moet bij dezelfde mail altijd hetzelfde antwoord geven.
  for (const c of candidates) if (c.confidence === 'high' && accepts(c)) return c.code;
  for (const c of candidates) if (accepts(c)) return c.code;
  return null;
}

/**
 * Of dit onderwerp er überhaupt uitziet als een mail met een code, zodat de
 * aanroeper de volledige tekst niet hoeft op te halen als het antwoord nee is.
 *
 * Dit is met opzet ruimer dan `findVerificationCode`: een poortje dat te streng is
 * gooit post weg die de detector wél had willen bekijken, en dan is er niets meer
 * dat dat kan herstellen. Daarom tellen hier ook zwakke aanwijzingen mee
 * ("verify", "inloggen", "code") en een code-vormige groep cijfers in het
 * onderwerp zelf.
 *
 * Let op wat dat betekent voor de losse stand: een mail met een code in de tekst
 * en een onderwerp dat nergens naar hint, komt achter dit poortje niet meer langs
 * de detector. Dat is de prijs van niet elke mail volledig ophalen, en hij hoort
 * bij de aanroeper te liggen — niet hier.
 */
export function subjectSuggestsCode(subject: string): boolean {
  const text = clean(subject ?? '');
  if (!text) return false;
  if (new RegExp(KEYWORD_SOURCE, 'i').test(text)) return true;
  if (new RegExp(HINT_SOURCE, 'i').test(text)) return true;
  // Een losstaande groep van vier tot acht cijfers in het onderwerp, maar geen
  // jaartal: "Nieuwsbrief 2026" hoeft geen bericht op te halen, en dat is de enige
  // vorm die anders élke nieuwsbrief door het poortje zou laten.
  for (const m of blankNoise(text).matchAll(/(?<![A-Za-z0-9_])(\d{4,8})(?![A-Za-z0-9_])/g)) {
    if (!YEAR.test(m[1])) return true;
  }
  return false;
}
