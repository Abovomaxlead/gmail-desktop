# Meldingen via de Gmail API met Pub/Sub-push

Datum: 2026-08-03

## Waarom

Meldingen en de ongelezen-teller komen nu uit de webview. Gmail's eigen
webmeldingen worden in `preload.ts` onderschept en de teller wordt uit de
paginatitel gelezen (`parseUnreadCount`, zoekt `(12)`). Dat werkt zolang Gmail
zijn pagina niet verbouwt, en het vraagt een geladen, zichtbare webview per
account.

Pollen van de API is geen alternatief: dat zijn duizenden verzoeken per dag voor
een postvak waarin meestal niets gebeurt. Gmail's push via Pub/Sub is dat wel —
Google meldt zelf wanneer er iets verandert.

De serverkant bestaat al: `gmail-push-relay`
(`\\wsl.localhost\Ubuntu\home\developer\projects\gmail-push-relay`) doet een
streaming pull op de Pub/Sub-subscription en stuurt een trigger over WSS naar de
juiste client. De relay ziet nooit mail en bewaart geen tokens. In
`gmail-native` staat een clientkant die grotendeels over te zetten is
(`src/main/push/manager.ts`, 123 regels, met injecteerbare dependencies).

## Beslissingen

Vastgesteld in overleg, voordat dit ontwerp er lag:

1. **Terugval per account.** Push dekt alleen eigen, via OAuth gekoppelde
   accounts. Voor de rest — gedelegeerde postvakken, niet-gekoppelde accounts,
   push die stuk is — blijft de webview melden zoals nu. Geen account valt stil.
2. **De teller gaat mee.** Bij elke sync ook `labels.get('INBOX')`, zodat teller
   en meldingen niet uit elkaar kunnen lopen. Accounts zonder push blijven de
   titel gebruiken. Zie "Wie de teller bezit" voor welk veld en waarom.
3. **Config bij de OAuth-config.** `google-oauth.json` in `userData` krijgt
   `relayUrl` en `pushTopic`. Dat bestand bestaat al voor de client-id en
   -secret, wordt bij elke aanroep opnieuw gelezen en staat buiten de publieke
   repo. Omgevingsvariabelen gaan voor, om lokaal te kunnen testen.
4. **Filter: alles in Postvak IN, behalve `CATEGORY_PROMOTIONS` en
   `CATEGORY_SOCIAL`.** Dezelfde regel als `gmail-native`. Let op: Gmail's eigen
   meldingsinstelling ("alle nieuwe e-mail" / "alleen belangrijke" / "uit") doet
   niets meer voor een account dat door push gedekt wordt.

## Nagekeken feiten

Niet aangenomen maar opgezocht, omdat een verkeerde API-parameter eerder een
ronde kostte:

- `users.watch` accepteert `gmail.readonly`. Er is **geen** extra Gmail-scope
  nodig. Verzoek: `{topicName, labelIds, labelFilterBehavior}`; antwoord:
  `{historyId, expiration}`.
- `users.history.list` accepteert `gmail.readonly` en geeft **HTTP 404** als
  `startHistoryId` te oud is. Dan is een volledige herijking nodig.
- De relay leest het e-mailadres uit `tokeninfo` om de client aan een account te
  koppelen (`src/auth.ts`, `ALLOWED_EMAILS`). Onze tokens hebben alleen
  `gmail.readonly` en `gmail.insert`, dus tokeninfo geeft **geen** e-mailclaim
  en de relay sluit met `4401` (`no_email_claim`). Daarom moet
  `https://www.googleapis.com/auth/userinfo.email` bij de scopes.
- Electron 31 draait op Node 20 en heeft geen bruikbare globale `WebSocket`.
  Nieuwe afhankelijkheid: `ws`.

Nog **niet** vastgesteld, en het bepaalt of de teller klopt: of een watch met
`labelIds:['INBOX']` ook vuurt wanneer een bericht alleen gelezen wordt (alleen
`UNREAD` verdwijnt, INBOX blijft). Zie "Openstaand" onderaan.

## Architectuur

Staat `relayUrl` of `pushTopic` niet in de config, dan blijft alles zoals het nu
werkt. Dat is ook de toestand op elke machine waar die regels niet staan.

```
Gmail  --nieuwe mail-->  Pub/Sub topic  --streaming pull-->  relay
                                                              |  {type:'sync', historyId}
                                                              v
   per gekoppeld account een WSS-verbinding -->  push-manager (main)
                                                              |
                                                  history.list vanaf cursor
                                                              |
                                        +---------------------+---------------------+
                                        v                                           v
                              nieuwe INBOX-berichten                    labels.get('INBOX')
                                        |                                           |
                              Notification (bestaande weg)               ongelezen-teller
```

