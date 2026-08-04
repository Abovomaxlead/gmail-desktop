# Changelog

All notable changes to Gmail Desktop are documented here. This project adheres
to [Semantic Versioning](https://semver.org/).

## [Nog niet uitgebracht]

### Toegevoegd
- **Dropzone bovenaan Gmail om mail te bewaren.** Begin je een conversatie uit
  je berichtenlijst te slepen, dan verschijnt er bovenin een balk. Laat je 'm
  daar los, dan slaat de app elk bericht uit die conversatie op als `.eml` —
  het echte origineel, met alle headers — in een eigen mapje per conversatie.
  Heb je meerdere gesprekken aangevinkt, dan gaan ze allemaal mee.
  Daarnaast komt er per bericht een regel in `log.jsonl`: tijdstip, account,
  afzender, ontvangers, onderwerp, datum, bestandspad en de body als platte
  tekst. De balk meldt daarna hoeveel berichten er zijn opgeslagen, of wat er
  misging. De map kies je bij Instellingen → Algemeen; standaard is dat
  `Documenten\Gmail Desktop\Mail`.
- **Een heel label slepen.** Sleep een label uit de linkernavigatie naar de balk,
  dan komt alle mail uit dat label in één map te staan. Het opzoeken gebeurt in
  een verborgen venster, dus je postvak blijft staan waar het stond. Bij meer dan
  200 gesprekken stopt hij, en dat staat dan in het overzicht en in het log —
  niet stil afkappen.
- **Na een sleep verschijnt een venster** met wat er is opgeslagen, over Gmail
  heen zodat je postvak zichtbaar blijft.
- **Ctrl+Shift+I** opent de devtools van het venster waar je in werkt.
- **Gesleepte mail naar een ander account kopiëren.** Na een sleep kies je in het
  venster naar welke labels de mail toe moet, in elk gekoppeld account. Staat een
  bericht daar al, dan wordt er niets geschreven en vraagt de app eerst wat je
  wilt: alleen de nieuwe erbij, alles erbij, of niets. Herkenning gaat op de
  Message-ID uit de header, dus per label — staat een mail al in "Klanten" maar
  nog niet in "Offertes", dan komt hij alleen in die tweede terecht.
- **Meldingen en de ongelezen-teller komen van Gmail zelf** in plaats van uit de
  pagina te worden gelezen. Gmail meldt een wijziging, de app haalt op wat er
  veranderd is en telt de ongelezen gesprekken bij de bron. Dit vraagt eenmalige
  instelling (een eigen relay en een Pub/Sub-topic) en één keer opnieuw
  toestemming geven per account. Accounts waarvoor dat niet is ingesteld — en
  gedelegeerde postvakken, die geen eigen koppeling hebben — werken precies zoals
  eerst.
- **De accountbalk staat nu bovenaan** in plaats van in een kolom links, en is
  tegelijk de bovenrand van het venster. Elk account is een tabblad met zijn naam,
  het aantal ongelezen en een streepje in zijn eigen kleur. Rechtsklik op een
  tabblad voor de agenda en de andere Google-apps van dát account. De "+" staat
  achter het laatste tabblad, het tandwiel rechts.
- **Instellingen opnieuw ingedeeld:** vier onderdelen naast een navigatiekolom in
  plaats van vijf blokken onder elkaar. Welke meldingen je per account wilt staat
  nu bij Meldingen — daar zie je in één tabel welk account waarvoor piept, in
  plaats van vijf schakelaars per account. Accounts gaat over wie er meedoet: de
  naam, de kleur, en weghalen.

- **Elk account laadt zijn postvak bij het opstarten.** Je hoefde de tabbladen
  één voor één aan te klikken voordat de mail er stond. Nu laadt elk account bij
  het opstarten eenmalig zijn postvak op de achtergrond in, buiten beeld, zodat
  een tabblad er meteen staat als je het aanklikt. Daarna mag de weergave weer
  rusten, dus het kost geen geheugen dat de hele dag warm blijft — een tabblad dat
  je na lange tijd aanklikt kan zichzelf nog even bijwerken.

### Gewijzigd
- **De instellingen hebben inhoud gekregen, tab voor tab.** Weergave (de getallen
  aan of uit, het tray-icoon, de ondergrens van het venster), Downloads (waar een
  download heen gaat, eerst vragen, map openen — de app handelde downloads tot nu
  toe helemaal niet af), Phishing
  Protection (de host laten zien voordat een link naar de browser gaat — waar de
  link écht heen gaat, niet de google.com-omleiding die Gmail om elke link zet —
  met een lijst die zichzelf vult als je "altijd goed" aanvinkt), Bijwerken, Geavanceerd
  (hardwareversnelling), Gmail (mail maken in een eigen venster en dat venster
  sluiten na verzenden), Google Apps (in de app of in de browser, per app een
  uitzondering, de naam en de kleur van het account op een appvenster), en bij
  Meldingen: afzender en onderwerp wel of niet in de melding, geluid, een testknop,
  en wat een klik op een download-melding doet.
- **Accounts is een kaart geworden.** Eén kaart per account met de naam, de pillen
  die zeggen wat je van dat account merkt, de kleuren, een potlood om de naam te
  wijzigen en een prullenbak. Je kan de kaarten slepen om de volgorde te veranderen,
  en de knop "Erbij" staat rechtsboven.
- **Saved Searches en License zijn uit de kolom.**
- **De instellingen zijn opnieuw ingericht.** Een kolom met negentien secties in
  drie groepen — wat je hebt gehaald, de voorkeuren zelf, en wat er over de app te
  lezen valt — naast één wit vlak met de sectie erin. De Bewaren-knop is weg: elke
  instelling legt zichzelf al meteen vast, dus de knop deed niets. Sluiten staat nu
  in de hoek van het vlak, met Esc eronder, en Esc werkt ook echt. De aan/uit-
  vakjes zijn schakelaars geworden.
- **Instellingen staan waar je ze zoekt.** Het thema staat bij Weergave, de map
  voor gesleepte mail bij Downloads, en wat een klik op een melding doet bij
  Meldingen in plaats van bij Algemeen. Bijwerken en "Wat is er nieuw" zijn eigen
  secties in plaats van blokken onder Over — het puntje dat zegt dat er een update
  klaarstaat, staat nu bij Bijwerken.
- **De standaard-mailclient is een schakelaar en geen knop.** Je kan hem nu ook
  weer uitzetten. Daarvoor claimde de app de mailto:-standaard bij elke start
  opnieuw, waardoor uitzetten geen zin had; dat doet hij niet meer. Wie de
  standaard al is blijft het — er wordt bij het opstarten niets weggehaald.
- **Nieuw: geminimaliseerd starten.** Bij Algemeen → Opstarten. De app komt dan op
  in de taakbalk in plaats van in beeld. Staat los van zelf opstarten, dus het
  werkt ook als je hem met de hand start.
- **Blocker en Unified Inbox zijn er weer uit**, nadat ze gebouwd waren: op verzoek
  volledig verwijderd, inclusief voorkeuren, kanalen en tests. Uit de Gmail-tab zijn
  het verbergen van het logo, de afwezigheidsbalk en de opslagknop ook weggehaald.
- **Verification Codes werkt, met één beperking.** De code wordt gelezen via de
  Gmail-API, dus alleen bij accounts die daarvoor gekoppeld zijn. Het naar de
  prullenbak verplaatsen en op gelezen zetten vraagt het recht `gmail.modify`, dat nu
  in de scopes staat — daardoor moet elk account eenmalig opnieuw toestemming geven.

### Opgelost
- **Hetzelfde label twee keer slepen lukte niet.** Na de eerste sleep bleef de
  labelnaam geselecteerd, en dan begon Chromium bij de volgende poging zijn eigen
  sleep van die selectie — waardoor de balk nooit verscheen. Alleen bij dat ene
  label, wat het extra verwarrend maakte.
- **Het "+"-menu liet Gmail verdwijnen.** Het menu werd in de app zelf getekend en
  moest daarvoor de mailweergave wegduwen. Het is nu een gewoon menu van Windows,
  dat er bovenop past, dus je postvak blijft staan.
- **Een label slepen duurde minuten.** De app bladerde daarvoor door Gmail's
  lijstweergave; nu vraagt hij het rechtstreeks op, vijf gesprekken tegelijk.

### Voor ontwikkelaars
- **Het commentaar in de code is teruggebracht van ruim 20% van alle regels naar
  3,8%.** De afspraak is nu: bovenaan een bestand staat één blok dat zegt waar het
  bestand voor is en welke valkuil er geldt, en daaronder staat geen enkele losse
  opmerking meer. Wat echt dragend is — Electron staat één webRequest-luisteraar per
  sessie toe, `getStartTime()` is secondes en geen milliseconden, Tailwind 3 heeft
  haakjes nodig bij een fractie-opacity — is naar die kop verhuisd in plaats van
  weggegooid. Alle koppen zijn Engels; `STRINGS_RENE` blijft Nederlands, want dat is
  de taal van de app in de Rene-stand en geen vergeten vertaling.
  Eén ding is er bij verloren: achter elk kanaal in `ipc.ts` stond een korte
  signatuur (`invoke()` met de vorm van het antwoord). Die staat nergens meer.
  De commit `f24dec1` heet "refactor(tests): enhance test descriptions" maar bevat
  in werkelijkheid deze hele opruiming over `electron/`, `renderer/` en `tests/`.
- `npm run dev` start alles met hot reload: wijzigingen in de zijbalk of de modal
  zijn direct zichtbaar, een nieuwe preload herlaadt alleen de Gmail-views, en
  alleen een wijziging in het main-proces herstart de app (automatisch).
- Push vraagt twee regels in `google-oauth.json` (`relayUrl`, `pushTopic`) en de
  relay uit `gmail-push-relay`. Zonder die regels blijft push uit en verandert er
  niets. `GMAIL_PUSH_RELAY_URL` en `GMAIL_PUSH_TOPIC` gaan voor, om tegen een
  lokale relay te testen.

### Added
- **A drop zone at the top of Gmail for keeping mail.** Start dragging a
  conversation out of your message list and a bar appears at the top. Drop it
  there and the app saves every message in that conversation as an `.eml` — the
  real original, headers and all — in its own folder per conversation. If you have
  several conversations ticked, they all come along. Each message also gets a line
  in `log.jsonl`: time, account, sender, recipients, subject, date, file path and
  the body as plain text. The bar then tells you how many messages were saved, or
  what went wrong. You pick the folder under Settings → General; the default is
  `Documents\Gmail Desktop\Mail`.
- **Dragging a whole label.** Drag a label from the left-hand navigation onto the
  bar and all the mail in it lands in one folder. At more than 200 conversations it
  stops, and says so in the summary and the log rather than truncating quietly.
- **After a drop a window appears** showing what was saved, over Gmail so your
  mailbox stays visible.
- **Ctrl+Shift+I** opens the devtools for the window you are working in.
- **Copying dragged mail to another account.** After a drop, pick which labels in
  which connected accounts the mail should go to. If a message is already there,
  nothing is written and the app asks first: add only the new ones, add everything,
  or nothing. Recognition uses the Message-ID from the header, so it works per
  label — if a mail is already in "Clients" but not in "Quotes", it lands only in
  the second.
- **Notifications and the unread count now come from Gmail itself** instead of
  being read off the page. Gmail reports a change, the app fetches what changed and
  counts unread conversations at the source. This needs one-time setup (your own
  relay and a Pub/Sub topic) and one re-authorisation per account. Accounts without
  that setup — and delegated mailboxes, which have no connection of their own —
  work exactly as before.
- **The account bar is now along the top** instead of in a column on the left, and
  doubles as the window's top edge. Each account is a tab with its name, its unread
  count and a line in its own colour. Right-click a tab for that account's calendar
  and other Google apps. The "+" sits after the last tab, the gear on the right.
- **Settings rearranged:** four parts beside a navigation column instead of five
  blocks stacked up. Which notifications you want per account now lives under
  Notifications, where one table shows you which account sounds off for what,
  instead of five switches per account. Accounts is about who takes part: the name,
  the colour, and removing one.

- **Every account loads its mailbox at startup.** You used to have to click the
  tabs one by one before the mail was there. Each account now loads its mailbox
  once at startup, in the background and off screen, so a tab is ready the moment
  you click it. The view is then allowed to rest again, so nothing stays warm all
  day taking up memory — a tab you click after a long while may still bring itself
  up to date.

### Changed
- **The settings tabs got their content, tab by tab.** Appearance (unread counts on
  or off, the tray icon, the window's minimum size), Downloads (where a download
  goes, ask first, open the folder — the app did not handle downloads at all until
  now), Phishing Protection (see the host
  before a link opens in your browser — where the link really goes, not the google.com
  redirect Gmail wraps around every link — with a trusted list that fills itself when
  you tick "always allow"), Updates, Advanced (hardware acceleration), Gmail (compose in
  its own window, and closing that window after sending), Google Apps (in the app or
  in the browser, a per-app exception, the account's name and colour on an app
  window), and under Notifications: sender and subject in a notification or not,
  sound, a test button, and what clicking a download notification does.
- **Accounts is a card now.** One card per account with the name, chips saying what
  you notice from that account, the colours, a pencil to rename and a bin to remove.
  Cards can be dragged to reorder, and "Add" sits at the top right.
- **Saved Searches and License are gone from the column.**
- **Settings have been laid out again.** A column of nineteen sections in three
  groups — what you have downloaded, the preferences themselves, and what there is
  to read about the app — beside a single white surface holding the section. The
  Save button is gone: every setting already writes itself the moment you change it,
  so the button did nothing. Closing now sits in the corner of that surface with Esc
  under it, and Esc really does close it. The on/off boxes are switches now.
- **Settings sit where you look for them.** The theme is under Appearance, the
  folder for dragged mail under Downloads, and what a click on a notification does
  under Notifications instead of General. Updates and What's New are their own
  sections rather than blocks under About — the dot that says an update is waiting
  now sits on Updates.
- **The default mail client is a switch, not a button.** You can turn it back off
  now. The app used to reclaim the mailto: default on every start, which made
  turning it off pointless; it no longer does. If you already are the default you
  stay it — nothing is removed at startup.
- **New: launch minimized.** Under General → Startup. The app comes up in the
  taskbar instead of on screen. Independent of launching at login, so it works when
  you start it by hand too.
- **Eleven sections are there but do nothing yet** (Download History, Blocker,
  Gmail, Google Apps, Languages, Phishing Protection, Saved Searches, Unified Inbox,
  Verification Codes, License, Advanced). They say there is nothing to set rather
  than pretending otherwise.

### Fixed
- **Dragging the same label twice did not work.** After the first drag the label's
  name stayed selected, so on the next attempt Chromium started its own drag of
  that selection and the bar never appeared. Only for that one label, which made it
  all the more puzzling.
- **The "+" menu made Gmail disappear.** The menu was drawn inside the app, which
  meant pushing the mail view out of the way first. It is now an ordinary Windows
  menu that sits on top, so your mailbox stays put.
- **Dragging a label took minutes.** The app used to page through Gmail's list
  view; it now asks for the mail directly, five conversations at a time.

## [0.2.9] — 2026-07-29

### Toegevoegd
- **Rechtermuisknop-menu voor kopiëren en plakken.** Selecteer je tekst en klik
  je met de rechtermuisknop, dan krijg je nu een menu met Kopiëren en "Zoek … op
  Google". In een invulveld (bijvoorbeeld het opstelvenster of de zoekbalk van
  Gmail) staan ook Ongedaan maken, Opnieuw, Knippen, Plakken en Plakken zonder
  opmaak. Op een link kun je de koppeling kopiëren of in je browser openen, en op
  een afbeelding kun je de afbeelding of de koppeling ervan kopiëren. Werkt in de
  hele app: de zijbalk, Gmail, Agenda en losse venstertjes.

