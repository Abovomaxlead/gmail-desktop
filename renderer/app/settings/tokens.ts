// De opmaaktokens die de secties van het instellingenpaneel delen. Eén plek,
// zodat een groep in Algemeen niet stilletjes een andere haarlijn krijgt dan een
// groep in Over, en zodat te controleren is wáár er kleur mag staan.
//
// Let op de haakjes bij elke haarlijn: `border-black/8` bestaat niet in
// Tailwind 3 — de standaardschaal voor doorzichtigheid gaat per 5, dus die
// klasse levert geen regel op en valt stil weg. `border-black/[0.08]` wel.

// Het paneel is grijs met één wit vlak erin. Kleur komt er alleen in als hij iets
// zegt, en dat is op precies drie plekken:
//
//   1. de kleur van een account, in `AccountsSection` — die staat niet hier,
//      want hij komt uit de gegevens (`style={{ backgroundColor: p.color }}`);
//   2. `ACCENT_BUTTON`, op de ene knop die een update uitvoert;
//   3. `DANGER_*`, op het verwijderen van een account en op een mislukte update.
//
// Staat er ergens anders een tint, dan is het versiering en hoort hij weg. Ook de
// schakelaars houden zich daaraan: aan is donker, niet blauw.

// Een zichtbare focusring op elk aanklikbaar ding. `focus-visible` en niet
// `focus`, zodat een muisklik geen ring achterlaat maar Tab wel. De offset staat
// in de kleur van het witte vlak: alles in een sectie staat daarop. Een focusring
// is een systeemaffordance en geen versiering, en twee soorten ringen in één
// paneel is erger dan één tint.
export const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-900';

// Dezelfde ring, maar voor iets dat rechtstreeks op het grijze vlak staat in
// plaats van op het witte: de items in de navigatiekolom. Alleen de kleur van de
// offset verschilt — die hoort de achtergrond te zijn waar de ring omheen ligt,
// anders staat er een wit randje op het grijze vlak. Een eigen naam en geen kopie
// in de schil: het is een tweede token en niet een tweede soort ring.
export const SURFACE_FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-100 dark:focus-visible:ring-offset-neutral-950';

// De haarlijn van de ontwerprichting: 8% zwart op licht, 8% wit op donker.
export const HAIRLINE = 'border-black/[0.08] dark:border-white/[0.08]';

// Dezelfde lijn, maar als scheiding tussen kinderen (`divide-y`) in plaats van
// als rand. Tailwind heeft daar aparte klassen voor, dus dit is niet af te leiden
// uit `HAIRLINE`.
export const DIVIDER = 'divide-black/[0.08] dark:divide-white/[0.08]';

// Het witte vlak waar de inhoud van een sectie op staat: één kaart die het hele
// inhoudsgebied vult, met de sluitknop in zijn rechterbovenhoek. Staat in de
// schil, maar hier omdat de kleur ervan de offset van `FOCUS_RING` bepaalt en die
// twee niet uit elkaar mogen lopen.
export const SURFACE = `rounded-2xl border ${HAIRLINE} bg-white dark:bg-neutral-900`;

// Een omlijnd blok bínnen het witte vlak: een accountkaart, het rooster met de
// meldingen per account, de changelog. Alles wat een eigen ding is in plaats van
// een rij in een lijst.
//
// Op wit met een haarlijn erom, en niet met een grijze vulling: het staat al op
// wit, en een tweede grijstint erbij zou een derde vlakkleur in het paneel zijn.
export const PANEL = `rounded-xl border ${HAIRLINE} bg-white dark:bg-neutral-900`;

// Een melding onder de kop over de volle breedte — nu alleen de Rene-strook.
// Grijs, en dat is een beslissing en geen verzuim: de strook zegt dat er een
// stand aan staat, en dat is niet identiteit, niet de knop die een update
// uitvoert en geen gevaar. Precies de drie rollen waar dit paneel kleur voor
// bewaart. Een vierde tint erbij zou de regel onhandhaafbaar maken, en de winst
// zou nul zijn: de strook staat er alleen áls die stand aan staat, dus zijn
// aanwezigheid is al het signaal.
export const NOTICE = `rounded-xl bg-neutral-100 px-4 py-3 text-[13px] font-medium dark:bg-neutral-800`;

// De kop van een sectie: de eerste tekst in het witte vlak, en de enige tekst in
// het paneel op deze maat. 22px/600 — een stap boven de kop van een groep (15px),
// zodat de rangorde binnen het vlak van bovenaf te lezen is.
export const SECTION_TITLE = 'text-[22px] font-semibold tracking-tight';

// De kop van een groep bínnen een sectie ("Opstarten" boven de twee rijen die
// daarover gaan). 15px/600 zit tussen de sectietitel (22/600) en een rijlabel
// (13.5/500), zodat de rangorde te zien is zonder dat er een maat bij komt die
// niet in de schaal staat. De eerste groep van een sectie heeft vaak geen kop:
// dan is de sectietitel de kop.
export const BLOCK_TITLE = 'text-[15px] font-semibold tracking-tight';

// Een waarde die je niet kan aanzetten, naast de knop die er iets mee doet: de
// stand van de standaard-mailclient, het pad van de dropmap, het versienummer.
// Eén maat voor die rol, want hij stond eerst op 12px in Algemeen en op 13px in
// Over. 12px is de stap uit de typeschaal die bij bijtekst hoort, en dat is wat
// dit is: tekst die de rij toelicht, geen tweede rijlabel.
export const VALUE = 'text-xs text-neutral-500';

// De bijtekst onder een rijlabel, en de tekst van een sectie die nog leeg is.
// Zelfde maat en kleur, want het is dezelfde rol: tekst die iets toelicht.
export const HINT = 'text-xs font-normal leading-snug text-neutral-500';

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

// Een selectievakje, in de tekstkleur en niet in een tint: aan of uit is geen
// betekenis die om kleur vraagt. Alleen nog in het rooster met de meldingen per
// account — dertig schakelaars van 36px naast elkaar is een muur, en in een cel
// van 64px is een vakje het juiste ding. Een losse instelling gebruikt `Switch`.
export const CHECKBOX = `h-4 w-4 shrink-0 accent-neutral-900 dark:accent-neutral-100 ${FOCUS_RING}`;

// Een invulveld of keuzelijst: dezelfde maat en dezelfde rand voor een select en
// voor een tijd, zodat ze in verschillende secties niet uit elkaar lopen.
export const FIELD = `rounded-md border ${HAIRLINE} bg-neutral-100 px-2 py-1 text-[13px] text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100 ${FOCUS_RING}`;
