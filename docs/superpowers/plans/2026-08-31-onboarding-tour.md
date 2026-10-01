# First-run guided tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An eight-step guided tour that runs once, the first time the app has a real mailbox to show, walking the user past the topbar chrome and the mail drop.

**Architecture:** The tour is `shepherd.js` driven from React inside the main renderer page, anchored to `[data-tour]` attributes on `Topbar`'s own buttons. Because Gmail is a native `WebContentsView` painted over the page, the profile views are hidden for the tour's duration through one new IPC channel that mirrors what opening Settings already does. The step script is a pure, tested module; the component only builds and starts the tour.

**Tech Stack:** Electron 31, Next.js 14 (app router, `output: 'export'`), React 18, Tailwind 3, vitest (node environment, no DOM), shepherd.js 15.3.0.

**Spec:** `docs/superpowers/specs/2026-08-31-onboarding-tour-design.md`

## Global Constraints

- **All committed text is English.** Code comments, commit messages and docs. The app's *user-facing* strings are a different matter and are written in all three sets (see below).
- **Comment convention.** Banner sections are exactly three lines: 27 `=` characters, the Title-case name, 27 `=`. Two blank lines above a banner, one below. Fixed section order per file kind; an empty section stays. Docblocks are one-line description (third person, present tense, no trailing period), blank `*` line, then `@param` per argument in signature order and `@returns` last. Inline comments are rare, sentence case, no trailing period, above the line they explain, and say *why* not *what*. Roughly one comment line per ten of code.
- **Three string sets, always.** Every new key must be added to `STRINGS_NORMAL` (English), `STRINGS_RENE` (simple, informal Dutch) and `STRINGS_NL` (businesslike Dutch). `tests/strings-sets.test.ts` enforces identical keys, no empty values, and **that no Dutch value equals its English one**. A stub fails the suite.
- **vitest does not type-check.** It runs through esbuild, which strips types without checking them, so a missing property or a wrong signature passes the suite silently. Any step whose red state is a *type* error must be verified with `npx tsc --noEmit -p <config>`, never with vitest.
- **Muted text carries its dark variant.** `text-neutral-500` alone is 4.18:1 on the dark card and fails; pair it with `dark:text-neutral-400`. Same rule in raw CSS: `#737373` light, `#a3a3a3` dark.
- **Tailwind 3 opacity must be bracketed.** `border-black/8` emits nothing; write `border-black/[0.08]`.
- **NEVER run a production build while the app or dev server is running.** A production build poisons `.next` and makes `npm run dev` 404 its own routes. Before any `npm run build`, check for a running instance (Task 7 shows how). An `EPERM` on `.next/trace` means the app is running, not that the code is broken.
- **The installed app holds the single-instance lock.** `electron .` will exit 0 in silence while the installed build is open. Smoke-test with an explicit `--user-data-dir`.
- **Renderer dependencies live in `renderer/package.json`,** not the root one. Install with `--prefix renderer`.

---

### Task 1: The `tour.seen` preference and its IPC plumbing

Nothing visible yet. This task makes the app able to remember that the tour has run, and gives the renderer the two calls it will need: one to hide/show the Gmail views, one to record that the tour is done.