Eén verbinding per account, want de relay authenticeert per verbinding met één
token en routeert op het adres uit dat token. Eén socket voor alle accounts kan
dus niet zonder de relay te veranderen.

### Levensloop per account

Bij het opstarten en bij elke wijziging in de accountlijst:

1. WS open, `{type:'auth', accessToken}` (token via `accessTokenFor`, verlengt
   zichzelf), antwoord `{type:'ready'}`.
2. `users.watch({topicName, labelIds:['INBOX'], labelFilterBehavior:'include'})`.
   Vernieuwing elke 24 uur; Gmail laat een watch na 7 dagen vervallen.
3. Meteen één catch-up-sync: die dekt wat er gebeurde terwijl de app dicht of
   offline was.
4. Bij elke `{type:'sync'}`: syncen.
5. Bij een verbroken verbinding: opnieuw proberen, wachttijd 1s oplopend tot
   maximaal 30s.

### Eén sync

1. Cursor lezen. Is er geen, dan `users.getProfile()`, zijn `historyId` opslaan,
   de teller bijwerken, klaar — geen meldingen, want er is niets "nieuw".
2. `users.history.list` vanaf de cursor, `labelId=INBOX`, alle pagina's.
3. Uit de records de `messagesAdded` halen met INBOX en zonder
   `CATEGORY_PROMOTIONS` / `CATEGORY_SOCIAL`, ontdubbeld.
4. Cursor bijwerken — alleen als álle pagina's binnen zijn.
5. `labels.get('INBOX')` voor `threadsUnread`, doorgeven aan de bestaande teller.
6. Per nieuw bericht `messages.get?format=metadata` met `From` en `Subject`, en
   melden via de bestaande `Notification`-weg, zodat DND, stille uren, de
   per-account-schakelaar en het doorklikken naar het gesprek onveranderd
   blijven werken.

### Dekking en dempen

`refreshNotifyAllowed()` stuurt al een `NotifyState{show,silent,persist}` per
view. Voor een gedekt account wordt `show: false` — dat is de hele demping.

Een account is **gedekt** zodra één watch is gelukt. De dekking gaat terug naar
de webview bij:

- een definitieve weigering (`4401` na één vergeefse verversing, `4403`, `4400`);
- een mislukte watch;
- push die langer dan **twee minuten** weg is.

Die twee minuten zijn een afweging: kort genoeg om niet lang blind te zitten,
lang genoeg dat een blip van vijf seconden niets omschakelt. Zonder die grens
zou een relay die twee uur uit ligt betekenen dat er twee uur niets meldt en dat
alles daarna te laat komt.

### Wie de teller bezit

Demping via `show: false` gaat alleen over meldingen. De teller loopt over een
ander kanaal: `preload.ts` stuurt bij elke titelwijziging `IPC.UNREAD_UPDATE`, en
`main.ts` zet dat in `UnreadStore`. Zonder extra maatregel blijft de webview dus
gewoon doorsturen en overschrijft de titelparser de waarde die de API net gaf —
twee bronnen die om dezelfde teller vechten, met een getal dat heen en weer
springt als uitkomst.

Daarom: **per account heeft precies één bron het recht om de teller te zetten.**
Is het account gedekt, dan negeert `main.ts` `UNREAD_UPDATE` voor dat account en
komt de waarde uit `labels.get('INBOX')`. Gaat de dekking terug naar de webview,
dan wordt `UNREAD_UPDATE` weer geaccepteerd en zet de eerstvolgende
titelwijziging de teller.

De waarden zijn niet identiek en dat is geen fout: de titel telt ongelezen
*gesprekken*, `messagesUnread` telt ongelezen *berichten*. Een gesprek met drie
ongelezen antwoorden is 1 in de titel en 3 via de API. `labels.get` geeft ook
`threadsUnread`, dus de implementatie gebruikt **`threadsUnread`** om bij het
huidige gedrag te blijven en te voorkomen dat het getal verspringt op het moment
dat de dekking wisselt.

### De meldingsregel

> Meld alleen mail die binnenkwam terwijl dit account door push gedekt was.

Vergelijk `internalDate` met het moment waarop de dekking begon. Deze ene regel
dekt drie gevallen:

- **Bij het opstarten** begint de dekking pas als de eerste watch lukt, dus alle
  mail die er al lag zwijgt. Zonder dit krijg je bij elke start een stortvloed.
- **Na een korte breuk** in dezelfde sessie is de mail nieuwer dan het moment van
  dekking, dus die meldt gewoon — dat is precies waar de catch-up voor is.
