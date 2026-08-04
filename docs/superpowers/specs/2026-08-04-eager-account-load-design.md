# Elk account laadt zijn postvak bij het opstarten

## Het probleem

Bij het opstarten van de app moet je elk account één voor één aanklikken voordat
het postvak inlaadt. Wisselen naar een tabblad dat je nog niet had aangeraakt
kost dus een wachttijd, elke sessie opnieuw.

## Waarom het gebeurt

Detectie maakt bij het opstarten wél al een mailview per account aan:
`probe()` roept `ensureView(authRef(index), 'mail', false)` (`electron/main.ts`).
Die view laadt de url en blijft na registratie staan. Toch is het postvak niet
opgebouwd, om twee redenen:

1. De view staat op `setVisible(false)`. Chromium rekent hem dan als bedekt en
   Gmail bouwt zijn berichtenlijst niet op. Dit is in deze codebase al eerder
   vastgesteld en gedocumenteerd bij `withHiddenView` in
   `electron/profile-view-manager.ts`, dat een view daarom juist buiten het
   venster parkeert in plaats van hem onzichtbaar te maken.
2. `mail` heeft `backgroundThrottling: true` (`renderer/lib/surfaces.ts`), dus
   een bedekte mailview wordt bovendien in zijn timers geknepen.

Er bestaat geen bestaand "postvak staat"-signaal om op te wachten:

- `IPC.ACCOUNT_IDENTITY` is het niet: `extractIdentity` leest het adres uit de
  paginakop en werkt al in een bedekte view — daar leunt detectie nu juist op.
- `IPC.UNREAD_UPDATE` is het niet: dat is `parseUnreadCount(document.title)`, en
  daarin zijn "nul ongelezen" en "nog niet geladen" niet te onderscheiden.

## Wat we bouwen

Elke mailview krijgt bij het opstarten eenmalig een **warmloop**: hij wordt
zichtbaar gemaakt maar buiten het venster geparkeerd, precies de truc die
`withHiddenView` al gebruikt (`{x: -4000, y: 0, width: 1280, height: 900}`).
Daar bouwt Gmail zijn berichtenlijst wél op, zonder dat de gebruiker iets ziet.

Zodra het postvak staat, gaat de view terug naar `setVisible(false)`. De DOM
blijft in het geheugen, dus een latere klik toont hem direct; Chromium mag hem
daarna weer throttlen. Dit is de bewuste keuze van de gebruiker: eenmalig
voorladen in plaats van permanent warm houden, om geheugen en CPU te sparen. Het
aanvaarde gevolg is dat een tabblad dat je na lange tijd aanklikt zichzelf nog
even kan bijwerken.

`backgroundThrottling` blijft ongemoeid. `withHiddenView` bewijst dat buiten het
venster parkeren op zichzelf genoeg is, dus er is geen reden om het gedrag van
alle mailviews permanent te veranderen.

## Onderdelen

### 1. `mailboxTitleLoaded` in `electron/unread-parser.ts`

Pure functie die herkent of de paginatitel de vorm heeft die Gmail pas aanneemt
als het postvak echt staat: `"<map> (<n>) - <adres> - Gmail"`. Getoetst op vorm,
niet op tekst — de mapnaam is vertaald, het adres en het achtervoegsel niet.

Woont naast `parseUnreadCount` omdat het dezelfde bron leest. Aan de paginatitel
hangt de app al; dit voegt dus geen nieuw breukvlak met Gmail-interne markup toe,
wat een DOM-selector op de berichtenlijst wél zou doen.

### 2. `electron/view-warmup.ts` — de policy, zonder Electron

`WarmupTracker` houdt per accountsleutel bij wanneer de warmloop begon en wanneer
het postvak klaar gemeld werd. Alle tijd komt als parameter binnen, dus volledig
te testen zonder Electron, in de lijn van `detection-planner.ts` en
`account-order.ts`.

Een warmloop mag koelen zodra:

- de titel de postvakvorm heeft **en** daarna een nazak-marge is verstreken
  (`WARMUP_SETTLE_MS`) — de titel kan omslaan terwijl de lijst nog tekent; of
- de bovengrens verstrijkt (`WARMUP_CAP_MS`). Dit is de terugvaloptie: een
  account dat nooit inlaadt (uitgelogd, geen netwerk, een inlogpagina) mag geen
  view buiten het venster laten staan.

### 3. `warm` / `cool` in `electron/profile-view-manager.ts`

- `warm(ref, surface)` — zorgt dat de view bestaat, parkeert hem op de
  warm-bounds en zet hem zichtbaar. Nooit op de actieve view: die staat al echt
  in beeld.
- `cool(accountKey, surface)` — terug naar `setVisible(false)`.
- `titleOf(accountKey, surface)` — de paginatitel, zodat het klaar-signaal
  gelezen kan worden.

Een `warming`-set beschermt de warmloop tegen wegdrukken. `show()` zet nu elke
niet-actieve view op `setVisible(false)`, wat een warmloop stil zou breken; dat
wordt `setVisible(vk === k || this.warming.has(vk))`. Dezelfde uitzondering geldt
in `hideAll()` — een warme view staat buiten het venster en kan een instellingen-
paneel dus niet overlappen. Een view die actief wordt, verlaat de set.
`discardView` en de `destroyed`-handler ruimen hem ook op.

### 4. Aansturing in `electron/main.ts`

`registerAccount()` en `loadDelegatedProfiles()` zetten een warmloop in de
wachtrij. Eén timer van 1s leest per lopende warmloop de titel uit, vraagt de
tracker om een oordeel, koelt wat klaar is, en stopt zichzelf als de wachtrij
leeg is.

## Wat we bewust niet doen

**Detectie parallelliseren.** `probe(n+1)` start pas na `onIdentity(n)`, want
`planNext` dedupliceert op volgorde. De identiteitspoll vuurt per account binnen
enkele seconden, dus accounts warmen in cascade op: af binnen ongeveer tien tot
twintig seconden na opstart, ruim vóór de eerste klik. Dat weegt niet op tegen
het verbouwen van een subtiele toestandsmachine.

**Een instelling per account.** De gebruiker koos voor standaardgedrag zonder
schakelaar.

**Een DOM-selector op de berichtenlijst.** Nauwkeuriger dan de titel, maar het
koppelt aan Gmail-interne markup, en de app heeft daar al genoeg van
(`popOutThread`, `scrapeSwitcher`) — beide gedocumenteerd als breekbaar.

## Testen

- `tests/unread-parser.test.ts` — uitgebreid met `mailboxTitleLoaded`: kale
  titel, inlogpagina, geladen postvak met en zonder teller, andere talen.
- `tests/view-warmup.test.ts` — nieuw: koelen op titelsignaal na de nazak-marge,
  koelen op de bovengrens zonder signaal, geen dubbele warmloop per sleutel, een
  lege wachtrij na afronding.

De view-laag (`warm`/`cool`/`show`) heeft geen bestaande testdekking — er is geen
Electron-harnas in deze suite — dus die wordt met de hand nagelopen in de app.
