# Instellingenpaneel opnieuw ontworpen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Het instellingenpaneel wordt een navigatiekolom links met vier secties rechts, in plaats van vijf secties op één lange scrollpagina.

**Architecture:** `SettingsPanel.tsx` (700 regels: staat, IPC, opmaak en alle vijf secties) wordt gesplitst. Het houdt de staat, de IPC en het Rene-easteregg en rendert een schil; de schil bevat de navigatie en één sectie tegelijk; elke sectie is een eigen bestand; en één rij-primitief geeft alle instellingen dezelfde vorm.

**Tech Stack:** Next.js (renderer), React, Tailwind, vitest.

## Global Constraints

- Nederlands in commentaar; Engelse identifiers. Commentaar legt *waarom* uit, niet *wat*.
- **Elke gebruikerstekst komt uit `getStrings()`** in `renderer/app/strings.ts`, met een Engelse standaardset en een Nederlandse Rene-set. Geen enkele letterlijke tekst in een component.
- Bestaande gedragingen die niet mogen sneuvelen: het Rene-easteregg (`advanceReneSequence` op een toetsreeks), `isCompleteTime` als poort voor stille uren, de opslaan/opgeslagen-indicator, en elke IPC-aanroep die er nu is.
- Tests draaien onder vitest zonder DOM. Opmaak wordt niet getest; pure logica wel.
- `npm run build` werkt niet zolang de dev-server draait (EPERM op `renderer/.next/trace`). Gebruik `npx tsc --noEmit -p renderer/tsconfig.json` en `npm test`.

### Afwijking van de gebruikelijke planvorm

Dit plan schrijft **geen letterlijke JSX voor**. Voor logica staat de code er wel volledig in. De reden: in de vorige verbouwing zat mijn voorgeschreven opmaak twee fouten die de uitvoerders moesten repareren — een breedte-reserve die niet klopte en een Tailwind-klasse die niet bestaat. Een uitvoerder met de tokens en de eisen hieronder doet dat beter dan een transcriptie van mijn eerste gok. Wat wél bindend is: de tokens, de eisen per sectie, en de tekstsleutels.

---

## Ontwerprichting

**Waarom monochroom.** Dit is een instellingenoppervlak in een mailclient. Het hoort terug te treden — je komt hier om iets te veranderen en weer weg te gaan. Er is precies één kleur in dit paneel die iets betekent: **de kleur die de gebruiker zelf aan een account gaf.** Die laten we werken; al het andere is grijs. Dat is de hele kleurbeslissing, en hij is af te dwingen: staat er ergens anders een tint, dan is dat een fout.

| Rol | Licht | Donker |
|---|---|---|
| Vlak | `neutral-100` | `neutral-950` |
| Kaart | `white` | `neutral-900` |
| Haarlijn | `black/8` | `white/8` |
| Tekst | `neutral-900` | `neutral-100` |
| Bijtekst | `neutral-500` | `neutral-500` |
| Accent (één actie) | `blue-600` | `blue-600` |
| Identiteit | de accountkleur | de accountkleur |

Het vlak is dezelfde `neutral-100`/`neutral-950` als de topbar, zodat paneel en balk één oppervlak zijn en er geen naad zit waar de balk ophoudt.

**Typografie: geen nieuw font.** Een display-letter in een instellingenpaneel zou zichzelf aankondigen, en dat is precies wat dit oppervlak niet moet doen. In plaats daarvan een strakke schaal, en één echte keuze: **getallen die data zijn krijgen `tabular-nums`** — het versienummer, de tijden van de stille uren, het aantal ongelezen. Die staan dan stil in plaats van te dansen als ze veranderen.

| Rol | Grootte / gewicht |
|---|---|
| Sectietitel | 20px / 600, `tracking-tight` |
| Rijlabel | 13.5px / 500 |
| Rijbijtekst | 12px / 400, bijtekstkleur |
| Navigatie-item | 13px / 500 |
| Data | `tabular-nums` |

**Indeling.**

```
┌──────────────┬─────────────────────────────────────────────┐
│ Instellingen │  Accounts                                   │
│              │                                             │
│ Algemeen     │  ┃ ● luca@…            [label]      [×]     │
│ Meldingen  · │  ┃   Mail  Agenda  Badge  Geluid  Blijven   │
│ Accounts     │                                             │
│ Over       · │  ┃ ● support@…         [label]      [×]     │
│              │  ┃   Mail  Agenda  Badge  Geluid  Blijven   │
│              │                                             │
│  208px       │  max-w-[720px]                              │
└──────────────┴─────────────────────────────────────────────┘
```

