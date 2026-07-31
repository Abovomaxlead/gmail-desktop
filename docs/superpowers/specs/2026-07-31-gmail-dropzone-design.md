# Dropzone bovenaan de Gmail-view: mails opslaan en loggen

Datum: 2026-07-31

## Doel

Een dropzone bovenaan de Gmail-webview waar je een conversatie uit de
berichtenlijst naartoe sleept. De app slaat dan het originele bericht (RFC822,
`.eml`) van elk bericht in die conversatie op in een instelbare map, en schrijft
per bericht een regel met metadata en de body-tekst naar een JSONL-logbestand.

Buiten scope: `.eml`/`.msg`-bestanden die van buiten de app (Verkenner, Outlook)
naar binnen gesleept worden. Alleen slepen vanuit de Gmail-lijst.

## Bepalende beperking

HTML5 drag & drop werkt niet tussen twee Electron-`WebContentsView`s: een drag
die in de Gmail-view begint bereikt nooit een aparte overlay-view. De dropzone
moet daarom in de Gmail-pagina zelf geïnjecteerd worden, door de bestaande
preload (`electron/preload.ts`), die met `contextIsolation: false` in elke
mail-view draait en dus bij `window.GLOBALS` kan.

## Architectuur

```
Gmail-view (preload)                    main-proces
─────────────────────                   ───────────
dragstart op rij  ──► onthoud threadId
                      toon strip
drop              ──► IPC MAIL_DROP {threadId, authuser, ik}
                                        │
                                        ├─ fetch ?view=om&th=…  (session-cookies)
                                        ├─ parse "download origineel"-links
                                        ├─ fetch elk → .eml bytes
                                        ├─ parse headers + platte tekst
                                        ├─ schrijf .eml('s) naar map
                                        └─ append regel(s) aan log.jsonl
                                        │
strip toont resultaat ◄── IPC MAIL_DROP_RESULT
```

Het ophalen gebeurt in het main-proces met
`net.request({ session: session.fromPartition('persist:google') })`. Die stuurt
de Gmail-sessiecookies automatisch mee. Binair werk en schrijven naar schijf
blijven zo buiten de Gmail-pagina.

`view=om` is Gmail's eigen "origineel weergeven"-pagina. Aangeroepen met een
thread-id levert die de originelen van alle berichten in de conversatie — precies
wat gevraagd is, en minder werk dan per bericht een `permmsgid` opdiepen.

## Componenten

Kleine, los testbare modules, in lijn met de rest van `electron/`.

### `electron/dropzone.ts` (nieuw, puur)

- `dropzoneHtml()` — markup + CSS van de strip als string.
- `threadIdFromDragTarget(el)` — loopt omhoog naar de dichtstbijzijnde
  `[data-legacy-thread-id]` en geeft het id terug, of `null`.
- `authuserFromPath(pathname)` — `/mail/u/2/…` → `"2"`, standaard `"0"`.
- `ikFromPage(win, html)` — leest `win.GLOBALS?.[9]`; valt terug op een regex
  `[?&]ik=([0-9a-f]+)` over de pagina-HTML. Geeft `null` als beide falen.

Geen DOM-manipulatie hier: die staat in het Electron-deel van `preload.ts`, dat
al achter een `typeof document !== 'undefined'`-guard zit.

### `electron/eml.ts` (nieuw, puur)

- `parseHeaders(text)` → `{ from, to[], cc[], subject, date, messageId }`.
  Unfoldt doorlopende headerregels en decodeert RFC2047 (`=?utf-8?B?…?=`).
- `extractPlainText(text)` → body als platte tekst. Kiest de eerste
  `text/plain`-part; is die er niet, dan `text/html` met tags gestript. Decodeert
  `quoted-printable` en `base64`; charsets `utf-8`, `iso-8859-1`, `windows-1252`.
  Onbekende charset → `utf-8`.

### `electron/mail-fetch.ts` (nieuw)

Puur en testbaar:

- `omUrl({ authuser, ik, threadId })` → de `view=om`-URL.
- `parseOriginalLinks(html)` → de "download origineel"-hrefs uit die pagina
  (`view=att` + `disp=comp`), in paginavolgorde, absoluut gemaakt.

Plus een dunne, ongetest wrapper `fetchThreadEmls(session, params)` die de
om-pagina ophaalt, de links parset en elke link als `Buffer` ophaalt.

### `electron/mail-archive.ts` (nieuw)

- `safeName(s)` — verwijdert `\/:*?"<>|`, vouwt witruimte samen, kapt af op 60
  tekens.
