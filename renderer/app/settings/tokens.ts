// De opmaaktokens die de vier secties van het instellingenpaneel delen. Eén
// plek, zodat een kaart in Algemeen niet stilletjes een andere haarlijn krijgt
// dan een kaart in Over, en zodat te controleren is wáár er kleur mag staan.
//
// Let op de haakjes bij elke haarlijn: `border-black/8` bestaat niet in
// Tailwind 3 — de standaardschaal voor doorzichtigheid gaat per 5, dus die
// klasse levert geen regel op en valt stil weg. `border-black/[0.08]` wel.

// Het paneel is grijs. Kleur komt er alleen in als hij iets zegt, en dat is op
// precies drie plekken:
//
//   1. de kleur van een account, in `AccountsSection` — die staat niet hier,
//      want hij komt uit de gegevens (`style={{ backgroundColor: p.color }}`);
//   2. `ACCENT_BUTTON`, op de ene knop die een update uitvoert;
//   3. `DANGER_*`, op het verwijderen van een account en op een mislukte update.
//
// Staat er ergens anders een tint, dan is het versiering en hoort hij weg.

// Een zichtbare focusring op elk aanklikbaar ding. `focus-visible` en niet
// `focus`, zodat een muisklik geen ring achterlaat maar Tab wel. Dezelfde ring
// als in de schil, met de offset in de kaartkleur in plaats van in de vlakkleur:
// alles in een sectie staat op een kaart. Een focusring is een systeemaffordance
// en geen versiering, en twee soorten ringen in één paneel is erger dan één tint.
export const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-900';

// De haarlijn van de ontwerprichting: 8% zwart op licht, 8% wit op donker.
export const HAIRLINE = 'border-black/[0.08] dark:border-white/[0.08]';

// Een kaart zonder rijen erin: de changelog, de lege-lijstmelding, een
// accountkaart.
export const PANEL = `rounded-xl border ${HAIRLINE} bg-white dark:bg-neutral-900`;

// Een kaart met `SettingRow`s erin. De haarlijn tússen de rijen komt van de
// `divide-y` hier, niet van de rij zelf — zo krijgt de laatste rij vanzelf geen
// lijn en hoeft er nergens geteld te worden.
export const CARD = `${PANEL} divide-y divide-black/[0.08] px-4 dark:divide-white/[0.08]`;

// De kop van een sectie: 20px/600, zoals de titel van het paneel.
export const SECTION_TITLE = 'text-[20px] font-semibold tracking-tight';

// De kop van een blok bínnen een sectie — nu alleen het rooster met de
// instellingen per account, onder de meldingen die voor alles gelden. 15px/600
// zit tussen de sectietitel (20/600) en een rijlabel (13.5/500), zodat de
// rangorde te zien is zonder dat er een maat bij komt die niet in de schaal
// staat. Een sectie met één blok gebruikt dit niet: dan is de sectietitel de kop.
export const BLOCK_TITLE = 'text-[15px] font-semibold tracking-tight';

// De gewone knop. Grijs, want de meeste knoppen doen iets dat je terug kan
// draaien.
export const BUTTON = `shrink-0 rounded-lg bg-neutral-200 px-3 py-1.5 text-[13px] font-medium text-neutral-900 transition hover:bg-neutral-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700 motion-reduce:transition-none ${FOCUS_RING}`;

// De enige accentkleur in het paneel, op de enige knop die een update
// daadwerkelijk uitvoert. Er staat er altijd hoogstens één van op het scherm:
// "nu bijwerken" hoort bij `available`, "herstarten" bij `downloaded`.
export const ACCENT_BUTTON = `shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-blue-500 motion-reduce:transition-none ${FOCUS_RING}`;

// Rood, en alleen voor gevaar en mislukking. `red-600` met witte tekst haalt in
// de lichte stand 4.8:1 en houdt in de donkere stand zijn verzadiging tegen
// `neutral-800`, dus dezelfde knop kan in beide standen staan.
export const DANGER_BUTTON = `shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-red-500 motion-reduce:transition-none ${FOCUS_RING}`;

// Het vlak waar een onomkeerbare vraag in staat. Een getinte achtergrond met een
// haarlijn erom leest van een meter afstand als "hier moet je even kijken". De
// tekstkleur zit erin en erft naar de tekst binnen het vlak: `red-700` op `red-50`
// is 6.6:1, `red-200` op het donkere vlak ruim 8:1 — beide leesbaar op 12px. De
// knoppen erin zetten hun eigen kleur en trekken zich hier niets van aan.
export const DANGER_PANEL =
  'rounded-lg border border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200';

// Rode tekst, apart van het vlak: de statusregel van een mislukte update staat op
// een gewone kaart. `red-600` op wit is 4.8:1 en `red-400` op `neutral-900` is
// 6.5:1, dus dit blijft op 12px in beide standen leesbaar — één shade voor beide
// zou aan de ene of de andere kant wegvallen.
export const DANGER_TEXT = 'text-red-600 dark:text-red-400';

// De schakelaars zijn gewone selectievakjes, in de tekstkleur en niet in een
// tint: aan of uit is geen betekenis die om kleur vraagt.
export const CHECKBOX = `h-4 w-4 shrink-0 accent-neutral-900 dark:accent-neutral-100 ${FOCUS_RING}`;

// Een invulveld of keuzelijst: dezelfde maat en dezelfde rand voor een select en
// voor een tijd, zodat ze in verschillende secties niet uit elkaar lopen.
export const FIELD = `rounded-md border ${HAIRLINE} bg-neutral-100 px-2 py-1 text-[13px] text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100 ${FOCUS_RING}`;