De kolom is 208px en scrollt niet; de inhoud scrollt en is afgekapt op 720px, zodat een rij op een breed venster niet meters uitrekt en het oog de controls rechts blijft vinden.

**De signature: een kleurrug van 3px op elke accountkaart.** Dezelfde taal als het actieve tabblad in de topbar, dat ook een streepje van 3px in de accountkleur draagt. Kleur betekent in deze app één ding — *welk account* — en dat geldt dan op beide oppervlakken. Het is geen versiering: het is de enige plek waar de gebruiker zijn eigen kleurkeuze terugziet en kan wijzigen.

**Het risico dat ik neem, en waarom.** De navigatie draagt **een puntje op een sectie die aandacht vraagt**: bij Meldingen als niet-storen aanstaat, bij Over als er een update klaarstaat. Dat is de enige informatie die je over een instellingenpaneel wil weten zonder het te openen — "staat er iets uit dat ik aan dacht te hebben". Het is structuur die iets waars zegt, niet decoratie, en het is de reden dat de navigatiekolom meer is dan vijf woorden onder elkaar.

**Wat er niet in komt.** Geen zoekveld: vier secties met samen twintig instellingen zijn sneller te overzien dan te doorzoeken. Geen accordeons: een sectie past op een scherm. Geen animatie bij het wisselen van sectie: je wisselt hier één keer per bezoek en een overgang maakt dat langzamer, niet mooier.

---

## File Structure

**Nieuw**

| Bestand | Verantwoordelijkheid |
|---|---|
| `renderer/app/settings/nav.ts` | Puur: welke secties er zijn en welke een aandachtspunt heeft. |
| `renderer/app/settings/SettingRow.tsx` | Het rij-primitief: naam, bijtekst, control rechts, haarlijn. |
| `renderer/app/settings/SettingsShell.tsx` | Kop, navigatiekolom, inhoudsgebied. Kent de secties niet inhoudelijk. |
| `renderer/app/settings/GeneralSection.tsx` | Opstarten, standaard mailclient, thema, waar meldingen openen, dropmap. |
| `renderer/app/settings/NotificationsSection.tsx` | Niet storen, stille uren. |
| `renderer/app/settings/AccountsSection.tsx` | De accountkaarten met hun vijf schakelaars. |
| `renderer/app/settings/AboutSection.tsx` | Versie, updates, changelog. |

**Aangepast**

| Bestand | Wijziging |
|---|---|
| `renderer/app/SettingsPanel.tsx` | Wordt dun: staat, IPC, Rene-easteregg, rendert de schil. |
| `renderer/app/strings.ts` | Sectienamen en rijbijteksten erbij, in beide sets. |

`renderer/app/settings-utils.ts` blijft ongewijzigd en houdt zijn tests.

---

### Task 1: nav — de secties en hun aandachtspunt

**Files:**
- Create: `renderer/app/settings/nav.ts`
- Test: `tests/settings-nav.test.ts`

**Interfaces:**
- Consumes: niets.
- Produces:
  - `type SettingsSection = 'general' | 'notifications' | 'accounts' | 'about'`
  - `SETTINGS_SECTIONS: readonly SettingsSection[]` in weergaveorde
  - `interface AttentionInput { dnd: boolean; dndUntil?: number; updateReady: boolean }`
  - `needsAttention(section: SettingsSection, input: AttentionInput): boolean`

- [ ] **Step 1: Write the failing test**

`tests/settings-nav.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SETTINGS_SECTIONS, needsAttention } from '../renderer/app/settings/nav';

const quiet = { dnd: false, updateReady: false };

describe('SETTINGS_SECTIONS', () => {
  // Algemeen eerst omdat je daar het vaakst komt; Over laatst omdat je daar
  // alleen komt als je iets zoekt.
  it('lists the four sections in display order', () => {
    expect(SETTINGS_SECTIONS).toEqual(['general', 'notifications', 'accounts', 'about']);
  });
});

describe('needsAttention', () => {
  it('marks nothing when everything is as expected', () => {
    for (const s of SETTINGS_SECTIONS) expect(needsAttention(s, quiet)).toBe(false);
  });

  // Dit is het hele punt van de puntjes: je wil zien dat je meldingen uit staan
  // zonder de sectie te openen, want dat is precies wat je zou vergeten.
  it('marks notifications while do-not-disturb is on', () => {
    expect(needsAttention('notifications', { ...quiet, dnd: true })).toBe(true);
  });

  it('marks notifications while a timed snooze is still running', () => {
    expect(needsAttention('notifications', { ...quiet, dndUntil: 1 })).toBe(true);
  });

  it('marks about when an update is waiting to be installed', () => {
    expect(needsAttention('about', { ...quiet, updateReady: true })).toBe(true);
  });

  it('does not mark a section for another section\'s reason', () => {
    expect(needsAttention('general', { dnd: true, updateReady: true })).toBe(false);
    expect(needsAttention('accounts', { dnd: true, updateReady: true })).toBe(false);
    expect(needsAttention('notifications', { ...quiet, updateReady: true })).toBe(false);
    expect(needsAttention('about', { ...quiet, dnd: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings-nav.test.ts`
