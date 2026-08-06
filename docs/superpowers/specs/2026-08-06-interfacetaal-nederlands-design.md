# Interfacetaal: Nederlands erbij, met een keuze

Datum: 2026-08-06

## Waarom

De app heeft ruim 220 stringsleutels in twee sets: `STRINGS_NORMAL` (Engels) en
`STRINGS_RENE`. Die tweede is Nederlands, maar bewust kindertaal — de kop van
`renderer/app/strings.ts` zegt "short words a four-year-old can understand" — en de
Rene-stand doet meer dan taal: hij zoomt de hele UI (`RENE_ZOOM_FACTOR`) en wisselt
de contextmenu-labels.

Er is dus geen normaal Nederlands en geen taalinstelling. Een Nederlandse gebruiker
krijgt een Engels instellingenpaneel, of moet de Rene-stand aanzetten en neemt dan
kindertaal én een uitvergrote interface op de koop toe.

De sectie Talen die in `ff8804f` is weggehaald ging over woordenboeken voor de
spellingcontrole, niet over de taal van de interface. Dit voegt dus niets terug wat
toen bewust is geschrapt. De lijn uit die commit — "spelling volgt de systeemtaal" —
wordt hier juist doorgetrokken naar de interface.

## Beslissingen

**1. Een derde stringset, geen hergebruik van Rene.**
`STRINGS_NL` komt erbij met normaal, zakelijk Nederlands. De Rene-stand blijft
precies zoals hij is en overstemt de taalkeuze: staat Rene aan, dan zie je Rene's
taal en zoom, wat de taalinstelling ook zegt. Rene is een leesbaarheidsstand, geen
taal, en die twee moeten niet in elkaar schuiven.

**2. De pref krijgt de vorm die `theme` al heeft.**

```ts
language: 'system' | 'en' | 'nl'   // standaard 'system'
```

In `electron/prefs-store.ts`: het veld in het type, `'system'` in de defaults,
validatie in de raw-parser (een prefs-bestand van een oudere versie heeft de sleutel
niet en valt dan terug op `'system'`), en een `setLanguage`.

**3. Het oplossen is een pure functie.**

Nieuw bestand `electron/locale.ts`:

```ts
export type LanguagePref = 'system' | 'en' | 'nl';
export type Locale = 'en' | 'nl';
export function resolveLocale(pref: LanguagePref, systemLocale: string): Locale;
```

Regel: bij `'system'` is het `'nl'` als `systemLocale` met `nl` begint
(hoofdletterongevoelig, dus `nl`, `nl-NL` en `nl-BE` doen allemaal mee), anders
`'en'`. Bij `'en'` of `'nl'` is dat het antwoord, ongeacht de systeemtaal. Geen
Electron-afhankelijkheid, dus los te testen.

De systeemtaal komt uit `app.getLocale()`.

**4. Eén bron van waarheid: main rekent de taal uit.**
`main.ts` bepaalt de taal en stuurt hem mee in het bestaande `prefs:changed`-bericht.
De renderer krijgt dus een kant-en-klare `locale` binnen en rekent zelf niets uit.
Dit kost één afgeleide waarde in een verder pure prefs-payload; dat is de prijs voor
het alternatief te vermijden, waarbij main en renderer allebei `'system'` oplossen en
uiteen kunnen lopen — met een Nederlandse UI naast een Engels contextmenu als gevolg.

Nieuw IPC-kanaal `SET_LANGUAGE` (renderer → main), plus `setLanguage` in
`sidebar-preload.ts` en op `window.desktop`.

**5. `getStrings` krijgt de taal erbij.**

```ts
export function getStrings(locale: Locale, reneMode: boolean): UiStrings;
// rene wint → STRINGS_RENE; anders 'nl' → STRINGS_NL; anders STRINGS_NORMAL
```

Idem voor de twee kleinere kaarten in hetzelfde bestand: `CATEGORY_NL` (5 sleutels)
en `COLOR_NL` (6). `COLOR_NL` krijgt dezelfde woorden als `COLOR_RENE` — "Blauw",
"Rood", "Groen", "Geel", "Paars", "Turkoois" zijn gewoon Nederlands, daar valt niets
te verbeteren. `CATEGORY_RENE` is wél kindertaal ("Gemaakt", "Weg"); `CATEGORY_NL`
wordt "Toegevoegd", "Opgelost", "Gewijzigd", "Verwijderd", "Beveiliging".

**6. Ook buiten de renderer.**
`LABELS_NL` in `electron/context-menu.ts`, in normaal Nederlands — dus "Ongedaan
maken" en "Opnieuw", niet Rene's "Terug" en "Toch weer". `main.ts` kiest op taal, en
Rene wint ook hier.

De drie vaste Engelse teksten in `chooseComposeAccount` (`'New message'`,
`'Send from which account?'`, `'Cancel'`) verhuizen naar een nieuw
`electron/native-labels.ts` met de drie varianten. Daarna staat er geen Engelse
gebruikerstekst meer in `main.ts`.

**7. De instelling staat in Weergave, onder Thema.**
Een `<select>` volgens exact het patroon van `AppearanceSection.tsx:22-31`, met de
opties Systeem / English / Nederlands. Geen nieuwe tab: dat zou verwarren met de
Talen-sectie die net is weggehaald.

Nieuwe sleutels in alle drie de sets: `language`, `languageDescription`,
`languageSystem`, `languageEnglish`, `languageDutch`.

**8. Tests.**
`tests/locale.test.ts` voor `resolveLocale`: de drie prefs-waarden, `nl`, `nl-NL`,
`nl-BE`, `en-US`, `de-DE`, rare invoer, en dat een expliciete keuze de systeemtaal
overstemt.

Belangrijker is een pariteitstest: de sleutelverzamelingen van `STRINGS_NORMAL`,
`STRINGS_RENE` en `STRINGS_NL` moeten identiek zijn, en hetzelfde voor de drie
`CATEGORY_*`-kaarten, de drie `COLOR_*`-kaarten en de drie sets contextmenu-labels.
Dat is het vangnet: mis ik één vertaling, dan valt de suite om in plaats van dat er
stil Engels in een Nederlandse interface blijft staan.

## Wat er niet in zit

- **Gmail zelf.** Dat is een webview en volgt de taal van je Google-account.
- **Meer talen dan Engels en Nederlands.** De opzet laat een derde taal toe, maar er
  komt er nu geen bij.
- **Taal per account.** Eén taal voor de hele app.
- **De CHANGELOG vertalen.** Die heeft al een Nederlandse en een Engelse helft.
- **Rene's woordkeuze of zoom aanpassen.** De Rene-stand blijft ongemoeid.
- **Losse Engelse tekst in loggen en foutmeldingen die niet op het scherm komen.**
  Alleen wat de gebruiker ziet, wordt vertaald.
