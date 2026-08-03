# Zijbalk vervangen door een topbar

Datum: 2026-08-03

## Waarom

De accountnavigatie zit nu in een vaste kolom van 72px links. De gebruiker wees
een andere Gmail-wrapper aan waarin de accounts als tabbladen in een horizontale
balk bovenaan staan, met de vensterknoppen in diezelfde balk, en vindt dat
ontwerp mooier. Dit is een uiterlijke verbouwing met één functionele
consequentie (zie beslissing 2).

Winst naast het uiterlijk: de webview krijgt de volle vensterbreedte, en de balk
vervangt de titelbalk van het besturingssysteem in plaats van eronder te hangen,
dus er gaat netto nauwelijks hoogte verloren.

## Beslissingen

Vastgesteld in overleg, voordat dit ontwerp er lag:

1. **De topbar wordt de titelbalk.** Geen aparte vensterbalk meer; de
   vensterknoppen zitten in onze balk.
2. **De agenda- en Google-apps-iconen verhuizen naar een rechtsklikmenu op het
   tabblad.** Ze staan nu per account zichtbaar in de zijbalk. In de balk zou dat
   te vol worden, en één iconenrij rechts voor alleen het actieve account zou het
   direct springen naar de agenda van een ánder account kosten. Het
   rechtsklikmenu houdt die mogelijkheid en houdt de balk rustig. Nadeel dat we
   accepteren: een rechtsklikmenu is niet vindbaar zonder het te weten.
3. **Een tabblad toont de naam en het aantal ongelezen; de accountkleur wordt een
   accent.** Geen avatar in het tabblad — dat maakt de tabs breed en juist de
   leesbare naam is wat het aangewezen ontwerp rustig maakt. De kleurcodering per
   account blijft, als streepje langs de onderrand.
4. **De "+" staat direct achter het laatste tabblad; het tandwiel en de
   updateknop staan rechts.** Zoals een nieuw-tabblad-knop in een browser. De
   updateknop verschijnt alleen als er echt een update is.

## Aanpak: `titleBarOverlay`, niet `frame: false`

Er zijn twee manieren om de titelbalk kwijt te raken.

Gekozen: **`titleBarStyle: 'hidden'` met een `titleBarOverlay`.** Electron tekent
de échte vensterknoppen als overlay bovenop de pagina; wij reserveren er ruimte
voor en geven de kleuren door. Dat houdt gedrag dat mensen gebruiken: Snap
Layouts als je op Windows 11 boven de maximaliseerknop hangt, correcte
sleepranden, en op macOS staan de stoplichten automatisch links en goed
gepositioneerd. Het venster blijft ook bij maximaliseren zich gedragen als een
normaal venster.

Afgewezen: **`frame: false` met eigen knoppen.** Volledige controle over het
uiterlijk, maar dan bouwen we zelf minimaliseren, maximaliseren, sluiten en het
bijhouden van "is dit venster gemaximaliseerd", verliezen we Snap Layouts, en
wordt macOS een aparte tak. Het verschil in uiterlijk is een paar pixels; het
verschil in wat er kan misgaan is groot.

## Layout