Expected: FAIL — module bestaat niet.

- [ ] **Step 3: Write minimal implementation**

`renderer/app/settings/nav.ts`:

```ts
// De secties van het instellingenpaneel, en of er een aandachtspunt op staat.
// Puur, want dit is de enige logica in het paneel die niet over opmaak gaat.
export type SettingsSection = 'general' | 'notifications' | 'accounts' | 'about';

// Weergaveorde: Algemeen eerst omdat je daar het vaakst komt, Over laatst omdat
// je daar alleen komt als je iets zoekt.
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  'general',
  'notifications',
  'accounts',
  'about',
];

export interface AttentionInput {
  dnd: boolean;
  dndUntil?: number;
  updateReady: boolean;
}

// Een puntje in de navigatie betekent: hier staat iets dat je waarschijnlijk
// wilde weten zonder ernaar te zoeken. Alleen twee gevallen halen die lat —
// je meldingen staan uit (het ding dat je vergeet dat je het aanzette) en er
// staat een update klaar. Al het andere is een voorkeur, niet nieuws.
export function needsAttention(section: SettingsSection, input: AttentionInput): boolean {
  if (section === 'notifications') return input.dnd || (input.dndUntil ?? 0) > 0;
  if (section === 'about') return input.updateReady;
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/settings-nav.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add renderer/app/settings/nav.ts tests/settings-nav.test.ts
git commit -m "feat: secties van de instellingen en hun aandachtspunt"
```

---

### Task 2: SettingRow en SettingsShell

**Files:**
- Create: `renderer/app/settings/SettingRow.tsx`
- Create: `renderer/app/settings/SettingsShell.tsx`

**Interfaces:**
- Consumes: `SettingsSection`, `SETTINGS_SECTIONS`, `needsAttention` uit `renderer/app/settings/nav.ts` (Task 1).
- Produces:
  - `SettingRow(props: { label: string; description?: string; children: ReactNode; htmlFor?: string })` — `children` is de control rechts.
  - `SettingsShell(props: { title: string; sectionLabel(s: SettingsSection): string; active: SettingsSection; onSelect(s: SettingsSection): void; attention: AttentionInput; saved: boolean; onSave(): void; onClose(): void; saveLabel: string; savedLabel: string; closeLabel: string; banner?: ReactNode; children: ReactNode })`

**Eisen aan `SettingRow`:**
- Naam links op 13.5px/500, optionele bijtekst eronder op 12px in de bijtekstkleur, control rechts, verticaal gecentreerd.
- Een haarlijn onder elke rij behalve de laatste. Los dat met een `divide-y` op de container in de sectie, niet met een rand per rij — dan hoeft de rij niet te weten of hij de laatste is.
- Als `htmlFor` is gegeven is het label een `<label>` en klikt de naam de control aan; anders een `<div>`. Een schakelaar hoort aanklikbaar te zijn door op zijn naam te klikken.
- Rij is minstens 44px hoog zodat een rij met en zonder bijtekst niet verspringt.

**Eisen aan `SettingsShell`:**
- Vlak in de vlakkleur, volledige hoogte van het gebied dat het krijgt, `flex`.
- Kop met de titel op 20px/600 `tracking-tight`, en rechts de opslaan-knop (of de opgeslagen-melding) en de sluitknop. De kop scrollt niet mee.
- Navigatiekolom 208px, niet scrollend, haarlijn aan de rechterkant. Elk item 13px/500, actief item met een gevuld vlak in de kaartkleur. Een sectie met een aandachtspunt krijgt een puntje van 6px rechts in het item, in `blue-600`.
- Inhoudsgebied scrollt, `max-w-[720px]`, `px-8 py-7`.
- `banner` is een optionele strook onder de kop over de volle breedte (nu gebruikt voor de Rene-melding).
- Navigatie is met het toetsenbord te bedienen: pijltjes omhoog en omlaag wisselen van sectie, en het actieve item is zichtbaar gefocust.

**Geen tests:** dit is opmaak. De logica die het toont (`needsAttention`) is in Task 1 getest.