**Files:**
- Modify: `electron/core/prefs-store.ts` (types ~line 125, `Prefs` ~143, `DEFAULT_PREFS` ~194, reader ~352, setters ~415)
- Modify: `electron/core/ipc.ts:32` (the key list)
- Modify: `electron/core/ipc-handlers.ts:28` (import) and `:124` (after the `SETTINGS_TOGGLE` handler)
- Modify: `electron/sidebar-preload.ts:79` (beside `toggleSettings`)
- Modify: `renderer/app/page.tsx:133` (`Prefs`) and `:195` (`DesktopBridge`)
- Test: `tests/prefs-store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TourPrefs { seen: boolean }` and `PrefsStore.setTour(patch: Partial<TourPrefs>): void` in `prefs-store.ts`. `IPC.TOUR_ACTIVE` (`'tour:active'`, payload `{ active: boolean }`) and `IPC.SET_TOUR_SEEN` (`'prefs:tour-seen'`, payload `boolean`). On the renderer bridge: `setTourActive(active: boolean): void` and `setTourSeen(v: boolean): void`. On the renderer `Prefs` type: `tour: { seen: boolean }`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/prefs-store.test.ts`, inside the existing `describe('PrefsStore', ...)` block:

```ts
  it('defaults the tour to unseen', () => {
    expect(new PrefsStore(file).getAll().tour).toEqual({ seen: false });
  });

  // A prefs.json written by a build from before the tour existed has no tour key at all,
  // and an undefined field would make the trigger's `prefs.tour.seen` throw.
  it('reads a prefs file written before the tour existed as unseen', () => {
    writeFileSync(file, JSON.stringify({ theme: 'dark' }), 'utf8');
    expect(new PrefsStore(file).getAll().tour).toEqual({ seen: false });
  });

  it('remembers the tour as seen across a reload', () => {
    const store = new PrefsStore(file);
    store.setTour({ seen: true });
    expect(new PrefsStore(file).getAll().tour.seen).toBe(true);
  });

  it('leaves the other tabs alone when the tour is marked seen', () => {
    const store = new PrefsStore(file);
    store.setTheme('dark');
    store.setTour({ seen: true });
    expect(new PrefsStore(file).getAll().theme).toBe('dark');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run tests/prefs-store.test.ts
```

Expected: FAIL. The first three fail on `tour` being `undefined`; `setTour` does not exist, so TypeScript also reports `Property 'setTour' does not exist on type 'PrefsStore'`.

- [ ] **Step 3: Add the type, the default, the reader entry and the setter**

In `electron/core/prefs-store.ts`, add the interface immediately after `MailDropPrefs` (~line 125):

```ts
export interface TourPrefs {
  seen: boolean;
}
```

Add the field to `Prefs`, between `advanced` and `reneMode`:

```ts
  advanced: AdvancedPrefs;
  tour: TourPrefs;
  reneMode: boolean;
```

Add the default to `DEFAULT_PREFS`, in the same position:

```ts
  advanced: { hardwareAcceleration: true, lowMemory: false },
  tour: { seen: false },
  reneMode: false,
```

Add the reader entry immediately after the `advanced: { ... },` block (~line 353):

```ts
        tour: { seen: bool(raw.tour?.seen, false) },
```

Add the setter immediately after `setAdvanced` (~line 418):

```ts
  setTour(patch: Partial<TourPrefs>): void {
    const prefs = this.getAll();
    this.write({ ...prefs, tour: { ...prefs.tour, ...patch } });
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/prefs-store.test.ts
```

Expected: PASS, all tests in the file.

- [ ] **Step 5: Add the two IPC keys**

In `electron/core/ipc.ts`, after `SETTINGS_TOGGLE: 'settings:toggle',`:

```ts
  TOUR_ACTIVE: 'tour:active',
  SET_TOUR_SEEN: 'prefs:tour-seen',
```

- [ ] **Step 6: Add the two handlers**

In `electron/core/ipc-handlers.ts`, extend the runtime import at line 28 so it brings in the live flag as well as its setter:

```ts
  setSettingsPanelOpen,
  settingsPanelOpen,
```

Then add both handlers directly after the `SETTINGS_TOGGLE` handler (which ends at line 128):

```ts
  // The tour draws in the renderer page, and the Gmail views are painted on top of it, so
  // they have to be out of the way or the tour is invisible. Same two calls the settings
  // panel makes. The settingsPanelOpen guard is what stops a tour that ends while the panel
  // happens to be open from painting Gmail over the panel.
  ipcMain.on(IPC.TOUR_ACTIVE, (_e, arg: { active: boolean }) => {
    if (arg.active) manager?.hideAll();
    else if (!settingsPanelOpen) manager?.showActive();
  });
  ipcMain.on(IPC.SET_TOUR_SEEN, (_e, v: boolean) => {
    if (!prefs) return;
    prefs.setTour({ seen: v });
    pushPrefs();
  });
```

- [ ] **Step 7: Add the two bridge methods**

In `electron/sidebar-preload.ts`, after the `toggleSettings` line (~79):

```ts
  setTourActive: (active: boolean): void => ipcRenderer.send(IPC.TOUR_ACTIVE, { active }),
  setTourSeen: (v: boolean): void => ipcRenderer.send(IPC.SET_TOUR_SEEN, v),
```

- [ ] **Step 8: Mirror both into the renderer's copied types**

In `renderer/app/page.tsx`, add to the `Prefs` interface between `advanced` and `reneMode` (~line 133):

```ts
  advanced: { hardwareAcceleration: boolean; lowMemory?: boolean };
  tour: { seen: boolean };
  reneMode: boolean;
```

And to `DesktopBridge`, after `setAdvanced` (~line 195):

```ts
  setTourActive(active: boolean): void;
  setTourSeen(v: boolean): void;
```

- [ ] **Step 9: Typecheck and run the whole suite**

The root `tsconfig.json` covers `electron` and `tests` and explicitly **excludes** `renderer`, so it does not see the `page.tsx` edit. Both configs are needed.

```bash
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p renderer/tsconfig.json
npm test
```

Expected: no type errors from either config, all 141+ test files pass.

- [ ] **Step 10: Commit**

```bash
git add electron/core/prefs-store.ts electron/core/ipc.ts electron/core/ipc-handlers.ts electron/sidebar-preload.ts renderer/app/page.tsx tests/prefs-store.test.ts
git commit -m "feat(tour): remember that the tour has run, and let the renderer hide the views"
```

---

### Task 2: The tour's text, in all three string sets

The strings come before the step script, because the script types its keys as `keyof UiStrings` and will not compile until they exist.

**Files:**
- Modify: `renderer/app/strings.ts` (`UiStrings` ends at line 306; `STRINGS_NORMAL` value block ends ~712, `STRINGS_RENE` ~1035, `STRINGS_NL` ~1376)
- Test: `tests/strings-sets.test.ts` (existing, no edits — it must simply keep passing)

**Interfaces:**
- Consumes: nothing.
- Produces: 24 new members on `UiStrings`, all of type `string`: `tourGroup`, `tourReplay`, `tourReplayDescription`, `tourReplayButton`, `tourBack`, `tourNext`, `tourDone`, `tourSkip`, `tourWelcomeTitle`, `tourWelcomeBody`, `tourTabsTitle`, `tourTabsBody`, `tourTabMenuTitle`, `tourTabMenuBody`, `tourAddTitle`, `tourAddBody`, `tourPinnedTitle`, `tourPinnedBody`, `tourMailDropTitle`, `tourMailDropBody`, `tourFeedbackTitle`, `tourFeedbackBody`, `tourGearTitle`, `tourGearBody`.

- [ ] **Step 1: Declare the keys on `UiStrings`**

In `renderer/app/strings.ts`, add a blank line then this block at the end of the `UiStrings` interface, after `composePickerCancel: string;` (line 305):

```ts
  tourGroup: string;
  tourReplay: string;
  tourReplayDescription: string;
  tourReplayButton: string;
  tourBack: string;
  tourNext: string;
  tourDone: string;
  tourSkip: string;
  tourWelcomeTitle: string;
  tourWelcomeBody: string;
  tourTabsTitle: string;
  tourTabsBody: string;
  tourTabMenuTitle: string;
  tourTabMenuBody: string;
  tourAddTitle: string;
  tourAddBody: string;
  tourPinnedTitle: string;
  tourPinnedBody: string;
  tourMailDropTitle: string;
  tourMailDropBody: string;
  tourFeedbackTitle: string;
  tourFeedbackBody: string;
  tourGearTitle: string;
  tourGearBody: string;
```

- [ ] **Step 2: Verify the red state with the type checker, not with vitest**

vitest runs through esbuild, which **strips types without checking them**, so `npx vitest run tests/strings-sets.test.ts` passes at this point and proves nothing. The missing properties are a type error, so ask the type checker:

```bash
npx tsc --noEmit -p renderer/tsconfig.json
```

Expected: FAIL with `TS2740` against each of `STRINGS_NORMAL`, `STRINGS_RENE` and `STRINGS_NL` — "missing the following properties from type 'UiStrings': tourGroup, tourReplay, tourReplayDescription, tourReplayButton, and 20 more".

- [ ] **Step 3: Add the English values**

In `STRINGS_NORMAL`, after `composePickerCancel: 'Cancel',` (line 712):

```ts
  tourGroup: 'Tour',
  tourReplay: 'Show the tour again',
  tourReplayDescription: 'Walk past the app’s own features once more.',
  tourReplayButton: 'Start tour',
  tourBack: 'Back',
  tourNext: 'Next',
  tourDone: 'Done',
  tourSkip: 'Skip',
  tourWelcomeTitle: 'Welcome to Gmail Desktop',
  tourWelcomeBody:
    'A minute’s look at what this app adds to Gmail. Press Esc to leave at any point.',
  tourTabsTitle: 'One tab per mailbox',
  tourTabsBody:
    'Every account and every shared mailbox gets a tab. Click one to switch to it; the number beside a name is its unread mail.',
  tourTabMenuTitle: 'More behind every tab',
  tourTabMenuBody:
    'Right-click a tab to open that account’s Calendar, Drive or Contacts. Drag a tab sideways to reorder the strip.',
  tourAddTitle: 'Add a mailbox',
  tourAddBody:
    'The plus links another Google account, or a mailbox somebody has shared with you.',
  tourPinnedTitle: 'Pinned Google apps',
  tourPinnedBody:
    'These open in the mailbox you are looking at. Choose which ones sit here under Settings, Google apps.',
  tourMailDropTitle: 'Drop mail onto the window',
  tourMailDropBody:
    'Drag .eml files, or a folder of them, onto this window. The app files them under labels you pick, in several mailboxes at once.',
  tourFeedbackTitle: 'Report a problem',
  tourFeedbackBody:
    'The speech bubble writes to the developer, with the app’s diagnostics attached if you want them.',
  tourGearTitle: 'Everything else',
  tourGearBody:
    'Notifications, downloads, updates and the rest live behind the gear. You can start this tour again from Settings, General.',
```

- [ ] **Step 4: Add the Rene-mode values**

Rene mode is simple, informal Dutch — `je` rather than `u`, short sentences. In `STRINGS_RENE`, after `composePickerCancel: 'Laat maar',` (line 1035):

```ts
  tourGroup: 'Het rondje',
  tourReplay: 'Rondje nog eens doen',
  tourReplayDescription: 'Loop nog een keer met ons mee door de app.',
  tourReplayButton: 'Start het rondje',
  tourBack: 'Terug',
  tourNext: 'Verder',
  tourDone: 'Klaar',
  tourSkip: 'Nu niet',
  tourWelcomeTitle: 'Welkom!',
  tourWelcomeBody:
    'We lopen even samen door de app. Het duurt een minuutje. Wil je stoppen? Druk op Esc.',
  tourTabsTitle: 'Elke mailbox een tabje',
  tourTabsBody:
    'Bovenaan staat een tabje voor elke mailbox. Klik erop om te wisselen. Het getal zegt hoeveel nieuwe mail er is.',
  tourTabMenuTitle: 'Rechtermuisknop op een tabje',
  tourTabMenuBody:
    'Klik met de rechtermuisknop op een tabje. Dan kun je ook de agenda, Drive of contacten openen. Slepen mag ook, dan verschuif je het tabje.',
  tourAddTitle: 'Mailbox erbij',
  tourAddBody:
    'Met de plus zet je een nieuwe mailbox erbij. Ook een mailbox die iemand met je deelt.',
  tourPinnedTitle: 'Snelknoppen',
  tourPinnedBody:
    'Deze knoppen horen bij de mailbox die je nu ziet. Welke knoppen hier staan, kies je bij Instellingen, Google-apps.',
  tourMailDropTitle: 'Mail hierheen slepen',
  tourMailDropBody:
    'Sleep mailbestanden op dit venster. De app zet ze dan netjes onder een label. In meerdere mailboxen tegelijk, als je dat wilt.',
  tourFeedbackTitle: 'Iets kwijt of stuk?',
  tourFeedbackBody:
    'Klik op het wolkje. Dan stuur je een berichtje naar de maker van de app.',
  tourGearTitle: 'De rest zit hier',
  tourGearBody:
    'Achter het tandwiel staat alles: meldingen, downloads en updates. Wil je dit rondje nog eens? Dat kan bij Instellingen, Algemeen.',
```

- [ ] **Step 5: Add the Dutch values**

Businesslike Dutch, `u`. In `STRINGS_NL`, after `composePickerCancel: 'Annuleren',` (line 1376):

```ts
  tourGroup: 'Rondleiding',
  tourReplay: 'Rondleiding opnieuw tonen',
  tourReplayDescription: 'Loop nog een keer langs de functies van de app.',
  tourReplayButton: 'Start rondleiding',
  tourBack: 'Terug',
  tourNext: 'Volgende',
  tourDone: 'Gereed',
  tourSkip: 'Overslaan',
  tourWelcomeTitle: 'Welkom bij Gmail Desktop',
  tourWelcomeBody:
    'Een rondleiding van een minuut langs wat deze app aan Gmail toevoegt. Met Esc stopt u wanneer u wilt.',
  tourTabsTitle: 'Eén tab per postbus',
  tourTabsBody:
    'Elk account en elke gedeelde postbus krijgt een tab. Klik erop om te wisselen; het getal naast een naam is de ongelezen post.',
  tourTabMenuTitle: 'Meer achter elke tab',
  tourTabMenuBody:
    'Klik met de rechtermuisknop op een tab voor de Agenda, Drive of Contacten van dat account. Versleep een tab om de strook te herschikken.',
  tourAddTitle: 'Een postbus toevoegen',
  tourAddBody:
    'De plus koppelt een volgend Google-account, of een postbus die iemand met u heeft gedeeld.',
  tourPinnedTitle: 'Vastgezette Google-apps',
  tourPinnedBody:
    'Deze openen in de postbus die u nu bekijkt. Welke hier staan, kiest u bij Instellingen, Google-apps.',
  tourMailDropTitle: 'Post op het venster slepen',
  tourMailDropBody:
    'Sleep .eml-bestanden, of een map ermee, op dit venster. De app zet ze onder labels die u kiest, in meerdere postbussen tegelijk.',
  tourFeedbackTitle: 'Een probleem melden',
  tourFeedbackBody:
    'De tekstballon schrijft een bericht aan de ontwikkelaar, desgewenst met de diagnostiek van de app erbij.',
  tourGearTitle: 'Al het overige',
  tourGearBody:
    'Meldingen, downloads, updates en de rest zitten achter het tandwiel. Deze rondleiding start u opnieuw bij Instellingen, Algemeen.',
```

- [ ] **Step 6: Run the type check and the suite to verify both pass**

```bash
npx tsc --noEmit -p renderer/tsconfig.json
npx vitest run tests/strings-sets.test.ts
```

Expected: no type errors, then PASS. In particular `translates every value that is not deliberately shared with English` must pass — if it names a `tour*` key, the Dutch value is still the English one and needs writing, **not** an entry in `SAME_IN_BOTH`.

- [ ] **Step 7: Commit**

```bash
git add renderer/app/strings.ts
git commit -m "feat(tour): add the tour's text in English, Dutch and Rene mode"
```

---

### Task 3: The step script as a pure module

**Files:**
- Create: `renderer/app/tour-steps.ts`
- Test: `tests/tour-steps.test.ts`

**Interfaces:**
- Consumes: the 24 `tour*` string keys from Task 2.
- Produces: `TourAnchor`, `TourTextKey`, `TourStep`, `TourInput`, `planTour(input: TourInput): TourStep[]`, `anchorSelector(anchor: TourAnchor): string | null`. `TourStep` is `{ id: string; anchor: TourAnchor; on: 'bottom' | 'bottom-start' | 'bottom-end'; titleKey: TourTextKey; bodyKey: TourTextKey }`. `TourInput` is `{ hasPinned: boolean }`.

- [ ] **Step 1: Write the failing test**

Create `tests/tour-steps.test.ts`:

```ts
// The tour's script: its order, what gets dropped when the window cannot show it, and that
// every step names a string that exists. A step pointing at a key nobody wrote would draw
// a card with a blank title, which no type check catches on its own.

import { describe, it, expect } from 'vitest';
import { planTour, anchorSelector } from '../renderer/app/tour-steps';
import { STRINGS_NORMAL } from '../renderer/app/strings';

describe('planTour', () => {
  it('runs all eight steps when the mailbox has pinned apps', () => {
    expect(planTour({ hasPinned: true }).map((s) => s.id)).toEqual([
      'welcome',
      'tabs',
      'tab-menu',
      'add',
      'pinned',
      'maildrop',
      'feedback',
      'gear',
    ]);
  });

  it('drops the pinned step when nothing is pinned', () => {
    expect(planTour({ hasPinned: false }).map((s) => s.id)).toEqual([
      'welcome',
      'tabs',
      'tab-menu',
      'add',
      'maildrop',
      'feedback',
      'gear',
    ]);
  });

  it('gives every step a unique id', () => {
    const ids = planTour({ hasPinned: true }).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('centres the welcome and mail-drop steps and anchors the rest', () => {
    const steps = planTour({ hasPinned: true });
    expect(steps.filter((s) => s.anchor === null).map((s) => s.id)).toEqual([
      'welcome',
      'maildrop',
    ]);
    expect(steps.filter((s) => s.anchor !== null).length).toBe(6);
  });

  it('names a string that exists for every title and body', () => {
    for (const step of planTour({ hasPinned: true })) {
      expect(typeof STRINGS_NORMAL[step.titleKey], `${step.id} title`).toBe('string');
      expect(typeof STRINGS_NORMAL[step.bodyKey], `${step.id} body`).toBe('string');
    }
  });

  // The script is a module-level constant; handing it out by reference would let one caller
  // rewrite the tour for every later one.
  it('hands back copies rather than the script itself', () => {
    planTour({ hasPinned: true })[0].id = 'mutated';
    expect(planTour({ hasPinned: true })[0].id).toBe('welcome');
  });
});

describe('anchorSelector', () => {
  it('builds a data-tour selector', () => {
    expect(anchorSelector('gear')).toBe('[data-tour="gear"]');
  });

  it('has no selector for a centred step', () => {
    expect(anchorSelector(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/tour-steps.test.ts
```

Expected: FAIL with `Cannot find module '../renderer/app/tour-steps'`.

- [ ] **Step 3: Write the module**

Create `renderer/app/tour-steps.ts`:

```ts
// The tour's script: which steps exist, in what order, and which of them this window can
// actually show. Pure on purpose - no React and no shepherd - so the order and the string
// keys are checked by a test instead of by running the app and watching.
//
// A step with a null anchor is a card in the middle of the window with nothing spotlit.
// Anchors name a [data-tour] attribute on one of Topbar's own controls, never a class or a
// position: a class is a styling decision that may change, and the attribute exists for
// this and nothing else.

import type { UiStrings } from './strings';


//===========================
// Types
//===========================

export type TourAnchor = 'tabs' | 'add' | 'pinned' | 'feedback' | 'gear' | null;

/** The plain-string members of UiStrings; a tour step never takes a parameter. */
export type TourTextKey = {
  [K in keyof UiStrings]: UiStrings[K] extends string ? K : never;
}[keyof UiStrings];

export interface TourStep {
  id: string;
  anchor: TourAnchor;
  /** Ignored when anchor is null: a centred card has nothing to sit below. */
  on: 'bottom' | 'bottom-start' | 'bottom-end';
  titleKey: TourTextKey;
  bodyKey: TourTextKey;
}

export interface TourInput {
  hasPinned: boolean;
}


//===========================
// Constants
//===========================

const STEPS: readonly TourStep[] = [
  {
    id: 'welcome',
    anchor: null,
    on: 'bottom',
    titleKey: 'tourWelcomeTitle',
    bodyKey: 'tourWelcomeBody',
  },
  {
    id: 'tabs',
    anchor: 'tabs',
    on: 'bottom-start',
    titleKey: 'tourTabsTitle',
    bodyKey: 'tourTabsBody',
  },
  {
    id: 'tab-menu',
    anchor: 'tabs',
    on: 'bottom-start',
    titleKey: 'tourTabMenuTitle',
    bodyKey: 'tourTabMenuBody',
  },
  {
    id: 'add',
    anchor: 'add',
    on: 'bottom',
    titleKey: 'tourAddTitle',
    bodyKey: 'tourAddBody',
  },
  {
    id: 'pinned',
    anchor: 'pinned',
    on: 'bottom-end',
    titleKey: 'tourPinnedTitle',
    bodyKey: 'tourPinnedBody',
  },
  {
    id: 'maildrop',
    anchor: null,
    on: 'bottom',
    titleKey: 'tourMailDropTitle',
    bodyKey: 'tourMailDropBody',
  },
  {
    id: 'feedback',
    anchor: 'feedback',
    on: 'bottom-end',
    titleKey: 'tourFeedbackTitle',
    bodyKey: 'tourFeedbackBody',
  },
  {
    id: 'gear',
    anchor: 'gear',
    on: 'bottom-end',
    titleKey: 'tourGearTitle',
    bodyKey: 'tourGearBody',
  },
];


//===========================
// Exported functions
//===========================

/**
 * The steps this window can show, in order
 *
 * @param input what the window currently has on screen
 * @returns fresh copies of the script with unshowable steps removed
 */
export function planTour(input: TourInput): TourStep[] {
  return STEPS.filter((step) => step.anchor !== 'pinned' || input.hasPinned).map((step) => ({
    ...step,
  }));
}

/**
 * The selector a step's anchor resolves to
 *
 * @param anchor
 * @returns the selector, or null for a centred step
 */
export function anchorSelector(anchor: TourAnchor): string | null {
  return anchor === null ? null : `[data-tour="${anchor}"]`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/tour-steps.test.ts
```

Expected: PASS, eight tests.

- [ ] **Step 5: Commit**

```bash
git add renderer/app/tour-steps.ts tests/tour-steps.test.ts
git commit -m "feat(tour): script the eight steps as a pure, tested module"
```

---

### Task 4: shepherd.js, its theming, and the component that drives it

The tour becomes real here, but nothing starts it yet — that is Task 5. At the end of this task the code is present and compiles; it is not yet reachable.

**Files:**
- Modify: `renderer/package.json`, `renderer/package-lock.json` (via npm)
- Create: `renderer/app/TourGuide.tsx`
- Modify: `renderer/app/globals.css`
- Modify: `renderer/app/Topbar.tsx` (lines 126, 163, 183, 202, 211)

**Interfaces:**
- Consumes: `planTour`, `anchorSelector`, `TourStep` from Task 3; the `tour*` strings from Task 2.
- Produces: `TourGuide({ steps, S, onEnd })` — a component that renders `null`, builds the shepherd tour in a mount-only effect, and calls `onEnd` exactly once when the tour finishes, is cancelled, or is unmounted. The `data-tour` attributes `tabs`, `add`, `pinned`, `feedback`, `gear` in `Topbar`.

- [ ] **Step 1: Install the dependency**

```bash
npm install shepherd.js@15.3.0 --prefix renderer
```

Expected: `renderer/package.json` gains `"shepherd.js": "^15.3.0"` under `dependencies`, and `@floating-ui/dom` plus `deepmerge-ts` arrive as transitive packages. Confirm:

```bash
node -e "console.log(require('./renderer/package.json').dependencies)"
```

- [ ] **Step 2: Add the `data-tour` anchors to `Topbar.tsx`**

Five edits, none of which change layout.

The tab-strip container (line ~125, the `div` whose `className` starts `flex min-w-0 items-center gap-1 overflow-x-auto`) gains the attribute alongside its existing props:

```tsx
        <div
          data-tour="tabs"
          className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
```

The `+` button (line ~163):

```tsx
          <button
            data-tour="add"
            onClick={() => void openPlusMenu()}
```

The pinned buttons need the map's index, so change the opening of the map (line 183) from `{pinned.map((surface) => (` to include it, and mark only the first button. A wrapper element is deliberately **not** used: `PINNED_BUTTON = ICON_BUTTON + GAP` at line 49 assumes these buttons are flat siblings under one `gap-1` flex, and nesting them would move that gap and break the `maxWidth` reserve, sliding the gear under the native window overlay.

```tsx
        {pinned.map((surface, i) => (
          <button
            key={surface}
            data-tour={i === 0 ? 'pinned' : undefined}
            onClick={() => active && onOpen(active.key, surface)}
```

The feedback button (line ~202):

```tsx
        <button
          data-tour="feedback"
          onClick={onOpenFeedback}
```

The gear (line ~211):

```tsx
        <button
          data-tour="gear"
          onClick={onOpenSettings}
```

- [ ] **Step 3: Theme shepherd against the settings palette**

Append to `renderer/app/globals.css`. The values are taken from `renderer/app/settings/tokens.ts`: white card on a hairline of 8% black, `neutral-900` (`#171717`) in dark, muted text `#737373` light and `#a3a3a3` dark.

```css
/*===========================
  Tour, shepherd overrides
===========================*/

/* shepherd.css 15.3.0 defines no custom properties, so every colour here is an override
   of its own class rather than a token it reads. */

.shepherd-element {
  max-width: 21rem;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 1rem;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  font-family: inherit;
}

.shepherd-content {
  border-radius: 1rem;
}

/* the .shepherd-has-title chain is what paints a grey band behind the title, and every
   step in this tour has a title */
.shepherd-has-title .shepherd-content .shepherd-header {
  background: transparent;
  padding: 1rem 1rem 0;
}

.shepherd-title {
  color: #171717;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.shepherd-text {
  padding: 0.5rem 1rem 0;
  color: #737373;
  font-size: 13px;
  line-height: 1.5;
}

.shepherd-footer {
  padding: 0.875rem 1rem 1rem;
}

.shepherd-button {
  margin-right: 0.5rem;
  border-radius: 0.5rem;
  padding: 0.375rem 0.75rem;
  background: #2563eb;
  color: #ffffff;
  font-size: 13px;
  font-weight: 500;
  transition: background 0.15s ease;
}

.shepherd-button:not(:disabled):hover {
  background: #3b82f6;
  color: #ffffff;
}

.shepherd-button.shepherd-button-secondary {
  background: #e5e5e5;
  color: #171717;
}

.shepherd-button.shepherd-button-secondary:not(:disabled):hover {
  background: #d4d4d4;
  color: #171717;
}

.shepherd-arrow:before {
  background: #ffffff;
}

/* every step here sits below its target, which is the one placement whose arrow inherits
   the header's grey */
.shepherd-element.shepherd-has-title[data-popper-placement^='bottom'] > .shepherd-arrow:before {
  background-color: #ffffff;
}

/* only the visible modifier may be given an opacity: the base class is 0, and giving that
   a value would dim the window while no tour is running */
.shepherd-modal-overlay-container.shepherd-modal-is-visible {
  opacity: 0.6;
}


/*===========================
  Tour, dark
===========================*/

.dark .shepherd-element {
  border-color: rgba(255, 255, 255, 0.08);
  background: #171717;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
}

.dark .shepherd-title {
  color: #f5f5f5;
}

/* neutral-400, not neutral-500: 500 is 4.18:1 on this card and fails at this size */
.dark .shepherd-text {
  color: #a3a3a3;
}

.dark .shepherd-button.shepherd-button-secondary {
  background: #262626;
  color: #f5f5f5;
}

.dark .shepherd-button.shepherd-button-secondary:not(:disabled):hover {
  background: #404040;
  color: #f5f5f5;
}

.dark .shepherd-arrow:before,
.dark
  .shepherd-element.shepherd-has-title[data-popper-placement^='bottom']
  > .shepherd-arrow:before {
  background-color: #171717;
}

.dark .shepherd-cancel-icon {
  color: #a3a3a3;
}
```

- [ ] **Step 4: Write the component**

Create `renderer/app/TourGuide.tsx`:

```tsx
'use client';

import { useEffect, useRef } from 'react';
import Shepherd from 'shepherd.js';
import type { StepOptions } from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import { anchorSelector, type TourStep } from './tour-steps';
import type { UiStrings } from './strings';

// Shepherd owns every pixel it draws, so this component renders nothing itself: its whole
// job is to build the tour, start it, and make sure every way out lands on onEnd exactly
// once. The Gmail views are hidden for the tour's duration, so a path out of here that
// forgets to report would leave the window blank.
//
// The effect has no dependencies on purpose. Rebuilding the tour on a re-render would
// restart it at step one every time an unread count arrived, and unread counts arrive
// constantly. The strings and the steps are read once, at the moment the tour starts.
//
// canClickTarget is false throughout: a click on the highlighted gear would open the
// settings panel over the tour, which the tour cannot see and cannot recover from.


//===========================
// Component
//===========================

/**
 * Runs the guided tour and reports when it is over
 *
 * @param steps the planned steps, already filtered to what this window can show
 * @param S the active string set
 * @param onEnd called once, whether the tour was finished, skipped or unmounted
 */
export function TourGuide({
  steps,
  S,
  onEnd,
}: {
  steps: TourStep[];
  S: UiStrings;
  onEnd(): void;
}) {
  // Read through a ref so a new onEnd identity cannot re-run the effect and restart the tour
  const end = useRef(onEnd);
  end.current = onEnd;

  useEffect(() => {
    if (steps.length === 0) {
      end.current();
      return;
    }

    const tour = new Shepherd.Tour({
      useModalOverlay: true,
      defaultStepOptions: {
        canClickTarget: false,
        skipMissingElement: true,
        waitForElement: 2000,
        scrollTo: false,
        cancelIcon: { enabled: true },
        modalOverlayOpeningPadding: 6,
        modalOverlayOpeningRadius: 10,
      },
    });

    steps.forEach((step, i) => {
      const selector = anchorSelector(step.anchor);
      const options: StepOptions = {
        id: step.id,
        title: S[step.titleKey],
        text: S[step.bodyKey],
        buttons: [
          i === 0
            ? { text: S.tourSkip, secondary: true, action: () => void tour.cancel() }
            : { text: S.tourBack, secondary: true, action: () => void tour.back() },
          i === steps.length - 1
            ? { text: S.tourDone, action: () => tour.complete() }
            : { text: S.tourNext, action: () => void tour.next() },
        ],
      };
      if (selector) options.attachTo = { element: selector, on: step.on };
      tour.addStep(options);
    });

    // Finishing and skipping differ in what the user learned, not in what the app has to
    // do, so both arrive here. The flag is what keeps the unmount path from reporting a
    // second time after the tour has already ended on its own.
    let reported = false;
    const finish = () => {
      if (reported) return;
      reported = true;
      end.current();
    };
    tour.on('complete', finish);
    tour.on('cancel', finish);
    void tour.start();

    return () => {
      if (!reported) tour.complete();
    };
  }, []);

  return null;
}
```

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit -p renderer/tsconfig.json
```

Expected: no errors. `renderer/tsconfig.json` already has `"moduleResolution": "bundler"`, which is what lets the `exports` map hand over `dist/js/shepherd.d.mts` — the package exposes its types no other way. If tsc reports `shepherd.js` has no types, check the install actually landed rather than reaching for a `declare module` shim.

The authoritative check is `npm run build:renderer`, since that is what will run at release time. Do not run it while the dev server or the app is up — see Task 7, Step 1.

- [ ] **Step 6: Commit**

```bash
git add renderer/package.json renderer/package-lock.json renderer/app/TourGuide.tsx renderer/app/globals.css renderer/app/Topbar.tsx
git commit -m "feat(tour): add shepherd.js, theme it, and anchor it to the topbar"
```

---

### Task 5: Start the tour on the first run that has a mailbox

**Files:**
- Modify: `renderer/app/page.tsx` (imports at the top, state and effects in `AppShell` from ~line 290, render from ~line 400)

**Interfaces:**
- Consumes: `planTour`/`TourStep` (Task 3), `TourGuide` (Task 4), `setTourActive`/`setTourSeen`/`prefs.tour.seen` (Task 1).
- Produces: `startTour()`, `endTour()`, `hasPinnedApps(): boolean` and `replayTour()` inside `AppShell`. `startTour` takes no arguments — it asks `hasPinnedApps()` itself, so the trigger and the replay row cannot disagree about what is pinned. `replayTour` is what Task 6 hands to the settings panel.

- [ ] **Step 1: Add the imports**

In `renderer/app/page.tsx`, beside the existing imports:

```tsx
import { TourGuide } from './TourGuide';
import { planTour, type TourStep } from './tour-steps';
import { openableSurfaces } from '../lib/surfaces';
```

`pinnedSurfacesFor` comes from `../lib/google-apps`, which the file already imports `googleAppTarget` from — extend that import rather than adding a second one:

```tsx
import { googleAppTarget, pinnedSurfacesFor } from '../lib/google-apps';
```

- [ ] **Step 2: Add the state**

After the `pendingEmail` state (~line 291):

```tsx
  const [tourSteps, setTourSteps] = useState<TourStep[] | null>(null);
  // Once per session, whether the tour ran to the end or was waved away. Without this the
  // effect below would start it again on the next profile push, because prefs.tour.seen
  // only turns true after a round trip through main.
  const tourStarted = useRef(false);
```

`useRef` must be added to the React import at line 3:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
```

- [ ] **Step 3: Add the helpers**

Beside the other handlers in `AppShell`, after `reorder` (~line 395):

```tsx
  /**
   * Whether the active mailbox has any Google apps pinned to the bar
   *
   * @returns false when nothing is pinned, or when no mailbox is active yet
   */
  function hasPinnedApps(): boolean {
    const row = active ? (profiles.find((p) => p.key === active.key) ?? null) : null;
    if (!row || !prefs) return false;
    return pinnedSurfacesFor(prefs.googleApps.pinned, openableSurfaces(row)).length > 0;
  }

  function startTour() {
    tourStarted.current = true;
    setTourSteps(planTour({ hasPinned: hasPinnedApps() }));
    window.desktop?.setTourActive(true);
  }

  function endTour() {
    setTourSteps(null);
    window.desktop?.setTourActive(false);
    window.desktop?.setTourSeen(true);
  }

  function replayTour() {
    closeSettings();
    startTour();
  }
```

- [ ] **Step 4: Add the trigger effect**

After the theme effect (~line 340):

```tsx
  // The tour waits for a mailbox to point at. On a fresh install the tab strip is empty,
  // and a provisional tab is one remembered from the bar before detection has recovered its
  // address, so neither can carry the steps that talk about tabs.
  useEffect(() => {
    if (tourStarted.current) return;
    if (!prefs || prefs.tour.seen || settingsOpen) return;
    if (!profiles.some((p) => !p.provisional)) return;
    startTour();
  }, [profiles, prefs, settingsOpen, active]);
```

- [ ] **Step 5: Mount the tour**

At the end of `AppShell`'s returned tree, after the `settingsOpen && (...)` block and inside the outer `div`:

```tsx
      {tourSteps && <TourGuide steps={tourSteps} S={S} onEnd={endTour} />}
```

- [ ] **Step 6: Typecheck and run the suite**

```bash
npx tsc --noEmit -p renderer/tsconfig.json
npm test
```

Expected: no type errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add renderer/app/page.tsx
git commit -m "feat(tour): start the tour once the first real mailbox lands"
```

---

### Task 6: The replay row in Settings, General

**Files:**
- Modify: `renderer/app/settings/GeneralSection.tsx`
- Modify: `renderer/app/SettingsPanel.tsx` (props block ~line 38, `general` case ~line 127)
- Modify: `renderer/app/page.tsx` (the `SettingsPanel` element ~line 425)

**Interfaces:**
- Consumes: `replayTour` from Task 5; `tourGroup`, `tourReplay`, `tourReplayDescription`, `tourReplayButton` from Task 2.
- Produces: `onReplayTour: () => void` as a required prop on both `GeneralSection` and `SettingsPanel`.

- [ ] **Step 1: Add the row to `GeneralSection`**

Add `onReplayTour` to the props type and the destructuring, then a new group after the Startup group:

```tsx
      <SettingsGroup title={S.tourGroup}>
        <SettingRow label={S.tourReplay} description={S.tourReplayDescription}>
          <button type="button" className={BUTTON} onClick={onReplayTour}>
            {S.tourReplayButton}
          </button>
        </SettingRow>
      </SettingsGroup>
```

The full props block becomes:

```tsx
export function GeneralSection({
  S,
  prefs,
  isDefaultMail,
  onSetAutoStart,
  onSetLaunchMinimized,
  onRequestDefaultMail,
  onReplayTour,
}: {
  S: UiStrings;
  prefs: Prefs | null;
  isDefaultMail: boolean;
  onSetAutoStart: (v: boolean) => void;
  onSetLaunchMinimized: (v: boolean) => void;
  onRequestDefaultMail: () => void;
  onReplayTour: () => void;
}) {
```

- [ ] **Step 2: Thread it through `SettingsPanel`**

Add `onReplayTour: () => void;` to `SettingsPanel`'s props type and destructuring, and pass it in the `general` case (line ~127):

```tsx
              <GeneralSection
                S={S}
                prefs={prefs}
                isDefaultMail={isDefaultMail}
                onSetAutoStart={onSetAutoStart}
                onSetLaunchMinimized={onSetLaunchMinimized}
                onRequestDefaultMail={onRequestDefaultMail}
                onReplayTour={onReplayTour}
              />
```

- [ ] **Step 3: Pass it from `page.tsx`**

On the `SettingsPanel` element, beside `onRequestDefaultMail`:

```tsx
          onReplayTour={replayTour}
```

- [ ] **Step 4: Typecheck and run the suite**

```bash
npx tsc --noEmit -p renderer/tsconfig.json
npm test
```

Expected: no type errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add renderer/app/settings/GeneralSection.tsx renderer/app/SettingsPanel.tsx renderer/app/page.tsx
git commit -m "feat(tour): offer the tour again from Settings, General"
```

---

### Task 7: Build and verify against the running app

**Files:** none changed unless a defect turns up.

- [ ] **Step 1: Make sure nothing is holding the build or the lock**

A production build while the app or dev server is running poisons `.next`, and the installed app holds the single-instance lock, which makes `electron .` exit 0 in silence.

```bash
tasklist //FI "IMAGENAME eq electron.exe"
tasklist //FI "IMAGENAME eq Gmail Desktop.exe"
```

Expected: `INFO: No tasks are running which match the specified criteria.` for both. If either is running, close it before continuing. An `EPERM` on `.next/trace` later means one is still up.

- [ ] **Step 2: Run the whole suite**

```bash
npm test
```

Expected: every test file passes, including `tour-steps.test.ts`, `strings-sets.test.ts` and `prefs-store.test.ts`.

- [ ] **Step 3: Build both halves**

```bash
npm run build
```

Expected: the Next export completes and `dist-electron/main.js`, `preload.js` and `sidebar-preload.js` are written. If the export fails on `document is not defined` while prerendering, the static `import Shepherd from 'shepherd.js'` in `TourGuide.tsx` is being evaluated in Node; replace it with a dynamic import inside the effect and keep the CSS import at module scope:

```tsx
    void (async () => {
      const { default: Shepherd } = await import('shepherd.js');
      // ...build and start the tour here
    })();
```

- [ ] **Step 4: Smoke-test on a throwaway profile**

A fresh `--user-data-dir` is what makes this the *first* run, and it dodges the installed app's lock.

```bash
npx electron . --user-data-dir="$LOCALAPPDATA/Temp/gmail-desktop-tour-test"
```

- [ ] **Step 5: Walk the checklist**

- [ ] Link one account. The tour appears only *after* the first tab stops being provisional, not on the empty window.
- [ ] The dim layer covers the whole window and the spotlight cut-out sits over the tab strip, then the `+`, then the feedback bubble, then the gear.
- [ ] Gmail is not visible behind the dim; the window is the app's own background.
- [ ] `Next` walks all the way to `Done`; `Back` walks back; the arrow keys do the same.
- [ ] The highlighted gear cannot be clicked while the tour is up.
- [ ] `Done` restores the Gmail view.
- [ ] Restart the app on the same `--user-data-dir`: no tour.
- [ ] Settings, General, `Start tour`: the panel closes and the tour runs.
- [ ] End that tour with Esc: the Gmail view comes back, not a blank window.
- [ ] Switch to dark mode in Settings, Appearance, then replay: the card is `#171717` with light text, and the arrow matches the card rather than staying white.
- [ ] With nothing pinned under Settings, Google apps, the tour has seven steps and never points at empty space.
- [ ] Pin two apps, replay, and the pinned step appears and highlights the first of them.
- [ ] Switch the language to Dutch and replay: every card is Dutch. Turn on Rene mode and replay: every card is the simple Dutch.

- [ ] **Step 6: Commit any fixes and update the changelog**

```bash
git add -A
git commit -m "fix(tour): <what the smoke test found>"
```

Then add the tour to `CHANGELOG.md`. That file is user-facing release notes and is written **in Dutch**, with headings `### Toegevoegd` and `### Opgelost` — this is the one place in the repo where new prose is not English, because it is product text like the `STRINGS_NL` values, not developer documentation. Match the existing register: a bold one-line summary, then two or three sentences explaining why it exists. Add it under `### Toegevoegd` of the topmost version block.

---

## Notes for the executor

- **Do not add a `SAME_IN_BOTH` entry for any `tour*` key.** If `strings-sets.test.ts` reports a tour string as "still English", the Dutch value has not been written. The allowlist is for words Dutch borrowed unchanged, and no tour string is one.
- **Do not wrap the pinned buttons in a container** to make the pinned step highlight the group. Task 4, Step 2 explains what that breaks.
- **Do not make the tour re-run on a version change.** The `whats-new` section is the channel for that, and two of them would compete.
- **Never import a `.tsx` file from a test.** The root `tsconfig.json` compiles `electron` and `tests` without JSX configured, so pulling a component in through an `import type` breaks the whole test compilation. `renderer/app/settings/nav.ts` carries a header comment about exactly this. It is why the step script is a `.ts` module that `TourGuide.tsx` reads, and not the other way round.
- **A mail drop landing mid-tour draws over the tour** and this is accepted, not a bug to fix here. The drop preview is a separate `WebContentsView` that raises itself above the renderer page.
- **The window cannot be dragged by its titlebar while the tour is up.** Shepherd's overlay sits outside the topbar's `-webkit-app-region: drag`. The native window buttons still work. Also accepted.