### Opgelost
- **Een bijlage in een nieuw venster openen verving je postvak.** Koos je bij een
  pdf (of een ander bestand) "openen in een nieuw venster", dan werd de bijlage
  in het bestaande postvak geladen: je inbox verdween en er was geen weg terug.
  Bijlagen openen nu in je standaardbrowser, buiten de app.

### Added
- **Right-click menu for copying and pasting.** Select text and right-click to
  get a menu with Copy and "Search Google for …". In an editable field (Gmail's
  compose window or search box, for instance) it also offers Undo, Redo, Cut,
  Paste and Paste without formatting. On a link you can copy the address or open
  it in your browser, and on an image you can copy the image or its address.
  Works throughout the app: the sidebar, Gmail, Calendar and pop-out windows.

### Fixed
- **Opening an attachment in a new window replaced your mailbox.** Choosing
  "open in a new window" for a PDF (or any other file) loaded the attachment into
  the existing mail view: the inbox disappeared with no way back. Attachments now
  open in your default browser, outside the app.

## [0.2.8] — 2026-07-15

### Toegevoegd
- **Meldingsgeluid per account aan/uit.** In Instellingen → Accounts heeft elke
  postbus nu een "Geluid"-vinkje. Zet je het uit, dan blijven de meldingen van
  die postbus gewoon zichtbaar op je bureaublad, maar zonder geluid. Handig voor
  bijvoorbeeld een gedeelde (gedelegeerde) postbus waarvan je de meldingen wel
  wilt zien maar niet wilt horen. Staat standaard aan, en werkt los van het
  cijfer op de taakbalk en van "Niet storen".