- [ ] **Step 1: Write both components**

Volg de eisen hierboven en de tokens uit de Ontwerprichting. Elke tekst komt binnen als prop — geen letterlijke tekst in deze bestanden.

- [ ] **Step 2: Verify the renderer compiles**

Run: `npx tsc --noEmit -p renderer/tsconfig.json`
Expected: schoon. De componenten zijn nog ongebruikt; dat mag.

- [ ] **Step 3: Commit**

```bash
git add renderer/app/settings/SettingRow.tsx renderer/app/settings/SettingsShell.tsx
git commit -m "feat: rij-primitief en schil voor de instellingen"
```

---

### Task 3: De vier secties

**Files:**
- Create: `renderer/app/settings/GeneralSection.tsx`
- Create: `renderer/app/settings/NotificationsSection.tsx`
- Create: `renderer/app/settings/AccountsSection.tsx`
- Create: `renderer/app/settings/AboutSection.tsx`
- Modify: `renderer/app/strings.ts`

**Interfaces:**
- Consumes: `SettingRow` uit Task 2; `isCompleteTime` uit `renderer/app/settings-utils.ts`; de types `Prefs` uit `renderer/app/page.tsx` en `ChangelogVersion` uit `renderer/app/changelog-types.ts`.
- Produces: vier componenten die elk hun eigen deel van de huidige `SettingsPanel.tsx` overnemen, met de callbacks die dat bestand nu al doorgeeft.

**Werkwijze.** Lees `renderer/app/SettingsPanel.tsx` en verplaats per sectie wat er nu staat. Elke instelling die er nu is moet er nog zijn, met dezelfde callback en dezelfde poort erop. Verzin geen nieuwe instellingen en laat er geen vallen; noem in je rapport per sectie welke instellingen erin zitten, zodat te controleren is dat het er evenveel zijn.

**Per sectie, wat erin hoort en wat de eisen zijn:**

*GeneralSection* — starten bij inloggen (schakelaar), standaard mailclient (status plus een knop die hem opeist), thema (drie keuzes), waar een melding opent (twee keuzes), en de map waar gesleepte mail landt (pad plus twee knoppen: kiezen en openen). Het pad is data: `tabular-nums` en afkappen aan het begin, want het einde van een pad zegt meer dan het begin.

*NotificationsSection* — niet storen (schakelaar) en stille uren (schakelaar plus twee tijdvelden). De tijdvelden schrijven alleen door als `isCompleteTime` waar is; dat is er niet voor de sier, want Chromium vuurt tussentijds een leeg veld. Zet de twee tijden op één rij met `tabular-nums`, en maak ze uitgeschakeld als stille uren uit staan in plaats van ze te verbergen — dan verspringt de sectie niet.

*AccountsSection* — een kaart per account met een kleurrug van 3px in de accountkleur langs de linkerrand. In de kaart: de avatar (of de eerste letter als er geen is), een veld om het label te typen, het e-mailadres eronder als bijtekst, een kleurkiezer met de bestaande zes tinten, en een verwijderknop. Daaronder de vijf schakelaars als een rooster met een naam per schakelaar, niet als een rij naamloze knopjes. De agenda-schakelaar bestaat alleen als het account een agenda heeft. Een gedelegeerd postvak is als zodanig te herkennen in de kaart.

*AboutSection* — de app-naam, het versienummer in `tabular-nums`, de updatestatus met de knoppen die bij die staat horen (nu bijwerken, herstarten om te installeren, of zoeken naar updates), en daaronder de changelog. Dit is de enige plek in het paneel waar `blue-600` mag staan, en alleen op de knop die de update daadwerkelijk uitvoert.

**Tekstsleutels.** Het huidige `strings.ts` heeft al sleutels voor elke instelling. Wat erbij moet: een naam per sectie voor de navigatie (`navGeneral`, `navNotifications`, `navAccounts`, `navAbout`), en een bijtekst voor elke rij die er een verdient. Voeg ze aan de interface en aan beide sets toe. Schrijf de Engelse set in de toon die er al is; de Rene-set in eenvoudig Nederlands zoals de andere sleutels daar.

Bijteksten zeggen wat er gebeurt, niet dat het handig is. "Opent Gmail in een eigen venster in plaats van in de app" — niet "Handig als je meerdere schermen hebt".