- `threadFolderName(ts, headers)` en `messageFileName(index, headers)` — zie
  Opslagindeling.
- `writeThread(root, ts, messages)` — maakt de map, schrijft de `.eml`'s, lost
  naamconflicten op met `-2`, `-3`, … en geeft de geschreven paden terug.
- `appendLog(root, records)` — appendt regels aan `log.jsonl`.

### Aanpassingen aan bestaande bestanden

- `electron/ipc.ts` — twee kanalen:
  - `MAIL_DROP: 'mail:drop'` (Gmail-view → main),
    payload `{ threadId, authuser, ik }`
  - `MAIL_DROP_RESULT: 'mail:drop-result'` (main → Gmail-view),
    payload `{ ok: boolean, count: number, error?: string }`
- `electron/preload.ts` — injecteert de strip in `document.documentElement`,
  hangt de drag-listeners op, stuurt `MAIL_DROP`, toont het resultaat.
- `electron/profile-view-manager.ts` — vangt `MAIL_DROP` af in de bestaande
  `ipc-message`-handler (alleen voor `surface === 'mail'`) en roept een nieuwe
  constructor-callback `onMailDrop(accountKey, payload)` aan. Nieuwe methode
  `sendDropResult(accountKey, result)` stuurt `MAIL_DROP_RESULT` terug.
- `electron/main.ts` — bedraadt `onMailDrop`: map uit prefs, ophalen, parsen,
  schrijven, loggen, resultaat terugsturen.
- `electron/prefs-store.ts` — `mailDrop: { folder: string }` in `Prefs`, met
  getter/setter en validatie in `getAll()`. Standaard
  `join(app.getPath('documents'), 'Gmail Desktop', 'Mail')`.
- `renderer/app/SettingsPanel.tsx` + `renderer/app/strings.ts` — een rij in de
  sectie Algemeen: het huidige pad, een knop "Map kiezen…"
  (`dialog.showOpenDialog`) en "Map openen" (`shell.openPath`). Strings ook in de
  Rene-variant.

## Gedrag van de dropzone

Onzichtbaar tot je sleept.

**Muis-events, geen drag & drop.** Gmail markeert geen enkel element als
`draggable` (gemeten in de echte pagina: 0, naast 39 conversatierijen) en bouwt
het slepen zelf na met muis-events. `dragstart` en `drop` vuren daar dus nooit.
De strip volgt daarom `mousedown` / `mousemove` / `mouseup`, en bepaalt het
loslaten op coördinaten in plaats van op het element onder de cursor — Gmail
tekent daar zijn eigen sleepbeeld overheen. De strip heeft in alle standen
`pointer-events: none` en kan Gmail dus nergens in de weg zitten.

1. `mousedown` (capture-fase, op `document`): `threadIdFromDragTarget(e.target)`
   zoekt het thread-id op — omhoog naar de rij en binnen die rij omlaag naar de
   onderwerp-span, waar Gmail het attribuut zet. Nog niets zichtbaar: een klik
   is geen sleep.
2. `mousemove` verder dan 15px: de strip schuift in beeld; boven de strip wordt
   hij massief blauw.
3. `mouseup` boven de strip: opslaan. Zit de ingedrukte rij in de selectie
   (aangevinkte checkboxes), dan gaan alle geselecteerde conversaties mee —
   net als Gmail zelf doet; anders alleen die ene rij.
4. Ergens anders loslaten, of een sleep zonder herkende conversatie: de strip
   verdwijnt zonder melding.
5. Na `MAIL_DROP_RESULT` blijft de strip 2 seconden staan met
   "3 berichten opgeslagen", of in rood de foutmelding.

De strip is `position: fixed`, `top: 0`, volle breedte, ~56px hoog, afgeronde
stippellijn, tekst "Sleep hier om de mail op te slaan", `z-index: 2147483647`.
Styling in een eigen `<style>`-element met op `#gmd-dropzone` gescopete
selectors, zodat Gmail's CSS er niet bij kan en wij niets van Gmail raken.

De strip hangt in `<body>`, niet in `<html>`: een element dat naast `<body>`
hangt krijgt geen plek in de renderboom en blijft onzichtbaar, hoe hoog de
z-index ook staat. Een `MutationObserver` op die host hangt hem terug als
Gmail's SPA hem weggooit.

## Opslagindeling

Standaardmap `Documenten\Gmail Desktop\Mail`, instelbaar. Per drop één submap,
ook bij een conversatie van één bericht:

