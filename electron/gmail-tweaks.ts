// De vier "verberg dit in Gmail"-voorkeuren, omgezet naar één CSS-tekst die main
// per mailweergave injecteert. Puur: geen Electron, geen DOM. Daardoor is de
// gevoeligste code van deze hele functie — de selectors — te testen zonder een
// venster, en staat hij op één plek in plaats van verspreid over main.
//
// Waarom een tabel en niet vier `if`-jes met een string erin: dit zijn ingrepen in
// een pagina die niet van ons is. Google's klassenamen zijn versleuteld (`.aeH`,
// `.gb_Rc`) en veranderen zonder aankondiging. Als er morgen één stopt met werken,
// hoort dat één regel in één tabel te zijn om bij te werken, en niet een zoektocht
// door main.
//
// Twee dingen die het risico klein houden:
//
//   1. Elke regel heeft meerdere kandidaat-selectors, komma-gescheiden. Een
//      selector die niets raakt is in CSS een no-op — er is geen straf voor het
//      verbergen van een knoop die niet bestaat. Renoemt Google er één, dan pakt de
//      volgende het op.
//   2. Waar het kan staat er een selector die op iets stabiels hangt: `role`,
//      `aria-label`, `href`, `alt`. Die overleven een hernoemronde; een
//      versleutelde klasse niet. Staat er tóch een versleutelde klasse, dan zegt de
//      opmerking erbij dat het een gok is.
//
// `!important` moet: Gmail zet zijn eigen `display` met hoge specificiteit en soms
// inline. Eén per declaratie, niet meer — dat is wat de test controleert.

import type { GmailPrefs } from './prefs-store';

/**
 * De voorkeuren die met CSS te doen zijn. `alwaysComposeInNewWindow` en
 * `closeComposeAfterSend` staan hier bewust niet in: die veranderen niets aan de
 * pagina maar aan de app (compose-window.ts), en zijn met geen enkele stylesheet
 * te maken.
 */
export type GmailHideFlag =
  | 'hideInboxFooter';

export type GmailCssPrefs = Pick<GmailPrefs, GmailHideFlag>;

/** Hoe zeker we zijn dat de selectors van een regel in het echte Gmail raken. */
export type RuleConfidence = 'hoog' | 'midden' | 'laag';

export interface GmailTweakRule {
  /** De voorkeur die deze regel aanzet. Eén regel per voorkeur, geen twee. */
  readonly pref: GmailHideFlag;
  /** Kandidaten, in de volgorde van meest naar minst stabiel. */
  readonly selectors: readonly string[];
  /** De declaraties tussen de accolades, met puntkomma. */
  readonly declarations: string;
  /** Voor de rapportage en om in een test te kunnen zeggen wát er nagekeken moet. */
  readonly confidence: RuleConfidence;
}

// Alles wat we doen is verbergen, dus één declaratie voor alle regels. Staat hier
// als constante zodat er niet per ongeluk vier keer een iets andere spelling van
// hetzelfde in de tabel komt te staan.
const HIDE = 'display: none !important;';

/**
 * De tabel. Dit is de enige plek waar een Gmail-selector staat; verandert Google
 * iets, dan is dit het bestand. Geëxporteerd omdat de test erop mag controleren
 * (geen dubbele voorkeuren, geen onbegrensde `:has()`, elke voorkeur precies één
 * keer) — dat zijn juist de fouten die je in een CSS-tekst niet ziet.
 */
export const GMAIL_TWEAK_RULES: readonly GmailTweakRule[] = [
  {
    pref: 'hideInboxFooter',
    // De voettekst onder de lijst: hoeveel opslag je gebruikt, Voorwaarden,
    // Privacy, en wanneer het account voor het laatst actief was.
    //
    // `[role="contentinfo"]` is precies wat een voettekst hoort te zijn en is de
    // eerste keus. Daarna de rij met de juridische links, gevonden via hun `href`:
    // Google gebruikt zowel `policies.google.com/terms` als het oudere
    // `/intl/nl/policies/terms/`, dus er wordt op het gemeenschappelijke deel
    // gematcht. Ook hier `:has(> …)` en niet `:has(…)`, om dezelfde reden als bij de
    // afwezigheidsbalk.
    //
    // `.aeJ .xn` is een versleutelde klasse en dus een gok; hij pakt het hele
    // voetblok in één keer waar de andere twee alleen de linkrij raken.
    selectors: [
      '[role="contentinfo"]',
      'div:has(> a[href*="/policies/terms"])',
      'div:has(> span > a[href*="/policies/terms"])',
      '.aeJ .xn',
    ],
    declarations: HIDE,
    confidence: 'laag',
  },
];

/**
 * De CSS voor de standen die aan staan, of `''` als er niets aan staat.
 *
 * Die lege string is geen randgeval maar de normale stand: alle vier de voorkeuren
 * beginnen op `false`, en dan hoort er niets geïnjecteerd te worden. Een stylesheet
 * met alleen commentaar erin zou al een verschil zijn tussen "de app doet niets aan
 * Gmail" en "de app injecteert iets dat niets doet", en de aanroepkant mag op die
 * lege string vertrouwen om de injectie helemaal over te slaan.
 *
 * De volgorde is die van de tabel en niet die van de meegegeven voorkeuren, zodat
 * dezelfde standen altijd letterlijk dezelfde tekst opleveren — anders zou main bij
 * elke wijziging opnieuw injecteren omdat de string "veranderd" lijkt.
 */
export function gmailTweakCss(g: GmailCssPrefs): string {
  const blocks: string[] = [];
  for (const rule of GMAIL_TWEAK_RULES) {
    if (!g[rule.pref]) continue;
    // De naam van de voorkeur als commentaar boven het blok: wie in de
    // ontwikkelaarstools naar een verdwenen element kijkt, ziet dan meteen welke
    // schakelaar het deed. Het commentaar staat vóór de selectors, niet erachter,
    // zodat de tekst altijd op `}` eindigt en er geen half blok kan ontstaan.
    blocks.push(`/* ${rule.pref} */\n${rule.selectors.join(',\n')} { ${rule.declarations} }`);
  }
  return blocks.join('\n\n');
}
