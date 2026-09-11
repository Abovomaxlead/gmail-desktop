# De structuur niet in de structuur

Onderzoek van 2026-09-10, niets aan de code veranderd. Voor morgen.

## Wat er nu gebeurt

Bij een labelsleep met **Structuur overnemen** aan kiest de picker één bestemming per postvak:
bovenin, of onder een label dat dat postvak al heeft (`renderer/app/maildrop/page.tsx:411-421`
→ `CopyTarget.tree.parentLabelId`). Die keuze wordt nergens getoetst tegen de namen van de
gesleepte boom, en `destinationName` plakt de volledige bron-naam achter de ouder
(`electron/mail/label-tree.ts:61-63`). Dus mag je de boom in zijn eigen kopie leggen.

Bewezen met een weggegooid testje op de echte modules (`labelTreeMembers` + `planLabelTree`,
vitest, 2026-09-10). Bron `Klanten`, `Klanten/Acme`, `Klanten/Acme/2025`; doelpostvak heeft die
drie al (bijvoorbeeld van een eerdere kopie):

| gekozen ouder | wat er wordt aangemaakt |
|---|---|
| `Klanten` | `Klanten/Klanten`, `Klanten/Klanten/Acme`, `Klanten/Klanten/Acme/2025` |
| `Klanten/Acme/2025` | `Klanten/Acme/2025/Klanten`, `…/Klanten/Acme`, `…/Klanten/Acme/2025` |

Niets wordt hergebruikt (`reuse` is leeg), alles is nieuw: de hele boom staat een niveau
dieper in zichzelf, met de mail erin. Ongedaan maken kan alleen via de rollback van diezelfde
run; daarna is het handwerk in Gmail.

Twee dingen die al wél goed staan, en die zo moeten blijven:

- **Hetzelfde postvak kan geen doel zijn.** `copyTargetEmails` laat het bronpostvak weg
  (`electron/auth/account-domain.ts:66-75`), dus `Klanten` in `Klanten` van hetzelfde postvak
  is nu al onmogelijk. Het probleem is puur het doelpostvak dat dezelfde namen al heeft.
- **Twee keer bovenin slepen is idempotent.** Alle bestemmingsnamen zijn dan gelijk aan de
  bronnamen, `planLabelTree` vindt ze terug en hergebruikt ze; er komt geen tweede boom bij.

## De regel

Gmail-nesting is alleen naamgeving, dus dit is stringwerk en het hoort in `label-tree.ts`,
naast de rest. Wat de boom in het doel bezet, is de naamketen van de gesleepte label plus al
zijn leden — en omdat elk lid onder `dragged` hangt en elke voorouder een prefix daarvan is,
valt dat samen tot één segment:

> Een ouder is verboden als zijn **eerste padsegment** gelijk is aan het eerste padsegment van
> de gesleepte label.

`parentInsideTree(dragged: string, parent: string | null): boolean`, puur, `null` (bovenin) is
altijd toegestaan.

Wat dit afdekt, en waarom vergelijken op segment en niet op `startsWith` van de ruwe string:

| gesleept | ouder | verboden | waarom |
|---|---|---|---|
| `Klanten` | `Klanten` | ja | `Klanten/Klanten` |
| `Klanten` | `Klanten/Acme` | ja | boom in eigen kopie |
| `Klanten` | `Klanten/Overig` (alleen in doel) | ja | dupliceert `Klanten` onder zichzelf |
| `Klanten/Acme` | `Klanten` | ja | `Klanten/Klanten/Acme` — bovenin geeft precies het bedoelde `Klanten/Acme` |
| `Klanten` | `Klantenservice` | nee | ander label, geen scheidingsteken |
| `Klanten` | `Archief` | nee | gewone bestemming |

Vergelijken kleine letters (`toLocaleLowerCase('nl')`): Gmail behandelt labelnamen die alleen
in kapitalisatie verschillen als dezelfde naam (dat is de 409 die `createVisibleLabel` al
opvangt), dus `klanten` als ouder van `Klanten` is dezelfde fout. *Die 409-gelijkheid is
aangenomen, niet gemeten — morgen even tegen een echt postvak houden.*

Belangrijk voor de bouw: **geen IPC-wijziging nodig.** De picker heeft `tree.dragged` en
`tree.members` al binnen (`renderer/lib/maildrop-copy.ts:124-127`), dus de renderer kan de
regel zelf toepassen.

## Waar hij wordt afgedwongen