```
Mail\
  2026-07-31_1432_Jan de Vries_Offerte week 31\
    01_2026-07-29_1002_Jan de Vries_Offerte week 31.eml
    02_2026-07-31_1428_Luca Manuel_RE Offerte week 31.eml
  log.jsonl
```

- Mapnaam: droptijdstip + afzender en onderwerp van het **eerste** bericht.
- Bestandsnaam: volgnummer (2 cijfers, threadvolgorde) + datum, tijd, afzender en
  onderwerp van **dat** bericht.
- Alle naamdelen door `safeName()`.

## Logformaat

`log.jsonl` in de wortel van de map, één regel per bericht, alleen appenden:

```json
{"ts":"2026-07-31T14:32:10.412Z","account":"luca.manuel@abovomaxlead.nl","threadId":"18f2a…","messageId":"<CAF…@mail.gmail.com>","from":"Jan de Vries <jan@…>","to":["luca…"],"cc":[],"subject":"Offerte week 31","date":"2026-07-29T10:02:44.000Z","file":"2026-07-31_1432_…/01_….eml","bytes":18422,"body":"Hoi Luca,\n\nBijgaand…"}
```

- `ts` — moment van de drop (ISO 8601, UTC), gelijk voor alle berichten uit één
  drop.
- `date` — de `Date`-header van het bericht, ISO 8601. Ontbreekt of onparsebaar
  → `null`.
- `file` — pad relatief aan de wortel van de map, met `/` als scheidingsteken.
- `body` — de platte tekst uit `extractPlainText`, niet afgekapt.

Bij een fout krijgt de regel geen `file`/`bytes`/`body`, maar wel `"error"` met
de reden, plus wat er wél bekend was (`ts`, `account`, `threadId`).

Alleen appenden betekent: veilig als de app crasht, en direct regel-voor-regel te
verwerken (bijvoorbeeld door n8n).

## Foutafhandeling

`view=om` en de `ik`-token zijn interne Gmail-mechanismen, geen API. Google kan
ze wijzigen. Dat is een aanvaard risico; het wordt bij de implementatie tegen een
echt account geverifieerd.

| Situatie | Gedrag |
|---|---|
| `ik` niet te vinden | Strip: "Kon Gmail-token niet lezen". Logregel met `error`. |
| om-pagina geeft geen 200 | Strip: "Ophalen mislukt (HTTP 4xx)". Logregel met `error`. |
| Geen origineel-links in de pagina | Strip: "Geen origineel gevonden". Logregel met `error`. |
| Eén bericht van de thread faalt | De andere worden gewoon opgeslagen. Strip meldt "2 van 3 opgeslagen". Per mislukt bericht een logregel met `error`. |
| Map niet schrijfbaar | Strip: "Kan niet schrijven naar `<pad>`". Logregel alleen als het log zelf wél schrijfbaar is; anders alleen de melding in de strip. |
| Drop zonder thread-id | Genegeerd, geen melding, geen logregel. |

Terugvallen op DOM-scrapen als het ophalen structureel faalt zit bewust **niet**
in dit ontwerp. Dat bouwen we pas als blijkt dat het nodig is.

## Tests

Vitest, in lijn met de bestaande `tests/`. Getest wordt het pure deel; de
Electron-bedrading blijft dun en ongetest, zoals de rest van het project.

- `tests/eml.test.ts` — headers unfolden, RFC2047-decoding, quoted-printable,
  base64, multipart met `text/plain`, multipart met alleen `text/html`,
  `iso-8859-1`, onbekende charset, ontbrekende `Date`.
- `tests/mail-fetch.test.ts` — `omUrl` bouwt de juiste URL;
  `parseOriginalLinks` haalt alle links uit een opgeslagen om-pagina, in
  volgorde, en geeft `[]` bij HTML zonder links.
- `tests/mail-archive.test.ts` — `safeName` op onderwerpen met `/`, `:`, emoji,
  lege string en 200 tekens; naamconflicten krijgen `-2`, `-3`;
  `appendLog` schrijft geldige JSONL en behoudt bestaande regels.
- `tests/dropzone.test.ts` — `threadIdFromDragTarget` op een genest element, op
  een element zonder id; `authuserFromPath`; `ikFromPage` via `GLOBALS`, via de
  HTML-fallback, en `null` als beide ontbreken.

## Implementatievolgorde

1. `eml.ts` + tests
2. `mail-archive.ts` + tests
3. `mail-fetch.ts` + tests
4. `dropzone.ts` + tests
5. `prefs-store.ts`: `mailDrop.folder`
6. IPC-kanalen, preload-injectie, `profile-view-manager.ts`, `main.ts`
7. Settings-UI
8. Verifiëren tegen een echt account