- [ ] **Step 1: Write the four sections and the new strings**

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit -p renderer/tsconfig.json` en `npm test`
Expected: beide schoon. De secties zijn nog niet aangesloten; dat gebeurt in Task 4.

- [ ] **Step 3: Commit**

```bash
git add renderer/app/settings/ renderer/app/strings.ts
git commit -m "feat: de vier secties van de instellingen"
```

---

### Task 4: SettingsPanel aansluiten

**Files:**
- Modify: `renderer/app/SettingsPanel.tsx`

**Interfaces:**
- Consumes: alles uit Task 1 t/m 3.
- Produces: niets voor latere taken; dit is de laatste.

**Wat `SettingsPanel.tsx` na deze taak nog doet:** de props aannemen die het nu al aanneemt (die veranderen niet, want `page.tsx` blijft ongemoeid), de staat houden die het nu houdt, de welke-sectie-is-actief-staat erbij, het Rene-easteregg, en de schil renderen met de juiste sectie erin. Alle opmaak is dan verhuisd.

**Wat niet mag veranderen:** de props van `SettingsPanel`. `renderer/app/page.tsx` geeft ze nu door en dat bestand wordt in deze taak niet aangeraakt.

**Het Rene-easteregg** hangt aan een `keydown` op het paneel en gebruikt `advanceReneSequence`. Dat blijft waar het is. Let op: de navigatie krijgt pijltjestoetsen, en de reeks begint óók met pijltjes. Zorg dat beide werken — de reeks mag niet stuklopen doordat de navigatie de toets opeet, en de navigatie mag niet stilvallen omdat de reeks meekijkt. Beschrijf in je rapport hoe je dat hebt opgelost, want dit is het enige echte raakpunt tussen twee toetsenbordgebruikers in dit paneel.

- [ ] **Step 1: Rewire the panel**

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit -p renderer/tsconfig.json`, `npm test`, `npx tsc --noEmit`
Expected: alle drie schoon.

- [ ] **Step 3: Commit**

```bash
git add renderer/app/SettingsPanel.tsx
git commit -m "feat: instellingen met een navigatiekolom in plaats van vijf secties onder elkaar"
```

- [ ] **Step 4: Walk through it in the running app**

De opmaak is niet getest, dus dit is waar het blijkt. Loop af en rapporteer elk punt dat niet klopt:

1. Elke sectie opent en toont wat erin hoort; niets uit de oude pagina is verdwenen.
2. Wisselen met de pijltjestoetsen werkt, en het actieve item is zichtbaar gefocust.
3. Het Rene-easteregg werkt nog — ↑ ↓ ← → a b op het paneel.
4. Het puntje verschijnt bij Meldingen als niet-storen aanstaat, en bij Over als er een update klaarstaat.
5. Een label typen slaat op; de opgeslagen-melding verschijnt.
6. Een accountkleur wijzigen verandert de kleurrug op de kaart én het streepje op het tabblad in de topbar.
7. Stille uren: een tijd half typen mag de opgeslagen waarde niet wissen.
8. De dropmap kiezen en openen werken.
9. In een smal venster blijft de navigatiekolom leesbaar en verspringt de inhoud niet.
10. Donker en licht thema, en Rene-modus aan.

---

## Self-Review

**Coverage** — elke sectie van de huidige pagina heeft een bestemming: Algemeen → Task 3 `GeneralSection`; Meldingen → `NotificationsSection`; Accounts → `AccountsSection`; Over + Wat is er nieuw → `AboutSection` (samengevoegd: beide gaan over welke versie je hebt). De kop met opslaan en sluiten → Task 2 `SettingsShell`. Het Rene-easteregg → Task 4.

**Type consistency** — `SettingsSection` en `AttentionInput` heten in Task 1, 2 en 4 hetzelfde; `SettingRow`'s `htmlFor` is optioneel en wordt in Task 3 alleen gebruikt waar er een control met een id is.

**Gecontroleerd tegen de code, niet aangenomen:** `renderer/app/settings-utils.ts` bevat `isCompleteTime`, `RENE_SEQUENCE` en `advanceReneSequence` met eigen tests, en blijft ongemoeid. `SettingsPanel.tsx` neemt nu `profiles`, `onClose`, `onRedetect`, `update`, drie update-callbacks, `prefs`, `onSetAutoStart`, `onSetNotifications`, `isDefaultMail` en `onSetDefaultMail` — die lijst verandert niet. De zes kleurtinten staan als `SWATCHES` in dat bestand en verhuizen mee naar `AccountsSection`.

**Wat de uitvoerder moet controleren in plaats van omzeilen:** de accountkaart moet elke instelling houden die er nu is (vijf schakelaars, label, kleur, verwijderen, en de agenda-schakelaar alleen als het account een agenda heeft). Tel ze na in `SettingsPanel.tsx` voordat je begint, en noem het aantal in je rapport.