Twee plekken, en dat is geen dubbelop: de picker weet het vóór de klik, main weet het als de
labellijst inmiddels iets anders is.

1. **De picker** — `PlaceRow` in `renderer/app/maildrop/panel-parts.tsx:233-246` krijgt een
   `blocked`-vlag: rij grijs, niet aanklikbaar, met de reden als `title`. **Niet weglaten uit
   de lijst**: een label dat in Gmail bestaat en in de picker ontbreekt laat je zoeken naar
   iets wat er hoort te zijn. Twee dingen horen bij dezelfde pass, anders lekt de keuze er
   langs:
   - de Recent-snelkoppelingen (`panel-parts.tsx:213-224`) gaan door dezelfde filter;
   - `toggle` in `page.tsx:396-409` weigert een verboden id, zodat toetsenbord of een oude
     `picked`-staat het niet alsnog binnenbrengt.
   Nieuwe string in de drie tabellen van `renderer/app/strings.ts` (en, nl, nl-formeel), in de
   trant van `mdTreeInsideItself: 'Dit label hoort bij dezelfde structuur'`.
2. **`planTrees`** (`electron/mail/mail-drop-controller.ts:1998-2008`) — na het opzoeken van de
   ouder-naam, vóór `planLabelTree`, met `errors.set(target.email, …)`. Dat kanaal bestaat al en
   wordt per postvak getoond (zie de regel voor een verdwenen label ernaast). Dit is de plek die
   echt sluit: `copyToMailboxes` is de enige ingang, ook voor de klusdriver (`fromJob`), en een
   klus herplant elke batch — dus de weigering geldt ook voor een klus die met een oude keuze
   loopt.

Weigeren, niet stil herschrijven. De prefix wegstrepen (onder `Klanten` toch `Klanten/Acme`
maken) zou de bestaande betekenis van `destinationName` veranderen — het volledige pad komt
daar met opzet mee — en de gebruiker mail geven op een plek die hij niet heeft aangewezen. Wie
`Klanten/Acme` onder de bestaande `Klanten` wil: dat is **Bovenin**, dat hergebruikt `Klanten`
en levert exact dat op. Die zin hoort in de meldingstekst.

## Tests

- `tests/label-tree.test.ts` — de zes rijen uit de tabel hierboven, plus `null` = toegestaan en
  het geval met andere kapitalisatie.
- `tests/mail-copy.test.ts` of de picker-test die `mailboxRows`/`filterLabels` al dekt — een
  verboden id dat via `toggle` binnenkomt levert geen target op.
- Geen test voor de `PlaceRow`-styling; dat is de smoke-test bij het bouwen (sleep `Klanten`
  naar een postvak dat `Klanten` al heeft, rij moet dood zijn).

## Gebouwd op 2026-09-11

Afgeweken van het plan hierboven op twee punten, allebei op verzoek:

1. **De keuze is er niet, in plaats van dood.** `placeable` in `renderer/app/maildrop/page.tsx`
   laat de familie van de gesleepte boom uit de lijst weg zolang de structuur aan staat; die ene
   lijst voedt zowel `filterLabels` als `recentFor`, dus zoeken en de snelkoppelingen laten hem
   ook niet terugkomen. De weigering in `planTrees` blijft staan als vangnet voor een labellijst
   die inmiddels iets anders is (hernoemd label, klus met een oude keuze).
2. **De bovenste rij zegt wat hij doet.** `treeTopPlace` (`renderer/app/tree-place.ts`) maakt van
   "Bovenin" ofwel *Samenvoegen met "Klanten"* — met eronder *de labels die er al zijn worden
   hergebruikt* — ofwel *Nieuw bovenin: "Klanten"*, afhankelijk van of het doelpostvak het eerste
   padsegment al heeft. Die rij staat nu bovenaan, vóór Recent, met een scheidingslijn onder
   zich; de kop "Plaats onder" hoort alleen nog bij de labels eronder. Dezelfde naam gebruikt de
   chip in de voettekst, want `pickedChips` krijgt nu de naamgever van de pagina mee (daarvoor
   toonde die het ruwe `TOP_LEVEL`-teken).

Tests: `tests/label-tree.test.ts` (parentInsideTree), `tests/tree-place.test.ts`,
`tests/mailbox-rail.test.ts` bijgewerkt. Visueel nagelopen op de echte geëxporteerde
`/maildrop`-pagina met een nagebootste bridge.