- **Na een teruggave en overname** schuift het moment mee, dus het storingsvenster
  zwijgt. De webview heeft die mail toen al gemeld; zonder dit meldde de
  catch-up alles nog een tweede keer.

## Modules

`main.ts` is met ~1900 regels al groot. De sync komt er daarom niet in: die
krijgt een eigen module met injecteerbare dependencies, zodat `main.ts` er alleen
aan koppelt.

### Nieuw

| Bestand | Verantwoordelijkheid |
|---|---|
| `electron/push-config.ts` | `relayUrl` + `pushTopic` uit `google-oauth.json`, schema valideren (`ws://`/`wss://`). `GMAIL_PUSH_RELAY_URL` en `GMAIL_PUSH_TOPIC` gaan voor. Puur. |
| `electron/push-transport.ts` | `ws` achter een `PushSocket`-interface (send/close/onOpen/onMessage/onClose/onError). De naad naar buiten. |
| `electron/push-manager.ts` | Toestandsmachine: verbinden, authenticeren, watch bewapenen en vernieuwen, backoff, herverbinden, hartslagtimer. Overgezet uit `gmail-native`, plus `onCoverage(email, covered)` en het herkennen van `4401`/`4403`/`4400`. |
| `electron/push-sync.ts` | Eén sync van begin tot eind met geïnjecteerde client en store. Geeft de te tonen meldingen terug in plaats van ze zelf te tonen. |
| `electron/history-sync.ts` | Puur: van history-pagina's naar nieuwe INBOX-bericht-id's (gefilterd, ontdubbeld) plus de nieuwste `historyId`, en de meldingsregel. |
| `electron/history-store.ts` | Cursor per account in `userData/gmail-history.json`. Zelfde vorm als `OAuthStore`. |

### Aangepast

- `electron/gmail-api.ts` — erbij: `watchMailbox`, `stopWatch`, `getProfile`,
  `listHistory`, `getMessageMeta`, `inboxUnread`. Url-bouwers en antwoordlezers
  apart en getest; netwerk via de bestaande `requestJson`.
- `electron/notification-policy.ts` — `notificationsAllowed` krijgt
  `pushCovered`: `show: allowed && !pushCovered`. De policy blijft puur.
- `electron/google-oauth.ts` — `SCOPES` krijgt
  `https://www.googleapis.com/auth/userinfo.email`.
- `electron/oauth-health.ts` — `accountsNeedingReconnect` krijgt een derde
  reden: het token mist een vereiste scope. Zie hieronder.
- `electron/main.ts` — koppelen: manager starten en stoppen, `armWatch`,
  `runSync`, meldingen tonen, teller voeden, dekking doorgeven aan
  `refreshNotifyAllowed`.
- `package.json` — `ws` erbij.

### De scope-val

Na de uitbreiding mist **elk bestaand token** `userinfo.email`, en dan sluit de
relay elke verbinding met `4401` — stil, voor altijd. Push zou na de update bij
niemand werken en niets zou het vertellen.

De machinerie om dat op te vangen staat er al: `hasScopes()` in
`google-oauth.ts` wordt nergens gebruikt, en `accountsNeedingReconnect()` voedt
al een herverbind-melding met een knop. Door "token mist een vereiste scope" als
reden toe te voegen vraagt de app bij het opstarten zelf om die ene extra klik
per account.

## Foutgevallen

**Verbinding.** Onbereikbare relay: opnieuw proberen met oplopende wachttijd.
`4401`: één keer het token verversen en opnieuw; blijft het, dan definitief plus
de herverbind-melding. `4403` betekent dat het adres niet in `ALLOWED_EMAILS`
van de relay staat — definitief, met een duidelijke logregel; daar kan de app
zich niet in vast blijven bijten. `4400` is een bug aan onze kant: hard loggen en
stoppen.

**Dode verbinding zonder afsluiting.** De relay klopt elke 30 seconden aan. Komt
er 90 seconden niets, dan zelf afbreken en herverbinden. Zonder deze timer kan de
manager voor altijd denken dat hij verbonden is.

**Watch mislukt** (bijvoorbeeld: het topic geeft Gmail geen publiceerrecht). Geen
dekking voor dat account, webview blijft melden, opnieuw proberen bij de volgende
verbinding of vernieuwing — niet in een lus.

**Sync mislukt.** 404 op `history.list`: cursor te oud, opnieuw ijken op
`getProfile`, teller bijwerken, geen meldingen. 401: één keer verversen en
opnieuw. 429 of 5xx: deze sync overslaan.

**De cursor schuift alleen op als alle pagina's binnen zijn.** Zou hij opschuiven
na een half gelukte doorloop, dan is die mail voorgoed weg: geen melding, en
niets dat het merkt. Dit is de belangrijkste invariant van het hele ontwerp.