```
┌────────────────────────────────────────────────────────────────────┐
│ Default │ support 1.324 │ + │           ⚙  ⬆Update │ ─ □ ✕ │  40px │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│                      Gmail-webview (volle breedte)                 │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

Van links naar rechts: een voorruimte die `env(titlebar-area-x)` volgt → de
accounttabs → de "+"-knop → een rekstrook die het sleepgebied is → het tandwiel
en, alleen als er een update klaarstaat, de updateknop → de ruimte die de
overlay voor de vensterknoppen inneemt.

**Waar de vensterknoppen zitten, raden we niet.** Chromium geeft de vrije ruimte
door via de CSS-variabelen `env(titlebar-area-x)`, `-y`, `-width` en `-height`.
De balkinhoud gaat in een container die precies dat gebied vult. Daarmee is
macOS gratis goed: daar staan de stoplichten links, dus `titlebar-area-x` is
groter dan nul en de tabs schuiven mee naar rechts. Een hardgecodeerde breedte
zou per Windows-versie en per schaalfactor anders moeten zijn.

**Eén hoogte, één constante:** `TOPBAR_HEIGHT = 40` in `electron/layout.ts`,
gebruikt door de bounds-berekening, de hoogte van `titleBarOverlay` en de CSS van
de balk. Dat is hetzelfde patroon als het huidige `SIDEBAR_WIDTH = 72`.

**De plaatsing van de webview** verandert op één plek. `contentBounds` levert nu
`x: SIDEBAR_WIDTH` met verminderde breedte; dat wordt `y: TOPBAR_HEIGHT` met
verminderde hoogte en volle breedte. De bestaande `scale`-parameter (2× in
Rene-modus) schaalt straks de hoogte in plaats van de breedte.

**Het instellingenpaneel** rendert nu als tweede kolom náást de zijbalk in
dezelfde flexrij. Het gaat het gebied ónder de balk vullen. De machinerie
eromheen blijft ongewijzigd: main verbergt de Gmail-views al zodra het paneel
opengaat.

**De dropzone raakt dit niet.** Die strip zit vast bovenaan *binnen* de
Gmail-pagina, dus met een balk boven de webview overlappen ze niet, en de
coördinaten waarop de drop wordt bepaald zijn pagina-coördinaten. De overlays
(kopieermodal, herverbind-melding) rekenen op venstergrootte en blijven werken.

## Eén tabblad

Toont `displayName(p)` — het eigen label als dat is ingesteld, anders de naam,
anders het adres — en het aantal ongelezen als dat boven nul is. Een gedelegeerd
postvak krijgt een klein icoontje vóór de naam, in plaats van de hoekmarkering die
het nu op de avatar heeft.

**Het actieve tabblad is aan twee dingen te zien:** een gevulde achtergrond, zoals
het aangewezen ontwerp doet, én de accountkleur als streepje van 3px langs de
onderrand — vol bij het actieve tabblad, gedempt bij de rest. Beide zijn nodig.
Alleen het kleurstreepje is te zwak als iemand een gedempte accountkleur heeft
gekozen; alleen de achtergrond gooit de kleurcodering weg die nu in de zijbalk
zit.

Slepen om accounts te herordenen blijft, maar horizontaal. De tabs zijn nu al
`draggable`; alleen de neerzet-logica wisselt van as.

Passen de tabs niet meer, dan schuift de strook horizontaal met een verborgen
schuifbalk — dezelfde oplossing die de zijbalk nu verticaal gebruikt.

## Het rechtsklikmenu

Per tabblad de surfaces die dat account heeft: de agenda en de Google-apps, uit
de bestaande `surfacesForRef`. Een gedelegeerd postvak zonder vastgelegde
agenda-URL krijgt geen agenda-item.

**Er is niets te onderscheppen.** Ik dacht eerst dat dit zou botsen met het
kopiëren/plakken-menu dat `attachContextMenu` aan élke webContents hangt, de
zijbalk incluis. Dat blijkt niet zo: `planContextMenu` geeft een lege lijst
terug als er niets zinvols is aangeklikt — geen selectie, geen link, geen
afbeelding, geen invoerveld — en `attachContextMenu` toont dan geen menu. Een
rechtsklik op een tabblad valt precies in dat gat. De balk krijgt wel
`user-select: none`, wat je voor een sleepgebied toch al wilt, zodat er nooit een
selectie kan zijn die het native menu alsnog oproept.

## Bestanden

`renderer/app/page.tsx` is 527 regels en houdt nu de hele zijbalk plus alle staat
en IPC. De balk gaat eruit:

| Bestand | Verantwoordelijkheid |
|---|---|
| `renderer/app/Topbar.tsx` (nieuw) | De balk: tabstrook, "+"-knop, rechtercluster, sleepgebied. |
| `renderer/app/AccountTab.tsx` (nieuw) | Eén tabblad: naam, teller, kleuraccent, gedelegeerd-icoon, sleep-handlers, rechtsklik. |
| `renderer/app/AccountMenu.tsx` (nieuw) | Het rechtsklikmenu per account. |
| `renderer/app/tab-menu.ts` (nieuw) | Puur: welke surfaces in het menu van een account horen. |
| `renderer/app/page.tsx` | Houdt staat en IPC; rendert `<Topbar>` en `<SettingsPanel>`. |
| `electron/layout.ts` | `TOPBAR_HEIGHT` in plaats van `SIDEBAR_WIDTH`; `contentBounds` rekent op de hoogte. |
| `electron/main.ts` | Vensteropties, `setTitleBarOverlay` bij thema- en Rene-wissel. |

Dat is geen opruimactie voor de sier: de balk zou anders het derde ding worden in
een bestand dat al te veel doet.

## Foutgevallen

**Het sleepgebied kan verdwijnen.** De rekstrook tussen de "+" en het tandwiel is
waar je het venster oppakt. Bij vier accounts in een smal venster wordt die nul
breed en is het venster niet meer te verplaatsen. De tabstrook krijgt daarom een
maximale breedte zodat er altijd minstens **60px** sleepruimte overblijft; de
tabs schuiven eerder horizontaal dan dat ze de laatste sleepruimte opeten.

**Rene-modus botst met de overlay.** In die modus zoomt de renderer naar 200%,
dus de balk tekent 80px hoog. De hoogte van `titleBarOverlay` is in vensterpixels
en zoomt niet mee, dus de echte knoppen zouden 40px hoog in een balk van 80px
hangen. Bij het aan- en uitzetten van Rene-modus moet dus ook `setTitleBarOverlay`
met de nieuwe hoogte worden aangeroepen — op dezelfde plek die nu al de zoom en
de bounds herberekent.

**De kleur van de vensterknoppen loopt niet mee met het thema.** Schakelen naar
donker laat ze anders donker-op-donker staan. `setTitleBarOverlay({ color,
symbolColor })` moet mee in het pad dat het thema toepast.

**Elk uitklapmenu in de balk moet de content-view wegduwen.** Het "+"-menu doet
dat al via `OVERLAY_TOGGLE`, omdat de Gmail-view een native laag bóven de pagina
is en een dropdown er anders achter valt. Dat geldt nu ook voor het
rechtsklikmenu per tabblad.

**Elke knop in de balk heeft `-webkit-app-region: no-drag` nodig.** Vergeet je
het bij één, dan is die knop niet aanklikbaar en lijkt hij kapot. Dat is de reden
dat de balkinhoud uit één component komt: één plek waar die regel staat.

**`titleBarOverlay` bestaat alleen op Windows en macOS.** De app wordt voor
Windows gebouwd, maar er wordt ook onder WSL ontwikkeld (`main.ts` zet daar al
hardwareversnelling uit). Op Linux is er geen overlay, dus `env(titlebar-area-*)`
levert daar geen bruikbare waarden en `setTitleBarOverlay` mag er niet blind
worden aangeroepen. Twee dingen daarom:

- Elke `setTitleBarOverlay`-aanroep achter een platformcontrole, zodat de app niet
  omvalt op de machine waarop hij ontwikkeld wordt.
- De balk moet er ook zonder overlay redelijk uitzien. Met een CSS-fallback
  (`env(titlebar-area-width, 100%)`) vult de inhoud dan simpelweg de hele breedte.
  Dat het venster op Linux geen knoppen heeft is daar acceptabel — het is geen
  doelplatform — maar het mag geen kapotte balk opleveren.

## Testen

De balk is opmaak en wordt niet als zodanig getest. Wat wel logica is:

- `contentBounds`: dat de webview onder de balk begint over de volle breedte, dat
  de hoogte krimpt en niet negatief wordt, en dat de zoomfactor de hóogte
  schaalt. Die tests bestaan al voor de zijbalkvariant en veranderen mee, wat
  precies vastlegt wat er anders is geworden.
- `tab-menu.ts`: welke surfaces een account krijgt, inclusief een gedelegeerd
  postvak zonder agenda.

Daarnaast nalopen in de draaiende app, omdat dit een verbouwing is die je moet
zien: venster verplaatsen aan de balk, dubbelklik om te maximaliseren, elke knop
aanklikbaar, thema wisselen en kijken of de vensterknoppen meelopen, Rene-modus
aan en uit, een smal venster met vier accounts, en het rechtsklikmenu boven
Gmail.

## Volgorde

De fixronde van de push-branch bewerkt `renderer/app/page.tsx` — precies het
bestand dat deze verbouwing herschrijft. De implementatie begint niet voordat die
ronde gecommit is.

## Wat er niet in komt

- **Geen eigen vensterknoppen.** Zie de afgewezen aanpak.
- **Geen avatars in de tabs.** Beslissing 3.
- **Geen iconenrij rechts voor het actieve account.** Beslissing 2 koos het
  rechtsklikmenu, omdat dat het direct springen naar een ánder account houdt.
- **Account verwijderen komt niet in het rechtsklikmenu.** Dat zit in het
  instellingenpaneel en is onomkeerbaar; een rechtsklik is de verkeerde plek voor
  iets wat je niet terug kunt draaien.
- **Geen verticale variant als optie.** Dit vervangt de zijbalk, het staat er
  niet naast.