### Added
- **Per-account notification sound on/off.** In Settings → Accounts each mailbox
  now has a "Sound" checkbox. Turn it off and that mailbox's notifications still
  appear on your desktop, just without a sound. Handy for, say, a shared
  (delegated) mailbox whose notifications you want to see but not hear. On by
  default, and independent of the taskbar badge and of Do Not Disturb.

## [0.2.7] — 2026-07-15

### Opgelost
- **Het taakbalk-cijfer bleef hangen.** Het aantal ongelezen berichten op het
  app-icoon bleef soms op een oud getal staan, ook nadat alles gelezen was —
  bijvoorbeeld na het vernieuwen van een gedeelde postbus. Het cijfer klopt nu
  weer en verdwijnt zodra er niets ongelezen is.
- **Inloggen of verifiëren opende geen venster.** In plaats van een
  inlogvenster verscheen soms een Windows-melding ("Download een app om deze
  koppeling te openen"). Het inlogvenster opent nu gewoon, zodat je kunt
  inloggen en verifiëren.

### Fixed
- **The taskbar badge count got stuck.** The unread count on the app icon
  sometimes stayed on an old number even after everything was read — for
  example after a shared mailbox refreshed. The count is now correct again and
  clears as soon as nothing is unread.
- **Logging in or verifying opened no window.** Instead of a login window, a
  Windows dialog sometimes appeared ("Download an app to open this link"). The
  login window now opens as expected, so you can log in and verify.

## [0.2.6] — 2026-07-13

### Opgelost
- **Account verwijderen deed niets.** Klikken op "Weg ermee" bij een account in
  de instellingen had geen effect meer: het account bleef gewoon in de lijst
  staan. Verwijderen werkt nu weer, en het account blijft ook na een
  herdetectie verborgen.

### Fixed
- **Removing an account did nothing.** Clicking "Remove" on an account in
  settings no longer had any effect: the account simply stayed in the list.
  Removal works again, and the account also stays hidden after re-detection.

## [0.2.5] — 2026-07-10

### Opgelost
- **"Volledig bericht weergeven" opende in hetzelfde venster.** Bij een
  ingekort bericht opende de link "Volledig bericht weergeven" de volledige
  tekst in hetzelfde venster, waarna je niet meer terug kon naar je inbox. De
  link opent nu in een apart venster, net als in de browser.

### Fixed
- **"View entire message" opened in the same window.** On a clipped email, the
  "View entire message" link loaded the full text into the same window, leaving
  no way back to your inbox. It now opens in a separate window, as it does in the
  browser.

## [0.2.4] — 2026-07-10

### Toegevoegd
- **Melding bij een nieuwe update.** Zodra er een nieuwe versie klaarstaat, krijg
  je een melding op je bureaublad. Klik erop en de app opent meteen bij de
  update-instellingen, waar je de update kunt downloaden en installeren. De app
  kijkt nu ook elke 30 minuten of er een update is (voorheen alleen bij het
  opstarten).

### Opgelost
- **Achtergebleven getal in de taakbalk.** Had je al je post gelezen, dan bleef
  er soms nog een ongelezen-getal op het app-icoon in de taakbalk staan totdat je
  de app opnieuw opende of er nieuwe post binnenkwam. Het getal verdwijnt nu
  meteen zodra er niets meer ongelezen is.

### Added
- **Update-available notification.** When a new version is ready, you get a
  desktop notification. Click it and the app opens straight to the update
  settings, where you can download and install the update. The app now also
  checks for an update every 30 minutes (previously only at launch).

### Fixed
- **Stale taskbar badge.** After you'd read all your mail, the app icon in the
  taskbar sometimes kept showing an unread number until you reopened the app or
  new mail arrived. The number now clears immediately once nothing is unread.

## [0.2.3] — 2026-07-09

### Toegevoegd
- **Badge-teller per account aan/uit.** In Instellingen → Accounts heeft elk
  account nu een "Badge"-vinkje. Zet je het uit, dan telt de ongelezen post van
  dat account niet meer mee in het getal op het app-icoon in de taakbalk.
  Standaard staat het aan (net als voorheen). Dit verandert alleen het
  taakbalk-getal — meldingen en de teller in de zijbalk blijven gewoon werken.

### Added
- **Per-account taskbar badge toggle.** In Settings → Accounts, each account now
  has a "Badge" checkbox. Turn it off and that account's unread mail no longer
  counts toward the number on the taskbar app icon. Default is on (unchanged
  from before). This only affects the taskbar count — notifications and the
  sidebar unread counter keep working as usual.

## [0.2.2] — 2026-07-09

### Toegevoegd
- **Gedelegeerde postvakken.** Postvakken die een ander account aan jou heeft
  gedelegeerd (Gmails "toegang delegeren") verschijnen nu als eigen account in
  de zijbalk. De app herkent gedelegeerde postvakken waar je al toegang toe hebt
  en stelt ze voor; je kunt ze toevoegen of verwijderen, en ze worden onthouden
  na een herstart. Elk postvak heeft zijn eigen ongelezen-teller en meldingen,
  net als een gewoon account.

### Opgelost
- **Inloggen met een Workspace-account dat via Microsoft gaat, werkt nu.** Gaat
  het inloggen van je Google Workspace-domein via Microsoft (Entra ID /
  Office 365), dan mislukte het toevoegen van het account eerder met de melding
  "AADSTS900561: The endpoint only accepts POST requests". De app stuurde de
  Microsoft-inlogstap naar je browser als het verkeerde soort verzoek; nu blijft
  het inloggen in de app zelf, zodat het gewoon lukt.

### Added
- **Delegated mailboxes.** Mailboxes another account has delegated to you
  (Gmail's "delegate access") now appear in the sidebar as their own account.
  The app detects delegated mailboxes you already have access to and suggests
  them; you can add or remove them, and they're remembered across restarts. Each
  has its own unread badge and notifications, just like a regular account.

### Fixed
- **Signing in with a Microsoft-federated Workspace account now works.** If your
  Google Workspace domain signs in through Microsoft (Entra ID / Office 365),
  adding the account previously failed with "AADSTS900561: The endpoint only
  accepts POST requests". The app was handing the Microsoft sign-in step to your
  browser as the wrong kind of request; it now keeps the sign-in inside the app
  so it completes normally.

## [0.2.1] — 2026-07-08

### Toegevoegd
- **Google-apps per account** — naast Mail en Agenda opent elk account nu ook
  Drive, Documenten, Spreadsheets, Presentaties, Keep, Contacten en Chat in de
  app. Onder de agendaknop zit een nieuw rasterknopje dat de apps van dat
  account uitklapt.
- Links naar deze Google-apps (bijvoorbeeld een Documenten-link in een e-mail)
  openen nu in de app zelf, in het juiste onderdeel, in plaats van in de
  externe browser. De nieuwe onderdelen sturen geen meldingen.

### Added
- **Google apps per account** — next to Mail and Calendar, each account can now
  open Drive, Docs, Sheets, Slides, Keep, Contacts and Chat inside the app. A
  new grid button under the calendar button expands that account's apps.
- Links to these Google apps (e.g. a Docs link in an email) now open inside the
  app, in the right section, instead of in the external browser. The new
  sections don't send notifications.

## [0.2.0] — 2026-07-08

### Added
- **The tray icon's right-click menu can now do more:**
  - **Snooze notifications** — for 10, 30 or 60 minutes, or "until I turn them
    back on". The menu shows when notifications will resume; a timed snooze
    clears itself when it expires, and "Turn notifications on" lifts it
    immediately.
  - **Check for updates** straight from the tray. It brings the window forward,
    opens Settings, and once the check finishes shows a small popup: a newer
    version is available (with a Download button), you're already on the latest
    version, or the check couldn't be completed.
  - **Start at login** — a checkbox kept in sync with the same setting in
    Settings.

### Toegevoegd
- **In het kleine menu (rechtsklik op het plaatje onderin je scherm) kun je nu
  meer doen:**
  - **Even geen piepjes.** Kies 10, 30 of 60 minuten stil, of "totdat ik ze weer
    aanzet". Het menu laat zien tot hoe laat het stil blijft. Is de tijd om? Dan
    komen de piepjes vanzelf weer terug. Wil je ze eerder terug? Klik op "Piepjes
    weer aan".
  - **Kijken of er iets nieuws is.** De app kijkt of er een nieuwere versie is.
    Het venster komt naar voren en de instellingen gaan open. Is er iets nieuws?
    Dan kun je op de knop klikken om het op te halen. Is alles al goed? Dan zegt
    de app dat. Lukt het kijken niet? Dan zegt de app dat ook.
  - **Vanzelf opstarten.** Zet dit vinkje aan. Dan gaat de app vanzelf aan als je
    de computer aanzet.

## [0.1.9] — 2026-07-08

### Opgelost
- Herinneringen uit Google Agenda komen nu ook echt binnen als melding op je
  computer. Eerst stuurde de agenda die herinneringen op een manier weg die de
  app niet kon laten zien, dus zag je ze niet. Nu laat de app ze wel zien. Ze
  luisteren netjes naar je instellingen: staat "niet storen" of de stille uren
  aan, of heb je agenda-meldingen voor dat account uitgezet, dan blijft het
  stil. Klik je op zo'n herinnering, dan gaat de agenda van dat account open.

### Fixed
- Google Calendar reminders now actually show up as desktop notifications.
  Previously the calendar sent them in a way the app could not display, so you
  never saw them. They now respect your settings: if Do Not Disturb or quiet
  hours are on, or you have turned off Calendar notifications for that account,
  they stay silent. Clicking a reminder opens that account's calendar.

## [0.1.8] — 2026-07-08

### Added
- Choose how clicking a notification opens its message or event: **in the app**
  (default — brings the window forward and opens it in place) or **in a new
  window**. Setting lives under General.
- Settings now has a **Save** button and a "Saved ✓" confirmation. All controls
  still apply instantly; Save additionally commits an in-progress name edit and
  confirms everything was stored.

### Fixed
- Clicking a notification while the app is minimized now restores and focuses
  the window (with "Open in the app"), instead of leaving it minimized behind a
  stray window.
- Clicking a notification no longer opens **two** windows in "Open in a new
  window" mode (the app's own open and Gmail's follow-up popup both fired).
- Account name edits now also save on Enter, and the quiet-hours time fields no
  longer lose their value while you're typing a new time.
- **Clicking a mail notification now opens the clicked message**, not just the
  account's inbox. The "When you click a notification" setting now works as
  intended: *in the app* opens the message in place, *in a new window* opens it
  in Gmail's focused pop-out reading window (just the message, without the
  sidebar/search chrome). (Gmail's notifications carry no message reference and
  its own click handler does nothing inside the wrapper, so the app resolves the
  message from the notification's subject and triggers Gmail's own pop-out; if
  that button can't be found it falls back to a full thread window.)
- The app no longer crashes ("Cannot read properties of undefined") after a
  Google page inside a view closes itself, e.g. Gmail's pop-out compose after
  sending. Dead views are now cleaned up.
- Fixed a crash on quit ("Object has been destroyed") when views were torn down
  after the main window had already closed.
- Fixed a crash ("Object has been destroyed") when clicking a notification after
  the main window had been closed/torn down — the click now rebuilds the window
  and brings the app back instead of failing silently.
- Clicking a notification no longer triggers Gmail's "pop-up blocked" warning
  (the app opens the message itself and hands Gmail's follow-up popup a
  harmless stub instead of a blocked-looking null window).

## [0.1.7] — 2026-07-07

### Fixed
- Links clicked inside an email now open in your default browser instead of
  loading inside the mail view. Gmail, Calendar and Google sign-in navigation
  still stay in the app.

## [0.1.6] — 2026-07-07

### Fixed
- Per-account notification toggles in Settings now reflect the stored state and
  respond to clicks. Previously a toggle could show "on" while notifications for
  that account were actually muted, and toggling it had no effect (the settings
  UI was not kept in sync after a change).

### Added
- **Calendar reminders.** Google Calendar's own event reminders can now appear as
  desktop notifications, enabled per account (opt-in). They respect the global
  Do Not Disturb switch and quiet hours, and clicking a reminder opens that
  account's calendar. No calendar data is read — Google Calendar fires the
  reminders itself from a background view.
- Each account row in Settings now has separate **Mail** and **Calendar**
  notification toggles.

## [0.1.5] — 2026-07-06

### Added
- Launch at login (optional) and remembered window size/position.
- Per-account notifications with a global Do Not Disturb switch and quiet hours.
- Clicking a notification restores the window and switches to the right account.
- Drag to reorder accounts in the sidebar, and custom per-account labels.
- Keyboard shortcuts: Ctrl+1–9 to switch accounts, Ctrl+N to compose.
- Per-account zoom (Ctrl +/−/0), remembered across sessions.
- Light and dark theme for the app shell, following the system with a manual
  override.
- Google Calendar logo for the calendar button; removed the dark frame around
  the Gmail view.

## [0.1.1] – [0.1.4]

Initial Gmail Desktop wrapper: multi-account sidebar with avatars and unread
badges, per-account calendar, desktop notifications, tray with minimize-to-tray,
single-instance, account add/remove, and auto-update from GitHub Releases.