**Twee syncs tegelijk.** Een `sync` die binnenkomt terwijl er één loopt wordt
onthouden en daarna één keer uitgevoerd, niet parallel gestart. Twee doorlopen op
dezelfde cursor melden alles dubbel.

**Metadata van één bericht mislukt.** Geen melding voor dat bericht — er is niets
om te tonen — maar de teller blijft kloppen.

**Account verdwijnt.** Socket dicht, timers weg, en `users.stop()` zodat Gmail
niet nog een week naar het topic blijft publiceren voor een account zonder
client.

## Testen

Pure delen onder vitest, zoals de rest van de repo.

- `push-config`: ontbrekende velden, verkeerd schema, voorrang van de
  omgevingsvariabelen.
- `history-store`: lezen, schrijven, kapot bestand, ontbrekend bestand.
- `history-sync`: history-pagina's naar bericht-id's, categoriefilter,
  ontdubbelen over pagina's heen, de meldingsregel op `internalDate` versus het
  moment van dekking.
- `gmail-api`: de nieuwe url's en antwoordlezers, elk apart.
- `notification-policy`: `pushCovered` dooft `show` en raakt niets anders aan.
- De teller heeft één eigenaar: een `UNREAD_UPDATE` van een gedekt account wordt
  genegeerd, van een ongedekt account niet, en na een teruggave van de dekking
  weer wel. Puur te testen als een functie van (dekking, bron) naar wel of niet
  overnemen.
- `push-manager`, met nep-transport en nep-timers: auth-frame bij openen, watch
  bewapend, catch-up daarna, oplopende wachttijd bij sluiten, vernieuwing
  ingepland en opnieuw ingepland, `4401` één keer overgedaan en dan definitief,
  `4403` meteen definitief, 90 seconden stilte lokt een herverbinding uit,
  `stop()` ruimt alles op, dekkingsmeldingen in de juiste volgorde.
- `push-sync`, met nepclient: eerste keer ijken zonder melden, gewone delta die
  meldt, 404 die opnieuw ijkt, gecoalesceerde dubbele sync, één mislukte
  metadata die de teller heel laat.
- **Een halfgelukte doorloop verzet de cursor niet.** De enige test die een geval
  afdekt waarin mail geruisloos verdwijnt.

`push-transport` krijgt geen test: dat is de naad naar `ws` en hij bestaat juist
zodat alles erboven wel te testen is.

### Daarna echt uitproberen, in drie stappen

1. `npm run dev:local` op de relay (nep-tokeninfo, poort 8099). Bewijst de
   handdruk, herverbinden, backoff en de hartslagtimer tegen een echte
   WS-server, zonder GCP.
2. `npm run live` op de relay met de echte subscription; app met
   `GMAIL_PUSH_RELAY_URL=ws://localhost:8099` en
   `GMAIL_PUSH_TOPIC=projects/<project>/topics/gmail-push`. Mail jezelf, melding
   binnen een paar seconden. Vereist dat `scripts/gcp-setup.sh` één keer heeft
   gelopen.
3. Relay op zijn domein, config in `google-oauth.json`.

## Openstaand

**Vuurt een watch op `labelIds:['INBOX']` ook wanneer een bericht alleen gelezen
wordt?** Bij nieuwe mail vuurt hij zeker. Verdwijnt alleen `UNREAD` terwijl
INBOX blijft, dan staat het niet ondubbelzinnig in de documentatie. Zo niet, dan
loopt de teller pas bij de volgende aankomst weer goed.

Na te gaan in stap 2 van de proef: een bericht openen en kijken of er een sync
komt. Blijkt het niet te vuren, dan is de uitwijk de watch zonder labelfilter
zetten en lokaal filteren — meer pushberichten, maar een teller die klopt. Het
ontwerp houdt dat op één plek (`push-manager`, de watch-aanroep), zodat het
omzetten één regel is.

## Wat er niet in komt

- **Geen pollende achtervang.** De catch-up bij elke (her)verbinding dekt precies
  het gat dat een gemiste push zou veroorzaken, en kost één verzoek in plaats van
  een klok die eeuwig doortikt.
- **Geen eigen meldingsvenster.** De bestaande `Notification`-weg in `main.ts`
  blijft, zodat DND, stille uren, geluid, blijven-staan en het doorklikken naar
  het gesprek onveranderd werken.
- **Geen lokale mailopslag.** `gmail-native` heeft SQLite met threads en
  berichten, want dat is een eigen client. Hier rendert Gmail zelf de mail; wij
  hebben alleen een cursor per account nodig.
- **Geen wijzigingen aan de relay.** Het wire protocol blijft zoals het is.
