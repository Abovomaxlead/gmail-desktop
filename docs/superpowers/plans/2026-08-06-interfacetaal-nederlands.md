# Interfacetaal Nederlands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real Dutch interface alongside English, with a language setting that follows the Windows language by default, leaving Rene mode untouched as an override.

**Architecture:** A pure `resolveLocale` turns the `language` pref plus `app.getLocale()` into `'en' | 'nl'`. Main resolves it once and ships it with the existing prefs push, so the renderer, the context menu and the native dialogs all read the same answer. `getStrings(locale, reneMode)` picks between three string sets, with Rene winning whenever it is on.

**Tech Stack:** TypeScript, Electron 31, Next.js renderer, vitest, Tailwind 3.

## Global Constraints

- Two typechecks, not one. The root `tsconfig.json` **excludes `renderer/`**, so a root-only pass is a false pass for renderer changes: run `npx tsc --noEmit` **and** `npx tsc --noEmit -p renderer/tsconfig.json`.
- Code comments are English, one block at the top of a file, no loose inline remarks.
- **Commit messages are ENGLISH.** Changed mid-execution at the project owner's request. The ten commits already made carry Dutch subjects and are rewritten to English at the end of the plan; every commit from Task 12 onwards is written in English from the start. The CHANGELOG keeps its Dutch and English halves — that instruction was about commits only.
- Every commit message ends with a blank line and then `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. Build it with a heredoc (`git commit <paths> -F - <<'MSG'`) so the blank line survives; passing it through `-m` collapsed it into the subject line on an early commit.
- `STRINGS_NL` is typed `UiStrings`, so TypeScript itself refuses a missing key. `CATEGORY_*` is `Record<string, string>` and is **not** key-checked by the compiler — that one needs the parity test.
- Rene mode always wins over the locale, for strings, context-menu labels and native dialogs alike.
- Tailwind 3 needs bracketed opacity: `border-black/[0.08]`, never `border-black/8`.
- No new dependency. No new settings tab.
- Language names stay in their own language in every set: `'English'` and `'Nederlands'`.

---

### Task 1: resolveLocale (pure)

**Files:**
- Create: `electron/locale.ts`
- Test: `tests/locale.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type LanguagePref = 'system' | 'en' | 'nl'`, `type Locale = 'en' | 'nl'`, `resolveLocale(pref: LanguagePref, systemLocale: string): Locale`.

- [ ] **Step 1: Write the failing test**

Create `tests/locale.test.ts`:

```ts
// Turning the language pref plus the system language into the locale the UI uses.

import { describe, it, expect } from 'vitest';
import { resolveLocale } from '../electron/locale';

describe('resolveLocale', () => {
  it('follows a Dutch system language', () => {
    expect(resolveLocale('system', 'nl')).toBe('nl');
    expect(resolveLocale('system', 'nl-NL')).toBe('nl');
    expect(resolveLocale('system', 'nl-BE')).toBe('nl');
  });

  it('falls back to English for any other system language', () => {
    expect(resolveLocale('system', 'en-US')).toBe('en');
    expect(resolveLocale('system', 'de-DE')).toBe('en');
    expect(resolveLocale('system', 'fr')).toBe('en');
  });

  it('ignores case in the system language', () => {
    expect(resolveLocale('system', 'NL-nl')).toBe('nl');
  });

  it('does not match a language that merely starts with the same letters', () => {
    expect(resolveLocale('system', 'nlx')).toBe('en');
    expect(resolveLocale('system', 'nld')).toBe('en');
  });

  it('lets an explicit choice beat the system language', () => {
    expect(resolveLocale('en', 'nl-NL')).toBe('en');
    expect(resolveLocale('nl', 'en-US')).toBe('nl');
  });

  it('survives a missing or malformed system language', () => {
    expect(resolveLocale('system', '')).toBe('en');
    expect(resolveLocale('system', undefined as unknown as string)).toBe('en');
    expect(resolveLocale('nl', '')).toBe('nl');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/locale.test.ts`
Expected: FAIL — "Failed to load url ../electron/locale".

- [ ] **Step 3: Write minimal implementation**

Create `electron/locale.ts`:

```ts
// The language the interface speaks. 'system' asks Windows, via app.getLocale() at the
// call site, so this stays a pure function. Only Dutch and English exist; anything else
// Windows reports lands on English. The tag is matched on its language subtag alone, so
// nl, nl-NL and nl-BE all count as Dutch while nld does not.

export type LanguagePref = 'system' | 'en' | 'nl';
export type Locale = 'en' | 'nl';

export function resolveLocale(pref: LanguagePref, systemLocale: string): Locale {
  if (pref === 'en' || pref === 'nl') return pref;
  if (typeof systemLocale !== 'string') return 'en';
  return systemLocale.toLowerCase().split('-')[0] === 'nl' ? 'nl' : 'en';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/locale.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add electron/locale.ts tests/locale.test.ts
git commit -m "feat: los de interfacetaal op uit de pref en de systeemtaal"
```

---

### Task 2: The language pref

**Files:**
- Modify: `electron/prefs-store.ts` (type near `theme` on line 124, defaults near line 144, validation near line 226, setter near line 364)
- Test: `tests/prefs-store.test.ts`

**Interfaces:**
- Consumes: `LanguagePref` from Task 1.
- Produces: `Prefs.language: LanguagePref` defaulting to `'system'`; `PrefsStore.setLanguage(v: LanguagePref): void`.

- [ ] **Step 1: Write the failing test**

Add to `tests/prefs-store.test.ts`, inside the existing top-level `describe`:

```ts
it('defaults the language to the system language', () => {
  const store = new PrefsStore(file);
  expect(store.getAll().language).toBe('system');
  expect(DEFAULT_PREFS.language).toBe('system');
});

it('stores an explicit language choice', () => {
  const store = new PrefsStore(file);
  store.setLanguage('nl');
  expect(store.getAll().language).toBe('nl');
  expect(new PrefsStore(file).getAll().language).toBe('nl');
});

it('rejects a language a prefs file from another version may hold', () => {
  const store = new PrefsStore(file);
  store.setLanguage('nl');
  writeFileSync(file, JSON.stringify({ ...store.getAll(), language: 'fr' }));
  expect(new PrefsStore(file).getAll().language).toBe('system');
});
```

Add `writeFileSync` to the existing `node:fs` import at the top of that file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/prefs-store.test.ts`
Expected: FAIL — `language` is `undefined`, and `setLanguage` is not a function.

- [ ] **Step 3: Write the implementation**

In `electron/prefs-store.ts`, import the type at the top:

```ts
import type { LanguagePref } from './locale';
```

Add to the `Prefs` interface, directly under `theme: ThemeChoice;`:

```ts
  language: LanguagePref;
```

Add to `DEFAULT_PREFS`, directly under `theme: 'system',`:

```ts
  language: 'system',
```

Add to the raw-parser, directly under the `theme:` line, mirroring its shape exactly:

```ts
        language: ['system', 'en', 'nl'].includes(raw.language)
          ? raw.language
          : DEFAULT_PREFS.language,
```

Add the setter next to `setTheme`:

```ts
  setLanguage(v: LanguagePref): void {
    this.write({ ...this.getAll(), language: v });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/prefs-store.test.ts`
Expected: PASS, including the three new tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add electron/prefs-store.ts tests/prefs-store.test.ts
git commit -m "feat: de pref voor de interfacetaal, standaard de systeemtaal"
```

---

### Task 3: Main resolves the locale and ships it to the renderer

**Files:**
- Modify: `electron/ipc.ts` (add `SET_LANGUAGE` next to `SET_THEME` on line 54)
- Modify: `electron/main.ts` (`pushPrefs`, a `currentLocale` helper, the `registerIpc` block near the `SET_THEME` handler on line 2592)
- Modify: `electron/sidebar-preload.ts` (next to `setTheme`)
- Modify: `renderer/app/page.tsx` (the `Prefs` interface near line 131, the `DesktopBridge` interface, the `getStrings` call on line 264)
- Modify: `renderer/app/SettingsPanel.tsx` (the `getStrings` call on line 100)
- Modify: `tests/rene-mode.test.ts` (the two `getStrings` calls on lines 51-52)

**Plan gap found during execution, now part of this task.** The plan originally named only `page.tsx:264` as a `getStrings` call site. A grep for the real set found three: `page.tsx:264`, `SettingsPanel.tsx:100`, and `tests/rene-mode.test.ts:51-52`. Because Task 4 changed the signature first, the suite is RED on `tests/rene-mode.test.ts` until this task lands — fixing it is not optional polish, it is a regression this task closes.

**Interfaces:**
- Consumes: `resolveLocale`, `Locale`, `LanguagePref` from Task 1; `setLanguage` from Task 2.
- Produces: `IPC.SET_LANGUAGE = 'prefs:language'`; `window.desktop.setLanguage(v: LanguagePref): void`; the `prefs:changed` payload gains `locale: Locale`; `Prefs.language` and `Prefs.locale` on the renderer type.

- [ ] **Step 1: Add the IPC channel**

In `electron/ipc.ts`, directly under `SET_THEME: 'prefs:theme',`:

```ts
  SET_LANGUAGE: 'prefs:language',
```

- [ ] **Step 2: Resolve and push the locale from main**

In `electron/main.ts`, add to the import block:

```ts
import { resolveLocale, type LanguagePref, type Locale } from './locale';
```

Add next to `pushPrefs`:

```ts
// One place decides the language, so the panel, the context menu and the native dialogs
// cannot disagree. The resolved locale rides along with the prefs push rather than
// being worked out again in the renderer.
function currentLocale(): Locale {
  return resolveLocale(prefs?.getAll().language ?? 'system', app.getLocale());
}
```

Replace the body of `pushPrefs` with:

```ts
function pushPrefs(): void {
  if (prefs) mainWindow?.webContents.send(IPC.PREFS_CHANGED, { ...prefs.getAll(), locale: currentLocale() });
}
```

Add the handler in `registerIpc`, directly under the `SET_THEME` handler:

```ts
  ipcMain.on(IPC.SET_LANGUAGE, (_e, v: LanguagePref) => {
    if (v !== 'system' && v !== 'en' && v !== 'nl') return;
    prefs!.setLanguage(v);
    pushPrefs();
  });
```

- [ ] **Step 3: Expose it on the bridge**

In `electron/sidebar-preload.ts`, next to `setTheme`:

```ts
  setLanguage: (v: 'system' | 'en' | 'nl'): void => ipcRenderer.send(IPC.SET_LANGUAGE, v),
```

- [ ] **Step 4: Teach the renderer about it**

In `renderer/app/page.tsx`, add to the `Prefs` interface next to `reneMode: boolean;`:

```ts
  language: 'system' | 'en' | 'nl';
  locale: 'en' | 'nl';
```

Add to the `DesktopBridge` interface next to `setTheme`:

```ts
  setLanguage(v: 'system' | 'en' | 'nl'): void;
```

Change line 264 from `getStrings(prefs?.reneMode === true)` to:

```ts
  const S = getStrings(prefs?.locale ?? 'en', prefs?.reneMode === true);
```

In `renderer/app/SettingsPanel.tsx`, line 100 reads `const S = getStrings(rene);` and the line above it already derives `rene` from `prefs`. That component has `prefs` in scope, so pass the locale the same way:

```ts
  const S = getStrings(prefs?.locale ?? 'en', rene);
```

In `tests/rene-mode.test.ts`, lines 51-52 call the old one-argument form. The point of that test is that Rene mode picks the table regardless of anything else, so pin the locale and keep the assertion:

```ts
    expect(getStrings('en', false)).toBe(STRINGS_NORMAL);
    expect(getStrings('en', true)).toBe(STRINGS_RENE);
```

- [ ] **Step 5: Verify both typechecks fail only where expected**

Run: `npx tsc --noEmit -p renderer/tsconfig.json`
Expected: FAIL — `getStrings` still takes one argument. That is Task 4's job; do not fix it here.

- [ ] **Step 6: Commit**

```bash
git add electron/ipc.ts electron/main.ts electron/sidebar-preload.ts renderer/app/page.tsx
git commit -m "feat: main bepaalt de taal en stuurt die mee met de prefs"
```

---

### Task 4: getStrings takes a locale

**Files:**
- Modify: `renderer/app/strings.ts` (`CATEGORY_*` around line 276, `COLOR_*` around line 303, `getStrings` at the end)
- Test: `tests/strings-sets.test.ts` (create)

**Interfaces:**
- Consumes: `Locale` from Task 1.
- Produces: `STRINGS_NL: UiStrings`, `CATEGORY_NL`, `COLOR_NL`, and `getStrings(locale: Locale, reneMode: boolean): UiStrings`.

`STRINGS_NL` is introduced here as a spread of the English set so the app keeps compiling and running; Task 6 replaces every value with Dutch and adds the test that forbids leftover English. `CATEGORY_NL` and `COLOR_NL` are small enough to translate for real right away.

- [ ] **Step 1: Write the failing test**

Create `tests/strings-sets.test.ts`:

```ts
// The three string sets must stay interchangeable. UiStrings makes the compiler check
// STRINGS_NL, but CATEGORY_* is a plain Record and only a test can catch a gap there.

import { describe, it, expect } from 'vitest';
import {
  STRINGS_NORMAL,
  STRINGS_RENE,
  STRINGS_NL,
  getStrings,
} from '../renderer/app/strings';

describe('getStrings', () => {
  it('gives English for the English locale', () => {
    expect(getStrings('en', false)).toBe(STRINGS_NORMAL);
  });

  it('gives Dutch for the Dutch locale', () => {
    expect(getStrings('nl', false)).toBe(STRINGS_NL);
  });

  it('lets Rene mode win over either locale', () => {
    expect(getStrings('en', true)).toBe(STRINGS_RENE);
    expect(getStrings('nl', true)).toBe(STRINGS_RENE);
  });
});

describe('the three sets', () => {
  it('carry exactly the same keys', () => {
    const en = Object.keys(STRINGS_NORMAL).sort();
    expect(Object.keys(STRINGS_RENE).sort()).toEqual(en);
    expect(Object.keys(STRINGS_NL).sort()).toEqual(en);
  });

  it('leave no value empty', () => {
    for (const [set, name] of [
      [STRINGS_NORMAL, 'en'],
      [STRINGS_RENE, 'rene'],
      [STRINGS_NL, 'nl'],
    ] as const) {
      for (const [key, value] of Object.entries(set)) {
        const text = render(value);
        if (text === null) continue;
        expect(text.trim(), `${name}.${key} is empty`).not.toBe('');
      }
    }
  });
});
```

Add this helper above the `describe` blocks — 13 of the entries are functions rather than strings (`gaPin`, `updAvailable`, `dropTitle` and friends), and comparing those means calling them:

```ts
// Every parameter gets a 1, which reads as "1" inside a template and as a number where
// one is expected - enough to compare two templates against each other. The two members
// backed by a map (changelogCategory, colorName) do string work on their argument and
// throw on a number; they return null here and are covered by the map key tests instead.
function render(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value !== 'function') return null;
  const fn = value as (...a: unknown[]) => unknown;
  try {
    return String(fn(...Array.from({ length: fn.length }, () => 1)));
  } catch {
    return null;
  }
}
```

Add the map key checks to the same file, since the compiler does not check `CATEGORY_*`:

```ts
describe('the category and colour maps', () => {
  it('carry the same keys in all three sets', () => {
    expect(Object.keys(CATEGORY_NL).sort()).toEqual(Object.keys(CATEGORY_NORMAL).sort());
    expect(Object.keys(CATEGORY_RENE).sort()).toEqual(Object.keys(CATEGORY_NORMAL).sort());
    expect(Object.keys(COLOR_NL).sort()).toEqual(Object.keys(COLOR_NORMAL).sort());
  });

  it('translate every category', () => {
    for (const key of Object.keys(CATEGORY_NORMAL)) {
      expect(CATEGORY_NL[key], `category ${key}`).not.toBe(CATEGORY_NORMAL[key]);
    }
  });
});
```

This requires exporting `CATEGORY_NORMAL`, `CATEGORY_RENE`, `CATEGORY_NL`, `COLOR_NORMAL` and `COLOR_NL` from `renderer/app/strings.ts`; they are module-private today. Add `export` to each.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/strings-sets.test.ts`
Expected: FAIL — `STRINGS_NL` is not exported.

- [ ] **Step 3: Add the Dutch sets and the new signature**

In `renderer/app/strings.ts`, add after `CATEGORY_RENE`:

```ts
const CATEGORY_NL: Record<string, string> = {
  added: 'Toegevoegd',
  fixed: 'Opgelost',
  changed: 'Gewijzigd',
  removed: 'Verwijderd',
  security: 'Beveiliging',
};
```

Add after `COLOR_RENE` (the Rene words are already plain Dutch, so these match):

```ts
const COLOR_NL: Record<ColorKey, string> = {
  blue: 'Blauw',
  red: 'Rood',
  green: 'Groen',
  yellow: 'Geel',
  purple: 'Paars',
  teal: 'Turkoois',
};
```

Add after `STRINGS_RENE`:

```ts
// Filled in with real Dutch by the translation task; a spread of the English set keeps
// the app compiling and running until then.
export const STRINGS_NL: UiStrings = { ...STRINGS_NORMAL };
```

Replace `getStrings`:

```ts
export function getStrings(locale: Locale, reneMode: boolean): UiStrings {
  if (reneMode) return STRINGS_RENE;
  return locale === 'nl' ? STRINGS_NL : STRINGS_NORMAL;
}
```

Add the import at the top of the file:

```ts
import type { Locale } from '../../electron/locale';
```

- [ ] **Step 4: Point the two map-backed members at the Dutch maps**

The maps are not read by exported helpers — they are read from inside the sets themselves, by two function-valued members of `UiStrings`: `changelogCategory` (line 578, reading `CATEGORY_NORMAL`) and `colorName` (line 585, reading `COLOR_NORMAL`), with the Rene set holding its own pair at lines 856 and 863. There is therefore nothing to change outside this file and no signature to update.

Because `STRINGS_NL` is a spread of `STRINGS_NORMAL` at this point, it would inherit the two members that read the *English* maps. Override both after the spread:

```ts
export const STRINGS_NL: UiStrings = {
  ...STRINGS_NORMAL,
  changelogCategory: (heading) => {
    const key = categoryKey(heading);
    return key ? CATEGORY_NL[key] : '';
  },
  colorName: (hex) => {
    const key = colorKey(hex);
    return key ? COLOR_NL[key] : hex;
  },
};
```

- [ ] **Step 5: Run the tests and both typechecks**

Run: `npx vitest run tests/strings-sets.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit && npx tsc --noEmit -p renderer/tsconfig.json`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add renderer/app/strings.ts renderer/app/settings tests/strings-sets.test.ts
git commit -m "feat: getStrings kiest op taal, met de Rene-stand als bovenliggende keuze"
```

---

### Task 5: The setting in Weergave

**Files:**
- Modify: `renderer/app/settings/AppearanceSection.tsx` (a row under the theme select, lines 22-35)
- Modify: `renderer/app/strings.ts` (five keys in all three sets)
- Modify: `renderer/app/SettingsPanel.tsx` if `AppearanceSection` needs the new prop

**Interfaces:**
- Consumes: `window.desktop.setLanguage` from Task 3; `Prefs.language` from Task 2.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Add the five strings to all three sets**

Add to the `UiStrings` interface, next to the `theme*` keys:

```ts
  language: string;
  languageDescription: string;
  languageSystem: string;
  languageEnglish: string;
  languageDutch: string;
```

In `STRINGS_NORMAL`:

```ts
  language: 'Language',
  languageDescription: 'The language of this app. Gmail itself follows your Google account.',
  languageSystem: 'Same as Windows',
  languageEnglish: 'English',
  languageDutch: 'Nederlands',
```

In `STRINGS_RENE`:

```ts
  language: 'Taal',
  languageDescription: 'De taal van deze app. Gmail zelf gaat mee met je Google-account.',
  languageSystem: 'Net als de computer',
  languageEnglish: 'English',
  languageDutch: 'Nederlands',
```

In `STRINGS_NL` — note this set is still a spread of English at this point, so add these as explicit overrides after the spread:

```ts
export const STRINGS_NL: UiStrings = {
  ...STRINGS_NORMAL,
  language: 'Taal',
  languageDescription: 'De taal van deze app. Gmail zelf volgt de taal van je Google-account.',
  languageSystem: 'Gelijk aan Windows',
  languageEnglish: 'English',
  languageDutch: 'Nederlands',
};
```

- [ ] **Step 2: Add the row, copying the theme pattern exactly**

In `renderer/app/settings/AppearanceSection.tsx`, directly after the theme `SettingRow`:

```tsx
        <SettingRow label={S.language} description={S.languageDescription} htmlFor="setting-language">
          <select
            id="setting-language"
            value={prefs?.language ?? 'system'}
            onChange={(e) => window.desktop?.setLanguage(e.target.value as 'system' | 'en' | 'nl')}
            className={FIELD}
          >
            <option value="system">{S.languageSystem}</option>
            <option value="en">{S.languageEnglish}</option>
            <option value="nl">{S.languageDutch}</option>
          </select>
        </SettingRow>
```

- [ ] **Step 3: Run the tests and both typechecks**

Run: `npx vitest run && npx tsc --noEmit && npx tsc --noEmit -p renderer/tsconfig.json`
Expected: all clean. The parity test in Task 4 covers the five new keys automatically.

- [ ] **Step 4: Commit**

```bash
git add renderer/app/strings.ts renderer/app/settings/AppearanceSection.tsx renderer/app/SettingsPanel.tsx
git commit -m "feat: de taalkeuze onder Weergave, naast het thema"
```

---

### Task 6: The Dutch translation

**Files:**
- Modify: `renderer/app/strings.ts` (`STRINGS_NL` becomes a full literal)
- Test: `tests/strings-sets.test.ts` (add the leftover-English test)

**Interfaces:**
- Consumes: everything from Task 4 and Task 5.
- Produces: nothing later tasks depend on.

**Deliberate deviation from the no-placeholders rule:** the Dutch text itself is written during implementation, not pre-written here. Spelling out all ~226 strings in this plan and then copying them into the file would double the work and produce a plan longer than the code it describes. What the plan pins down instead is the register, the glossary, and a test that fails on any untranslated value — so completeness is enforced mechanically rather than by a reviewer comparing two long lists.

**Register:** normal, businesslike Dutch. Address the user as `je`. No exclamation marks. Match the length of the English string roughly, since the panel's layout assumes short labels. This is explicitly *not* Rene's register — compare `STRINGS_RENE.defaultMailClient` ("Mail gaat door deze app") with what this set needs ("Standaard mailprogramma").

**Glossary** — fixed choices, applied everywhere:

| English | Nederlands |
| --- | --- |
| settings | instellingen |
| account | account |
| notification | melding |
| download | download |
| unread | ongelezen |
| tray | systeemvak |
| window | venster |
| tab | tabblad |
| label (Gmail) | label |
| compose | opstellen |
| snooze | uitstellen |
| quiet hours | stille uren |
| default mail client | standaard mailprogramma |
| pinned | vastgezet |
| excluded | uitgesloten |
| verification code | verificatiecode |
| hardware acceleration | hardwareversnelling |
| update | update |
| release notes | releasenotes |

Leave untranslated: `Gmail`, `Google`, `Windows`, `Drive`, `Docs`, `Sheets`, `Slides`, `Keep`, `Chat`, `Calendar`, `Contacts`, `Phishing`, `AppImage`, `English`, `Nederlands`.

- [ ] **Step 1: Write the failing test**

Add to `tests/strings-sets.test.ts`:

```ts
// A value identical to the English one is almost always a forgotten translation. The
// exceptions are words Dutch borrowed unchanged or product names, listed here so that
// adding one is a deliberate act rather than a silent pass.
const SAME_IN_BOTH = new Set([
  'languageEnglish',
  'languageDutch',
]);

describe('STRINGS_NL', () => {
  it('translates every value that is not deliberately shared with English', () => {
    const leftovers: string[] = [];
    for (const key of Object.keys(STRINGS_NORMAL)) {
      if (SAME_IN_BOTH.has(key)) continue;
      const nl = render((STRINGS_NL as Record<string, unknown>)[key]);
      const en = render((STRINGS_NORMAL as Record<string, unknown>)[key]);
      if (nl !== null && en !== null && nl === en) leftovers.push(key);
    }
    expect(leftovers, `still English: ${leftovers.join(', ')}`).toEqual([]);
  });
});
```

This reuses the `render` helper from Task 4, so the 13 function-valued entries are compared as rendered templates rather than skipped.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/strings-sets.test.ts`
Expected: FAIL, listing nearly every key, because `STRINGS_NL` is still a spread of English.

- [ ] **Step 3: Write the translation**

Replace `export const STRINGS_NL: UiStrings = { ...STRINGS_NORMAL, ... }` with a full object literal that has every key of `UiStrings`, translated per the register and glossary above. Work top to bottom through `STRINGS_NORMAL` so no key is skipped, and keep the same key order so the three sets stay diffable side by side.

Thirteen of the entries are functions rather than strings (`gaPin`, `gaUnpin`, `dropTitle`, `updAvailable`, `dhBytes` and the rest). Translate the template and keep the parameter and its position. Two of the thirteen — `changelogCategory` and `colorName` — were already given their Dutch bodies in Task 4 and need no further work.

Add `SAME_IN_BOTH` entries only for values that are genuinely identical in both languages, and only after checking there is no Dutch word for it.

- [ ] **Step 4: Run the test until the list is empty**

Run: `npx vitest run tests/strings-sets.test.ts`
Expected: PASS. The failure message names every key still to do, so iterate against it.

- [ ] **Step 5: Run the full suite and both typechecks**

Run: `npx vitest run && npx tsc --noEmit && npx tsc --noEmit -p renderer/tsconfig.json`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add renderer/app/strings.ts tests/strings-sets.test.ts
git commit -m "feat: de Nederlandse stringset, met een test tegen achtergebleven Engels"
```

---

### Task 7: Context-menu labels

**Files:**
- Modify: `electron/context-menu.ts` (add `LABELS_NL` after `LABELS_RENE` on line 102)
- Modify: `electron/main.ts` (the `attachContextMenu` call near line 2632)
- Test: `tests/context-menu-labels.test.ts` (create)

This task owns its own test file on purpose. It runs in parallel with the renderer chain, which owns `tests/strings-sets.test.ts`; two agents writing one file in a shared tree corrupt each other.

**Interfaces:**
- Consumes: `currentLocale()` from Task 3.
- Produces: `LABELS_NL: ContextMenuLabels`.

- [ ] **Step 1: Write the failing test**

Create `tests/context-menu-labels.test.ts`:

```ts
// The three sets of context-menu labels, which live in main rather than in the
// renderer's string sets and so need their own key check.

import { describe, it, expect } from 'vitest';
import { LABELS_NORMAL, LABELS_RENE, LABELS_NL } from '../electron/context-menu';

describe('context menu labels', () => {
  it('carry the same keys in all three sets', () => {
    const en = Object.keys(LABELS_NORMAL).sort();
    expect(Object.keys(LABELS_RENE).sort()).toEqual(en);
    expect(Object.keys(LABELS_NL).sort()).toEqual(en);
  });

  it('keep the %s placeholder in the search label', () => {
    expect(LABELS_NL.searchGoogle).toContain('%s');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/strings-sets.test.ts`
Expected: FAIL — `LABELS_NL` is not exported.

- [ ] **Step 3: Add the Dutch labels**

In `electron/context-menu.ts`, after `LABELS_RENE`:

```ts
export const LABELS_NL: ContextMenuLabels = {
  undo: 'Ongedaan maken',
  redo: 'Opnieuw',
  cut: 'Knippen',
  copy: 'Kopiëren',
  paste: 'Plakken',
  pasteMatchStyle: 'Plakken zonder opmaak',
  selectAll: 'Alles selecteren',
  copyLink: 'Linkadres kopiëren',
  openLink: 'Link openen in browser',
  copyImage: 'Afbeelding kopiëren',
  copyImageAddress: 'Afbeeldingsadres kopiëren',
  searchGoogle: 'Zoek “%s” met Google',
};
```

- [ ] **Step 4: Pick the set on locale in main**

In `electron/main.ts`, import `LABELS_NL` alongside the other two, and replace the `attachContextMenu` callback near line 2632:

```ts
    attachContextMenu(wc, () => {
      if (prefs?.getAll().reneMode) return LABELS_RENE;
      return currentLocale() === 'nl' ? LABELS_NL : LABELS_NORMAL;
    });
```

- [ ] **Step 5: Run the test and the typecheck**

Run: `npx vitest run tests/strings-sets.test.ts && npx tsc --noEmit`
Expected: PASS and clean.

- [ ] **Step 6: Commit**

```bash
git add electron/context-menu.ts electron/main.ts tests/strings-sets.test.ts
git commit -m "feat: Nederlandse labels in het contextmenu"
```

---

### Task 8: The native account dialog

**Files:**
- Create: `electron/native-labels.ts`
- Modify: `electron/main.ts` (`chooseComposeAccount`, lines 616-640)
- Test: `tests/native-labels.test.ts`

**Interfaces:**
- Consumes: `Locale` from Task 1, `currentLocale()` from Task 3.
- Produces: `nativeLabels(locale: Locale, reneMode: boolean): NativeLabels` with fields `composeTitle`, `composeMessage`, `cancel`.

- [ ] **Step 1: Write the failing test**

Create `tests/native-labels.test.ts`:

```ts
// The text on the native dialogs main puts up itself, which cannot reach the renderer's
// string sets.

import { describe, it, expect } from 'vitest';
import { nativeLabels } from '../electron/native-labels';

describe('nativeLabels', () => {
  it('speaks English for the English locale', () => {
    expect(nativeLabels('en', false).composeMessage).toBe('Send from which account?');
  });

  it('speaks Dutch for the Dutch locale', () => {
    expect(nativeLabels('nl', false).composeMessage).toBe('Vanaf welk account wil je versturen?');
  });

  it('lets Rene mode win over either locale', () => {
    expect(nativeLabels('en', true)).toBe(nativeLabels('nl', true));
  });

  it('fills every field in every variant', () => {
    for (const [locale, rene] of [['en', false], ['nl', false], ['en', true]] as const) {
      const l = nativeLabels(locale, rene);
      for (const [key, value] of Object.entries(l)) {
        expect(value.trim(), `${locale}/${rene} ${key} is empty`).not.toBe('');
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/native-labels.test.ts`
Expected: FAIL — "Failed to load url ../electron/native-labels".

- [ ] **Step 3: Write the implementation**

Create `electron/native-labels.ts`:

```ts
// Text for the dialogs main raises by itself. The renderer's string sets are out of
// reach here, so these three live separately, with the same precedence as everywhere
// else: Rene mode first, then the locale. Returning one frozen object per variant keeps
// the Rene comparison in the tests an identity check.

import type { Locale } from './locale';

export interface NativeLabels {
  composeTitle: string;
  composeMessage: string;
  cancel: string;
}

const EN: NativeLabels = {
  composeTitle: 'New message',
  composeMessage: 'Send from which account?',
  cancel: 'Cancel',
};

const NL: NativeLabels = {
  composeTitle: 'Nieuw bericht',
  composeMessage: 'Vanaf welk account wil je versturen?',
  cancel: 'Annuleren',
};

const RENE: NativeLabels = {
  composeTitle: 'Nieuw mailtje',
  composeMessage: 'Van wie moet het mailtje komen?',
  cancel: 'Laat maar',
};

export function nativeLabels(locale: Locale, reneMode: boolean): NativeLabels {
  if (reneMode) return RENE;
  return locale === 'nl' ? NL : EN;
}
```

- [ ] **Step 4: Use it in chooseComposeAccount**

In `electron/main.ts`, add the import:

```ts
import { nativeLabels } from './native-labels';
```

In `chooseComposeAccount`, replace the three hardcoded strings:

```ts
  const L = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true);
  const cancelId = labels.length;
  const chosen = dialog.showMessageBoxSync(mainWindow!, {
    type: 'question',
    title: L.composeTitle,
    message: L.composeMessage,
    buttons: [...labels, L.cancel],
    cancelId,
    defaultId: 0,
  });
```

- [ ] **Step 5: Confirm no English user-facing text is left in main**

Run: `npx vitest run tests/native-labels.test.ts && npx tsc --noEmit`
Expected: PASS and clean.

Then grep for stragglers and read each hit to confirm it is a channel name, a log line or a value passed in from the string sets, not text a user reads:

```bash
grep -n "title: '\|message: '\|buttons: \[" electron/main.ts
```

- [ ] **Step 6: Commit**

```bash
git add electron/native-labels.ts electron/main.ts tests/native-labels.test.ts
git commit -m "feat: de accountkeuze-dialoog spreekt de taal van de app"
```

---

### Task 11: The two other native dialogs main raises itself

Added during execution. Task 8's closing grep found that `chooseComposeAccount` was not the only place main writes English at the user. Two more exist, and the agreed scope is everything the app draws itself, so they belong here. My inventory during design claimed the remaining dialogs took their text from the renderer's string sets; that was true for most, and wrong for these two.

The third grep hit, `title: 'Downloads'` on the folder picker (~line 2312), needs no work: the word is identical in Dutch.

**Files:**
- Modify: `electron/native-labels.ts` (extend `NativeLabels` and all three variants)
- Modify: `electron/main.ts` (the update notification ~line 1811; the link-confirmation box ~line 2060)
- Test: `tests/native-labels.test.ts` (extend)

**Interfaces:**
- Consumes: `nativeLabels(locale, reneMode)` from Task 8, `currentLocale()` from Task 3.
- Produces: `NativeLabels` gains `updateAvailableTitle`, `updateAvailableBody(version)`, `linkOpenButton`, `linkMessage(host)`, `linkDetail(url)`, `linkAlwaysAllow(host)`. The existing `cancel` is reused by the link box.

- [ ] **Step 1: Extend the interface and the three variants**

Add to `NativeLabels`:

```ts
  updateAvailableTitle: string;
  updateAvailableBody: (version: string) => string;
  linkOpenButton: string;
  linkMessage: (host: string) => string;
  linkDetail: (url: string) => string;
  linkAlwaysAllow: (host: string) => string;
```

Add to `EN`:

```ts
  updateAvailableTitle: 'Update available',
  updateAvailableBody: (version) => `Gmail Desktop ${version} is ready. Click to update.`,
  linkOpenButton: 'Open link',
  linkMessage: (host) => `Open ${host}?`,
  linkDetail: (url) => `This link leaves Gmail Desktop and opens in your browser.\n\n${url}`,
  linkAlwaysAllow: (host) => `Always allow ${host}`,
```

Add to `NL`:

```ts
  updateAvailableTitle: 'Update beschikbaar',
  updateAvailableBody: (version) => `Gmail Desktop ${version} staat klaar. Klik om bij te werken.`,
  linkOpenButton: 'Link openen',
  linkMessage: (host) => `${host} openen?`,
  linkDetail: (url) => `Deze link verlaat Gmail Desktop en gaat open in je browser.\n\n${url}`,
  linkAlwaysAllow: (host) => `${host} altijd toestaan`,
```

Add to `RENE`:

```ts
  updateAvailableTitle: 'Er is iets nieuws',
  updateAvailableBody: (version) => `Gmail Desktop ${version} is klaar. Klik hier om het nieuw te maken.`,
  linkOpenButton: 'Link openen',
  linkMessage: (host) => `${host} openen?`,
  linkDetail: (url) => `Deze link gaat naar je browser en niet naar deze app.\n\n${url}`,
  linkAlwaysAllow: (host) => `${host} mag altijd`,
```

- [ ] **Step 2: Use them at both call sites**

The update notification, replacing the hardcoded `title` and `body`:

```ts
  const L = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true);
  const n = new Notification({
    title: L.updateAvailableTitle,
    body: L.updateAvailableBody(version),
  });
```

The link-confirmation box, replacing `buttons`, `message`, `detail` and `checkboxLabel` and leaving every other field of that object untouched:

```ts
  const L = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true);
  const box = {
    type: 'question' as const,
    noLink: true,
    buttons: [L.linkOpenButton, L.cancel],
    defaultId: 1,
    cancelId: 1,
    message: L.linkMessage(host),
    detail: L.linkDetail(shown),
    checkboxLabel: L.linkAlwaysAllow(host),
    checkboxChecked: false,
  };
```

Note the button order is load-bearing: `defaultId` and `cancelId` are both `1`, meaning Cancel. Keep Open first and Cancel second so those indices still point where they did.

- [ ] **Step 3: Extend the test**

```ts
describe('nativeLabels — the other dialogs', () => {
  it('translates the update notification', () => {
    expect(nativeLabels('en', false).updateAvailableTitle).toBe('Update available');
    expect(nativeLabels('nl', false).updateAvailableTitle).toBe('Update beschikbaar');
  });

  it('keeps the version in the update body in every variant', () => {
    for (const [locale, rene] of [['en', false], ['nl', false], ['en', true]] as const) {
      expect(nativeLabels(locale, rene).updateAvailableBody('1.2.3')).toContain('1.2.3');
    }
  });

  it('keeps the host and the url in the link box in every variant', () => {
    for (const [locale, rene] of [['en', false], ['nl', false], ['en', true]] as const) {
      const l = nativeLabels(locale, rene);
      expect(l.linkMessage('example.com')).toContain('example.com');
      expect(l.linkAlwaysAllow('example.com')).toContain('example.com');
      expect(l.linkDetail('https://example.com/x')).toContain('https://example.com/x');
    }
  });
});
```

- [ ] **Step 4: Run and commit**

Run: `npx vitest run tests/native-labels.test.ts && npx vitest run && npx tsc --noEmit`

```bash
git commit electron/native-labels.ts electron/main.ts tests/native-labels.test.ts -F - <<'MSG'
feat: de update-melding en de link-vraag spreken de taal van de app

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 10: Lock the context-menu register against collapsing into Rene's

Added during execution. The Task 7 review confirmed that its key-parity test would still pass if `LABELS_NL` were `{ ...LABELS_RENE }` — so "normal Dutch, not Rene's childlike register" was enforced by review alone. One test closes that.

Eight of the twelve labels genuinely differ between the two registers. The other four — `cut`, `copy`, `paste`, `pasteMatchStyle` — are correct normal Dutch *and* correct Rene Dutch, so they are allowlisted rather than forced apart.

**Files:**
- Test: `tests/context-menu-labels.test.ts` (extend)

**Interfaces:**
- Consumes: `LABELS_NORMAL`, `LABELS_RENE`, `LABELS_NL` from `electron/context-menu.ts`.
- Produces: nothing.

- [ ] **Step 1: Add the test**

```ts
// Four labels read the same in both registers - "Knippen", "Kopiëren", "Plakken" and
// "Plakken zonder opmaak" are simply the right Dutch either way. The other eight are
// where Rene's register shows, so those are the ones that must not drift back into it.
const SHARED_WITH_RENE = new Set(['cut', 'copy', 'paste', 'pasteMatchStyle']);

describe('LABELS_NL register', () => {
  it('does not fall back to Rene wording where the two registers differ', () => {
    const collapsed: string[] = [];
    for (const key of Object.keys(LABELS_NORMAL) as (keyof typeof LABELS_NORMAL)[]) {
      if (SHARED_WITH_RENE.has(key)) continue;
      if (LABELS_NL[key] === LABELS_RENE[key]) collapsed.push(key);
    }
    expect(collapsed, `Rene wording leaked into LABELS_NL: ${collapsed.join(', ')}`).toEqual([]);
  });

  it('keeps the two clearest register markers', () => {
    expect(LABELS_NL.undo).toBe('Ongedaan maken');
    expect(LABELS_NL.redo).toBe('Opnieuw');
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/context-menu-labels.test.ts`
Expected: PASS. Then sanity-check that it can fail: temporarily set `LABELS_NL.undo` to `'Terug'`, confirm both tests fail, and revert.

- [ ] **Step 3: Commit**

```bash
git commit tests/context-menu-labels.test.ts -F - <<'MSG'
test: leg vast dat de Nederlandse menulabels niet terugvallen op Rene-taal

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 12: Fix the Rene wording I got wrong, and pin it with a test

Added during execution, from the Task 8 and Task 11 reviews. Three of these are my errors in earlier task text, not implementer deviations — the strings were specified wrong in the brief and implemented faithfully.

**Files:**
- Modify: `electron/native-labels.ts`
- Test: `tests/native-labels.test.ts` (extend)

**Interfaces:**
- Consumes: `nativeLabels(locale, reneMode)`.
- Produces: no signature change.

- [ ] **Step 1: Fix the three Rene strings that are not in Rene's register**

`RENE.linkOpenButton` and `RENE.linkMessage` are currently byte-identical to `NL`, and `RENE.updateAvailableBody` reads as a mistranslation rather than a simplification. Replace them:

```ts
  updateAvailableBody: (version) => `Gmail Desktop ${version} is er. Klik hier om hem op te halen.`,
  linkOpenButton: 'Doe maar',
  linkMessage: (host) => `Naar ${host} gaan?`,
```

`'Doe maar'` pairs with the `cancel` of `'Laat maar'` that this variant already uses, which is the register the mode is for. `'ophalen'` is concrete where `'nieuw maken'` was neither clear nor correct.

- [ ] **Step 2: Polish one NL string**

`NL.linkDetail` currently reads "…en gaat open in je browser". Parallel with "verlaat" it should be:

```ts
  linkDetail: (url) => `Deze link verlaat Gmail Desktop en opent in je browser.\n\n${url}`,
```

- [ ] **Step 3: Make the shared objects actually immutable**

The file's header comment claims one "frozen" object per variant, but nothing is frozen, and those objects are now handed to three separate call sites. Mark the interface fields `readonly` and freeze each variant, so the comment becomes true rather than aspirational:

```ts
export interface NativeLabels {
  readonly composeTitle: string;
  readonly composeMessage: string;
  readonly cancel: string;
  readonly updateAvailableTitle: string;
  readonly updateAvailableBody: (version: string) => string;
  readonly linkOpenButton: string;
  readonly linkMessage: (host: string) => string;
  readonly linkDetail: (url: string) => string;
  readonly linkAlwaysAllow: (host: string) => string;
}
```

and wrap each variant: `const EN: NativeLabels = Object.freeze({ ... });`, likewise `NL` and `RENE`.

- [ ] **Step 4: Pin the register so it cannot collapse again**

Rene's whole point is a different register. Nothing currently fails if `RENE` is set to `NL`. Add:

```ts
// Rene mode exists to say things differently, so its wording must not equal the normal
// Dutch. cancel is the only field where both registers could reasonably land on the same
// word, and they do not today, so every field is checked.
describe('the Rene variant', () => {
  it('says everything differently from normal Dutch', () => {
    const nl = nativeLabels('nl', false);
    const rene = nativeLabels('nl', true);
    const same: string[] = [];
    for (const key of Object.keys(nl) as (keyof typeof nl)[]) {
      const a = nl[key];
      const b = rene[key];
      const av = typeof a === 'function' ? a('x') : a;
      const bv = typeof b === 'function' ? b('x') : b;
      if (av === bv) same.push(key);
    }
    expect(same, `Rene wording equals normal Dutch: ${same.join(', ')}`).toEqual([]);
  });
});
```

- [ ] **Step 5: Prove the new test can fail**

Temporarily set `RENE.linkOpenButton` to `'Link openen'` (its old, wrong value), run the test, confirm it fails naming `linkOpenButton`, then revert and confirm `git diff` is clean before committing.

- [ ] **Step 6: Run and commit**

Run: `npx vitest run tests/native-labels.test.ts && npx vitest run && npx tsc --noEmit`

```bash
git commit electron/native-labels.ts tests/native-labels.test.ts -F - <<'MSG'
fix: put the Rene dialog labels back in Rene's own register

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 13: The rest of the text main writes itself

Added during execution, from Task 11's closing inventory. The agreed scope is everything the app draws itself, and five more places were still writing fixed text at the user — three in English, and two in Dutch that ignore the language setting entirely and so show Dutch to an English user.

**Files:**
- Modify: `electron/native-labels.ts` (extend `NativeLabels` and all three frozen variants)
- Modify: `electron/update-popup.ts` (take the labels as an argument; stay pure)
- Modify: `electron/main.ts` (four call sites)
- Test: `tests/native-labels.test.ts` (extend)
- Test: `tests/update-popup.test.ts` (9 call sites gain the labels argument)

**Second plan gap of the same kind, found during execution.** The file list first omitted `tests/update-popup.test.ts`, which calls `updateCheckPopup` nine times with one argument; giving the function a required second parameter breaks all nine. Cause: I wrote the file list without grepping for callers, exactly as I had with `getStrings` in Task 3. The only two callers are `main.ts:1770` and that test file, so adding it closes the set. The alternative — an optional parameter with a hardcoded English fallback — was rejected because it would put the English strings back inside `update-popup.ts`, which is the thing this task removes.

Each of the nine calls takes `nativeLabels('en', false)` as its second argument, which keeps the file's existing English assertions valid and makes it verify that the labels actually flow through.

**Interfaces:**
- Consumes: `nativeLabels(locale, reneMode)`, `currentLocale()`.
- Produces: `NativeLabels` gains `ok`, `download`, `later`, `updateDevOnly`, `updateAvailableMessage(version?)`, `updateLatestMessage(version?)`, `updateCheckFailed`, `accountNotAddedTitle`, `accountNotAddedBody(email, error)`, `testNotificationBody`, `downloadCompleteTitle`, `downloadCancelledTitle`, `downloadFailedTitle`, `noSubject`. `updatePopup` gains a `NativeLabels` parameter.

**One decision already made for you.** `NO_SUBJECT` in `electron/dropzone.ts` is `'(geen onderwerp)'` and is used in four places. Only ONE of them is text a user reads: the notification body at `main.ts:1466`. The other three (`main.ts:951`, `main.ts:1187`, and `dropzone.ts:149`) put that value into saved `.eml` metadata and into folder names for saved mail. Those are DATA, not interface, and must not start varying by interface language — a user who switches to English should not get differently-named folders. So: localise the notification at `main.ts:1466` through `L.noSubject`, and leave `NO_SUBJECT` and its three data uses exactly as they are.

- [ ] **Step 1: Extend `NativeLabels` and the three variants**

Add these members, `readonly`, alongside the existing nine, and give all three frozen variants a value for each. Keep the explicit parameter type annotations the file already uses on its arrow members.

English:

```ts
  ok: 'OK',
  download: 'Download',
  later: 'Later',
  updateDevOnly: 'Update checks only work in the installed app.',
  updateAvailableMessage: (version?: string) => `A new version${version ? ` (v${version})` : ''} is available.`,
  updateLatestMessage: (version?: string) => `You already have the latest version${version ? ` (v${version})` : ''}.`,
  updateCheckFailed: "Couldn't check for updates.",
  accountNotAddedTitle: 'Account not added',
  accountNotAddedBody: (email: string, error: string) =>
    `${email} is not linked to Gmail, so the account was not added. ${error}`,
  testNotificationBody: 'This is what a notification looks like.',
  downloadCompleteTitle: 'Download complete',
  downloadCancelledTitle: 'Download cancelled',
  downloadFailedTitle: 'Download failed',
  noSubject: '(no subject)',
```

Dutch:

```ts
  ok: 'OK',
  download: 'Downloaden',
  later: 'Later',
  updateDevOnly: 'Zoeken naar updates werkt alleen in de geïnstalleerde app.',
  updateAvailableMessage: (version?: string) => `Er is een nieuwe versie${version ? ` (v${version})` : ''}.`,
  updateLatestMessage: (version?: string) => `Je hebt de nieuwste versie al${version ? ` (v${version})` : ''}.`,
  updateCheckFailed: 'Zoeken naar updates is niet gelukt.',
  accountNotAddedTitle: 'Account niet toegevoegd',
  accountNotAddedBody: (email: string, error: string) =>
    `${email} is niet gekoppeld aan Gmail, dus het account is niet toegevoegd. ${error}`,
  testNotificationBody: 'Zo ziet een melding eruit.',
  downloadCompleteTitle: 'Download klaar',
  downloadCancelledTitle: 'Download gestopt',
  downloadFailedTitle: 'Download mislukt',
  noSubject: '(geen onderwerp)',
```

Rene, in its own simplified register — this must not repeat the Dutch above, and a test enforces that:

```ts
  ok: 'Oké',
  download: 'Ophalen',
  later: 'Straks',
  updateDevOnly: 'Kijken of er iets nieuws is kan hier niet.',
  updateAvailableMessage: (version?: string) => `Er is iets nieuws${version ? ` (v${version})` : ''}.`,
  updateLatestMessage: (version?: string) => `Je hebt al de nieuwste${version ? ` (v${version})` : ''}.`,
  updateCheckFailed: 'Kijken of er iets nieuws is lukte niet.',
  accountNotAddedTitle: 'Dit account doet niet mee',
  accountNotAddedBody: (email: string, error: string) =>
    `${email} hoort niet bij Gmail, dus dit account doet niet mee. ${error}`,
  testNotificationBody: 'Zo ziet een berichtje eruit.',
  downloadCompleteTitle: 'Het is opgehaald',
  downloadCancelledTitle: 'Ophalen gestopt',
  downloadFailedTitle: 'Ophalen lukte niet',
  noSubject: '(zonder titel)',
```

- [ ] **Step 2: Make `update-popup.ts` take its text as an argument**

That module builds the four update dialogs and currently hardcodes English. Add a `NativeLabels` parameter to its exported function and read every message and button from it — `updateDevOnly` with `[ok]`, `updateAvailableMessage(status.version)` with `[download, later]`, `updateLatestMessage(status.currentVersion)` with `[ok]`, and `updateCheckFailed` with `[ok]`. Keep the module pure: it must not import `nativeLabels` or resolve a locale itself. The caller in `main.ts` passes `nativeLabels(currentLocale(), prefs?.getAll().reneMode === true)`.

- [ ] **Step 3: The four call sites in `main.ts`**

Each resolves labels the same way, via the existing `currentLocale()` — never a second resolver:

1. The `update-popup` caller: pass the labels through.
2. The account-not-added notification (~line 578): `title: L.accountNotAddedTitle`, `body: L.accountNotAddedBody(email, result.error)`.
3. `showTestNotification`: replace the `'This is what a notification looks like.'` fallback with `L.testNotificationBody`. Leave the `hidden.hiddenSubject ??` guard in front of it exactly as it is.
4. The download notification (~line 2137): replace the three-way ternary with `done ? L.downloadCompleteTitle : state === 'cancelled' ? L.downloadCancelledTitle : L.downloadFailedTitle`. At `main.ts:1466`, replace only the `NO_SUBJECT` in that notification body with `L.noSubject`.

- [ ] **Step 4: Extend the tests**

The existing register test already walks every field of the two Dutch variants and requires none to be equal, so your new members are covered by it automatically — but `ok` is `'OK'` in NL and `'Oké'` in Rene, so check that it passes rather than assuming. Add:

```ts
describe('nativeLabels — the update popup and notifications', () => {
  it('keeps the version optional in the update messages', () => {
    for (const [locale, rene] of [['en', false], ['nl', false], ['en', true]] as const) {
      const l = nativeLabels(locale, rene);
      expect(l.updateAvailableMessage('1.2.3')).toContain('1.2.3');
      expect(l.updateAvailableMessage()).not.toContain('undefined');
      expect(l.updateLatestMessage()).not.toContain('undefined');
    }
  });

  it('keeps the address and the error in the account notice', () => {
    for (const [locale, rene] of [['en', false], ['nl', false], ['en', true]] as const) {
      const body = nativeLabels(locale, rene).accountNotAddedBody('a@b.com', 'boom');
      expect(body).toContain('a@b.com');
      expect(body).toContain('boom');
    }
  });
});
```

- [ ] **Step 5: Confirm nothing is left**

Re-run the inventory and read each hit:

```bash
grep -n "title: '\|message: '\|message: \`\|buttons: \[\|body: \|detail: \|label: '" electron/main.ts electron/update-popup.ts electron/dropzone.ts
```

Report anything still hardcoded that a user reads. Do not fix beyond the sites named above.

- [ ] **Step 6: Run and commit**

Run: `npx vitest run && npx tsc --noEmit`

```bash
git commit electron/native-labels.ts electron/update-popup.ts electron/main.ts tests/native-labels.test.ts -F - <<'MSG'
feat: the update dialogs and notifications speak the app's language

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 15: The tray menu, and the last two strays

Added during execution, and the largest gap in my design inventory. During brainstorming I claimed the app's own text was the settings panel, the context menu and a few dialogs. An exhaustive sweep of every user-facing field in `electron/` — `title`, `message`, `body`, `detail`, `label`, `buttons` and friends — found that **the entire system-tray menu is English**, in a file I never opened. My earlier check looked for tray labels inside `main.ts` and found none, and I concluded there was nothing; the menu lives in `electron/tray-controller.ts`.

Eighteen strings across four functions, plus two strays.

**Files:**
- Create: `electron/tray-labels.ts`
- Modify: `electron/tray-controller.ts`
- Modify: `electron/main.ts` (the tray call sites)
- Modify: `electron/update-popup.ts` (one `detail` line)
- Modify: `electron/native-labels.ts` (one member for that detail line)
- Modify: `electron/compose-window.ts` (the window title)
- Test: `tests/tray-labels.test.ts` (create)
- Test: `tests/tray-controller.test.ts` (about 15 assertions gain a labels argument)
- Test: `tests/native-labels.test.ts` (extend)

**Why a new module rather than more of `native-labels.ts`.** That file is already at roughly 23 members serving dialogs and notifications. Eighteen more would make it a grab-bag of two unrelated surfaces. `tray-labels.ts` mirrors its shape exactly — three `Object.freeze`d variants, `readonly` members, explicit arrow-parameter types, and a `trayLabels(locale: Locale, reneMode: boolean): TrayLabels` with Rene winning over the locale — so there is one pattern to learn, applied twice.

**How the labels reach the functions.** `TrayState` already carries everything these functions need. Add `labels: TrayLabels` to it, which covers `snoozeStatusLabel(state)`, `trayMenuTemplate(state)`, `buildTrayMenu(state)`, `createTray(image, state)` and `updateTrayMenu(tray, state)` without touching their signatures. Only `updateItemLabel(status, isPackaged)` does not receive the state, so it gains a third parameter: `updateItemLabel(status, isPackaged, L)`. `main.ts` builds the state and puts `trayLabels(currentLocale(), prefs?.getAll().reneMode === true)` in it — resolved through the existing `currentLocale()`, never a second resolver.

**The keys.** `open`, `quit`, `startAtLogin`, `snoozeNotifications`, `notificationsOff`, `snoozedUntil(time)`, `snoozeFor10`, `snoozeFor30`, `snoozeFor1Hour`, `snoozeUntilTurnedOn`, `turnNotificationsOn`, `checkForUpdates`, `checkForUpdatesDev`, `checkingForUpdates`, `downloadUpdate(version?)`, `downloadingUpdate(percent)`, `restartToInstall`, `updateCheckFailed`. The English values are already in `electron/tray-controller.ts` — lift them verbatim so nothing changes for an English user.

**Dutch and Rene are authored during implementation, not pre-written here** — the same deliberate deviation as Task 6, for the same reason: writing 36 strings into this plan and then copying them into code is duplicated work, and completeness is enforced mechanically instead. The register rules and glossary from Task 6's brief apply unchanged: businesslike Dutch addressing the user as `je` for `NL`, and the simplified childlike register for `RENE`, which must not merely repeat the Dutch.

- [ ] **Step 1: Create `electron/tray-labels.ts`**

Copy the structure of `electron/native-labels.ts` exactly: a `readonly` interface, three `Object.freeze`d variants with explicit arrow-parameter types, and `trayLabels(locale, reneMode)` returning the shared object per variant with Rene first. Lift the English values from `tray-controller.ts` verbatim.

- [ ] **Step 2: Write the tests first**

Create `tests/tray-labels.test.ts` with three guards, modelled on `tests/native-labels.test.ts`:
one asserting Rene wins over either locale by object identity (`toBe`); one asserting every field of `trayLabels('nl', false)` differs from `trayLabels('nl', true)`, rendering function members by calling them; and one asserting every field of `trayLabels('nl', false)` differs from `trayLabels('en', false)`, with an explicit allowlist for any word that is genuinely identical in both languages, each entry justified in your report.

Render function members by driving the argument count from `fn.length` rather than passing a fixed number of arguments — a member given too few arguments yields the literal text "undefined" inside a template, which passes a non-empty check on a broken field. Two earlier tests in this plan hardcoded the count and inherited exactly that blind spot.

Run them and watch them fail before Step 3.

- [ ] **Step 3: Thread the labels through `tray-controller.ts`**

Add `labels: TrayLabels` to `TrayState`, add the third parameter to `updateItemLabel`, and replace all eighteen literals with reads from the labels. Change no logic: the `snoozeActive` branch order, the `dev`/`busy` guards and the menu item order all stay as they are.

- [ ] **Step 4: Update `main.ts` and the existing tray test**

`main.ts` puts the resolved labels into the state it builds. `tests/tray-controller.test.ts` has roughly 15 assertions on exact English text: give its `state()` helper `labels: trayLabels('en', false)` and pass that same value as `updateItemLabel`'s third argument. Keep every assertion comparing against the literal English text rather than against `EN.someKey` — an assertion that compares a constant to itself proves nothing.

- [ ] **Step 5: The last two strays**

`electron/update-popup.ts:31` still hardcodes `` `You have v${status.currentVersion} installed.` ``. Add `updateInstalledDetail(version: string)` to `NativeLabels` in all three variants and read it there. English keeps the current wording exactly.

`electron/compose-window.ts:27` sets `title: 'New message'` on the compose window. `NativeLabels.composeTitle` already holds exactly that string in all three variants — pass the resolved labels in from `main.ts` and use it, rather than adding a second copy.

Leave `main.ts:2319`'s `title: 'Downloads'` alone: the word is identical in Dutch, and this is a native folder-picker title. Note in your report that the Rene variant would say something different, so the next person can decide.

- [ ] **Step 6: Prove the register test bites, then run everything**

Temporarily set one `RENE` value equal to its `NL` counterpart, confirm the register test fails naming that key, revert, and confirm `git diff` shows only intended changes.

Run: `npx vitest run && npx tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git commit electron/tray-labels.ts electron/tray-controller.ts electron/main.ts electron/update-popup.ts electron/native-labels.ts electron/compose-window.ts tests/tray-labels.test.ts tests/tray-controller.test.ts tests/native-labels.test.ts -F - <<'MSG'
feat: the tray menu speaks the app's language

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 17: Remove the two compose settings and the Gmail tab

Added during execution, at the project owner's decision. "Always compose in a new window" is broken in a way that is worse than not working: the preload intercepts the compose click and calls `preventDefault()` before main decides what to do, and `openComposeForAccount` silently returns for a delegated mailbox because `idxOfKey` yields `null` for anything that is not an `authuser`. With the switch on, a delegated mailbox's compose button is dead — no new window, and not the normal in-Gmail behaviour either.

Rather than fix it, the owner chose removal. "Close the compose window after sending" goes with it: it was gated on the first switch, and its only remaining consumer would be the `mailto:` path.

**What must keep working:** the `mailto:` route. `dispatchMailto` → `openComposeWindow(index, fields)` → `openCompose` stays. Only the click interception and the close-after-send plumbing go. `tests/mailto.test.ts` and `tests/compose-url.test.ts` must still pass untouched.

**Files:**
- Delete: `renderer/app/settings/GmailSection.tsx`
- Delete: `electron/compose-preload.ts`
- Modify: `package.json` (drop `electron/compose-preload.ts` from the `build:main` esbuild entry list)
- Modify: `renderer/app/SettingsPanel.tsx` (import, the `sectionLabel` case, the render case)
- Modify: `renderer/app/settings/nav.ts` (the `'gmail'` union member and its entry in the order array)
- Modify: `renderer/app/strings.ts` (six keys from the interface and from all three sets)
- Modify: `renderer/app/page.tsx` (`Prefs.gmail`, `setGmail` on `DesktopBridge`)
- Modify: `electron/prefs-store.ts` (`GmailPrefs`, the `gmail` field, its defaults, its validation, `setGmail`)
- Modify: `electron/ipc.ts` (`SET_GMAIL`, `GMAIL_TWEAKS`, `COMPOSE_REQUEST`, `COMPOSE_SENT`, `GmailTweakState`)
- Modify: `electron/sidebar-preload.ts` (`setGmail`)
- Modify: `electron/preload.ts` (`COMPOSE_BUTTON_SELECTOR`, `isComposeClick`, the tweaks state, the `GMAIL_TWEAKS` listener, the click listener, the `GmailTweakState` import)
- Modify: `electron/profile-view-manager.ts` (`lastGmailTweaks`, the `onCompose` constructor parameter, the `COMPOSE_REQUEST` branch, the `GMAIL_TWEAKS` send on load, the `pushGmailTweaks` method, the import)
- Modify: `electron/main.ts` (`COMPOSE_PRELOAD_PATH`, `pushGmailTweaks`, the `SET_GMAIL` handler, `openComposeForAccount`, the `onCompose` argument to `ProfileViewManager`, and the `closeAfterSend` branch inside `openComposeWindow`)
- Modify: `electron/compose-window.ts` (the now-unused `preloadPath` parameter and its spread)
- Test: `tests/settings-nav.test.ts` (drop `'gmail'` from the expected order)
- Test: `tests/strings-sets.test.ts` (drop `'navGmail'` from `SAME_IN_BOTH`, since the key no longer exists and the stale-allowlist guard would otherwise fail)

**Six strings to remove from the interface and all three sets:** `navGmail`, `gmailComposeGroup`, `gmailComposeNewWindow`, `gmailComposeNewWindowDescription`, `gmailCloseCompose`, `gmailCloseComposeDescription`.

- [ ] **Step 1: Remove the renderer surface**

Delete `GmailSection.tsx`. Remove its import and both `case 'gmail':` arms from `SettingsPanel.tsx`. Remove `'gmail'` from the `SettingsSection` union and from the ordered array in `nav.ts`. Remove the six keys from `strings.ts` — the interface and all three sets.

Note the stale-allowlist guard added earlier: `tests/strings-sets.test.ts` asserts every `SAME_IN_BOTH` entry names a real key, so `'navGmail'` must come out of that set in the same change or the suite goes red.

- [ ] **Step 2: Remove the preferences**

`GmailPrefs` holds exactly these two fields and nothing else, so the whole interface goes, along with `Prefs.gmail`, its defaults block, its validation in the raw parser, and `setGmail`. Then `Prefs.gmail` and `setGmail` come off the renderer's types in `page.tsx`, and `setGmail` off the bridge in `sidebar-preload.ts`.

A prefs file written by an older version will still contain a `gmail` object. The parser builds its result field by field rather than spreading the raw input, so an unknown key is dropped on the next write with no migration needed — confirm that is still true rather than assuming it.

- [ ] **Step 3: Remove the click interception**

In `electron/preload.ts`, remove `COMPOSE_BUTTON_SELECTOR`, `isComposeClick`, the `tweaks` variable, the `GMAIL_TWEAKS` listener, the whole `document.addEventListener('click', ...)` block that used them, and the `GmailTweakState` import. Leave every other listener in that file alone.

In `electron/profile-view-manager.ts`, remove `lastGmailTweaks`, the `pushGmailTweaks` method, the `GMAIL_TWEAKS` send in the load handler, the `COMPOSE_REQUEST` branch, the `onCompose` constructor parameter and the `GmailTweakState` import. `onCompose` is the LAST constructor parameter, so removing it does not shift any other argument — verify that before you touch `main.ts`.

- [ ] **Step 4: Remove the main-process plumbing**

Remove `COMPOSE_PRELOAD_PATH`, `pushGmailTweaks`, the `SET_GMAIL` handler, `openComposeForAccount`, and the final `(acctKey) => openComposeForAccount(acctKey)` argument in the `new ProfileViewManager(...)` call.

Simplify `openComposeWindow` to the shape the `mailto:` path needs:

```ts
function openComposeWindow(index: number, fields?: MailtoFields): void {
  const title = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true).composeTitle;
  openCompose(index, title, fields);
}
```

Then delete `electron/compose-preload.ts`, drop it from the `build:main` script in `package.json`, and remove the now-unused `preloadPath` parameter and its `...(preloadPath ? { preload: preloadPath } : {})` spread from `electron/compose-window.ts`.

- [ ] **Step 5: Verify the mailto path still works**

Run `npx vitest run tests/mailto.test.ts tests/compose-url.test.ts` — both must pass with no edits. Then the full suite, both typechecks, and `npm run build`, which is what proves the `package.json` entry-list change is right.

Finally, grep for every symbol you removed and confirm no reference survives:

```bash
grep -rn "alwaysComposeInNewWindow\|closeComposeAfterSend\|GmailTweakState\|GMAIL_TWEAKS\|COMPOSE_REQUEST\|COMPOSE_SENT\|SET_GMAIL\|setGmail\|isComposeClick\|COMPOSE_BUTTON_SELECTOR\|pushGmailTweaks\|onCompose\|COMPOSE_PRELOAD_PATH\|compose-preload\|GmailSection\|navGmail\|GmailPrefs" --include=*.ts --include=*.tsx --include=*.json . | grep -v node_modules | grep -v '.claude/worktrees' | grep -v package-lock
```

- [ ] **Step 6: Commit**

The working tree carries unrelated uncommitted work from other features, so the commit lists every path explicitly. Deletions need `git rm` first; `git commit <paths>` will not record a file you only removed from disk.

```bash
git rm renderer/app/settings/GmailSection.tsx electron/compose-preload.ts
git commit renderer/app/settings/GmailSection.tsx electron/compose-preload.ts \
  package.json renderer/app/SettingsPanel.tsx renderer/app/settings/nav.ts \
  renderer/app/strings.ts renderer/app/page.tsx electron/prefs-store.ts \
  electron/ipc.ts electron/sidebar-preload.ts electron/preload.ts \
  electron/profile-view-manager.ts electron/main.ts electron/compose-window.ts \
  tests/settings-nav.test.ts tests/strings-sets.test.ts -F - <<'MSG'
feat: drop the two compose settings and the Gmail tab

The "always compose in a new window" switch was worse than inert: the preload
cancelled the compose click before main decided anything, and main silently gave
up for a delegated mailbox, so the button did nothing at all. "Close after send"
only existed to serve it. Both are gone, along with the now-empty Gmail tab, the
gmail preferences, the click interception and the compose-sent preload. Opening
a compose window from a mailto: link is untouched.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

Use `git commit -a` here rather than a path list ONLY IF the working tree has no unrelated changes; otherwise list your paths explicitly. Check `git status` first and decide.

---

### Task 18: A designed account picker for the mailto flow

Added at the project owner's request, with the design approved before implementation. Today a `mailto:` link with more than one account raises `dialog.showMessageBoxSync` — a row of Windows buttons carrying account labels and nothing else. It throws away the recipient and the subject that `parseMailto` already extracted, and it cannot show an avatar, an address or the account colour. It asks "which account?" without showing what the question is about.

**Depends on Task 17**, which removes the compose settings and rewrites `openComposeWindow`. Both touch `main.ts`; run this one after.

**Files:**
- Create: `renderer/app/compose-account/page.tsx`
- Create: `renderer/lib/compose-account.ts` (the payload type and a pure `pickerRows` helper)
- Modify: `electron/ipc.ts` (two channels)
- Modify: `electron/sidebar-preload.ts` (two bridge methods)
- Modify: `renderer/app/page.tsx` (the two bridge methods on `DesktopBridge`)
- Modify: `electron/main.ts` (`chooseComposeAccount` becomes async and overlay-driven; `dispatchMailto` becomes async)
- Modify: `renderer/app/strings.ts` (four keys in all three sets)
- Test: `tests/compose-account.test.ts` (create)

#### The design, as approved

**Colour.** No new palette. The six account colours in `electron/palette.ts` already exist and each account owns one; those are the only colour here. Everything else is the greys the settings panel uses. A palette invented for this dialog would make it look like a different product from the bar those accounts live in.

**Type.** No webfont — this is an offline desktop app, so a remote font is a request that never lands plus a flash of unstyled text. Personality comes from scale and weight only: the recipient at 20px/600 is the largest thing on screen, account names at 13.5px/500 (the settings panel's row size), addresses at 12px in the hint grey.

**Layout.** The overlay spans the content area with a transparent background, as `maildrop` does, and the page centres a card of 420px in the upper third. The area around the card is a translucent scrim; clicking it cancels.

```
  Nieuw bericht aan                      ← 12px hint grey, eyebrow
  klant@voorbeeld.nl                     ← 20px/600, largest on screen
  Betreft: Vraag over de levering        ← 13px hint, omitted when absent

  Verstuur vanaf                         ← 12px hint, eyebrow
 ┌──────────────────────────────────────┐
 ▌1   (avatar)  Luca Manuel             │ ← 3px colour edge, numeral in that colour
 │              luca@...                │
 ├──────────────────────────────────────┤
 ▌2   (avatar)  Info                    │
 │              info@...                │
 └──────────────────────────────────────┘
                            Esc sluit
```

**Signature element, and the one deliberate risk: the numerals.** They are set at 15px/600 in the account's own colour at the leading edge, so they read as part of the identity block rather than as a list marker. They are not decoration — pressing `2` picks row 2. This dialog exists to be gone within a second, so making the shortcut the most prominent structural element teaches it on first use and then makes itself redundant. The 3px colour edge is the same device the topbar already uses along the bottom of the active tab, turned a quarter.

**Deliberately absent:** no shadow or lift on hover. The colour edge plus a background tint is enough, and a third hover signal would be the accessory to remove.

**Keyboard, which is the point.** `1`–`9` pick directly. `ArrowUp`/`ArrowDown` move a focus ring, `Enter` takes the focused row, `Esc` cancels. The first row is focused on open so `Enter` alone works. Every row is a real `<button>` so focus and screen readers come free.

#### Steps

- [ ] **Step 1: The pure part, with its test**

Create `renderer/lib/compose-account.ts`:

```ts
export interface ComposeAccountChoice {
  index: number;
  email: string;
  label: string;
  color: string;
  avatarUrl: string;
}

export interface ComposeAccountAsk {
  to: string;
  subject: string;
  accounts: ComposeAccountChoice[];
  locale: 'en' | 'nl';
  reneMode: boolean;
}

/** The digit that picks a row, or null past the ninth. Rows beyond nine are pickable by click only. */
export function shortcutFor(row: number): string | null {
  return row >= 0 && row < 9 ? String(row + 1) : null;
}

/** Maps a keypress to a row index, or null when the key is not a shortcut for this list. */
export function rowForKey(key: string, count: number): number | null {
  if (!/^[1-9]$/.test(key)) return null;
  const row = Number(key) - 1;
  return row < count ? row : null;
}
```

Test `tests/compose-account.test.ts`: `shortcutFor` gives `'1'` for row 0 and `null` for row 9; `rowForKey('2', 3)` is `1`; `rowForKey('4', 3)` is `null` because the list is shorter; `rowForKey('a', 3)` and `rowForKey('0', 3)` are `null`.

- [ ] **Step 2: The two IPC channels and the bridge**

In `electron/ipc.ts`:

```ts
  COMPOSE_ACCOUNT_ASK: 'compose:account-ask',
  COMPOSE_ACCOUNT_PICK: 'compose:account-pick',
```

In `electron/sidebar-preload.ts`:

```ts
  onComposeAccountAsk: (cb: (arg: unknown) => void): void => {
    ipcRenderer.on(IPC.COMPOSE_ACCOUNT_ASK, (_e, arg) => cb(arg));
  },
  pickComposeAccount: (index: number | null): void =>
    ipcRenderer.send(IPC.COMPOSE_ACCOUNT_PICK, index),
```

Declare both on `DesktopBridge` in `renderer/app/page.tsx`, typing the callback argument as `ComposeAccountAsk`.

- [ ] **Step 3: The page**

Create `renderer/app/compose-account/page.tsx`, following `renderer/app/reconnect/page.tsx` for the shape: `'use client'`, a `<style>{'html,body{background:transparent}'}</style>` first so Gmail never flashes behind it, and a header comment block explaining what it is.

Take the strings from `getStrings(ask.locale, ask.reneMode)` using the locale that arrives IN the payload — do not resolve it here and do not fetch prefs. A short-lived dialog that asked for prefs would render one frame in the wrong language.

The card:

```tsx
<div className="flex h-screen w-full items-start justify-center bg-black/20 pt-[12vh]">
  <div className="w-[420px] overflow-hidden rounded-2xl border border-black/[0.08] bg-white shadow-2xl dark:border-white/[0.08] dark:bg-neutral-900">
```

The recipient block, where the address is the headline rather than a title like "Choose an account":

```tsx
    <div className="px-5 pt-4 pb-3">
      <p className="text-xs text-neutral-500">{S.composePickerTo}</p>
      <p className="mt-0.5 truncate text-[20px] font-semibold leading-7" title={ask.to}>{ask.to}</p>
      {ask.subject ? (
        <p className="mt-1 truncate text-[13px] text-neutral-500" title={ask.subject}>
          {S.composePickerSubject} {ask.subject}
        </p>
      ) : null}
    </div>
```

Each row, with the colour edge and the functional numeral:

```tsx
      <button
        type="button"
        onClick={() => pick(i)}
        className="flex w-full items-center gap-3 py-2.5 pr-4 text-left transition hover:bg-black/[0.04] focus-visible:bg-black/[0.04] focus-visible:outline-none dark:hover:bg-white/5 motion-reduce:transition-none"
      >
        <span aria-hidden className="h-9 w-[3px] shrink-0 rounded-r" style={{ backgroundColor: a.color }} />
        <span aria-hidden className="w-4 shrink-0 text-center text-[15px] font-semibold tabular-nums" style={{ color: a.color }}>
          {shortcutFor(i)}
        </span>
        {/* avatar, then label over address, both truncating */}
      </button>
```

Wire the keyboard on a `keydown` listener: `rowForKey` for the digits, arrows to move focus among the row refs, `Enter` on the focused row, `Esc` and a scrim click both calling `pickComposeAccount(null)`.

- [ ] **Step 4: Four strings in all three sets**

`composePickerTo`, `composePickerSubject`, `composePickerFrom`, `composePickerEsc`.

English: `'New message to'`, `'Subject:'`, `'Send from'`, `'Esc closes'`.
Dutch: `'Nieuw bericht aan'`, `'Betreft:'`, `'Verstuur vanaf'`, `'Esc sluit'`.
Rene, in its own simplified register and not a repeat of the Dutch: `'Een mailtje naar'`, `'Waarover:'`, `'Van wie komt het?'`, `'Esc is weg'`.

The existing tests enforce that all three sets carry the same keys, that no value is empty, that the Dutch differs from the English, and — for the label sets — that Rene differs from Dutch. Run them.

- [ ] **Step 5: Make the choice asynchronous in main**

This is the real cost of leaving the native dialog, and where a mistake will hide. `chooseComposeAccount` becomes:

```ts
function chooseComposeAccount(fields: MailtoFields): Promise<number | null> {
  const authusers = profiles.filter((p) => p.ref.kind === 'authuser');
  if (authusers.length === 0) return Promise.resolve(null);
  if (authusers.length === 1) return Promise.resolve(authIdx(authusers[0]));
  // ... open the overlay, resolve on COMPOSE_ACCOUNT_PICK, resolve null on close
}
```

Guard three things, each of which is a real failure rather than a hypothetical:

1. **A second `mailto:` arriving while the picker is open.** Keep one pending promise; if the picker is already open, ignore the new request rather than stacking two dialogs whose answers cross.
2. **The window closing with the picker open.** Resolve `null` so nothing awaits forever.
3. **`ipcMain.once` versus `on`.** Use a single registered handler that reads the current pending resolver, not `once` per open — a cancelled dialog otherwise leaves a stale listener that answers the next one.

`dispatchMailto` becomes `async` and awaits it. Trace every caller: `flushPendingMailto`, the `second-instance` handler, the `open-url` handler and the cold-start flush. Each must handle a promise — `void dispatchMailto(url)` where the result is unused.

- [ ] **Step 6: Verify, including by hand**

Run `npx vitest run`, both typechecks, and `npm run build`.

Then check by hand, because none of this is unit-testable: with two or more accounts, send a `mailto:` from outside the app and confirm the picker appears with the recipient and subject filled in; that `1` and `2` pick directly; that arrows plus `Enter` work; that `Esc` and a scrim click cancel without opening a compose window; that a single-account setup still opens compose with no picker at all; and that it renders correctly in Rene mode, where the renderer zoom is 2.

- [ ] **Step 7: Commit**

```bash
git commit renderer/app/compose-account/page.tsx renderer/lib/compose-account.ts \
  electron/ipc.ts electron/sidebar-preload.ts renderer/app/page.tsx electron/main.ts \
  renderer/app/strings.ts tests/compose-account.test.ts -F - <<'MSG'
feat: a designed account picker for mailto links

The native message box could only show account labels as a row of buttons, and
threw away the recipient and subject that parseMailto already had. The picker now
leads with the address the mail is going to, renders each account as the from-line
it will become — its own colour, avatar and address — and answers to the number
keys, so the common case is one keystroke.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 19: Make the account picker its own window

Added at the project owner's request: the picker should be a standalone window so it has focus the moment it appears.

**Why this is the right change and not just a preference.** The trigger comes from outside the app — a `mailto:` in a browser, a PDF, Slack — so focus has to be taken anyway. An `OverlayView` is a `WebContentsView` inside the main window, so it can only receive keys once that window is focused, and it is invisible altogether when the main window is minimised or hidden to the tray. A `BrowserWindow` shows and focuses itself, which is what makes the digit shortcuts work on the first keypress.

**Files:**
- Create: `electron/compose-account-window.ts`
- Modify: `electron/main.ts` (`chooseComposeAccount`, `settleComposeAccount`, drop the `OverlayView` for this feature)
- Modify: `renderer/app/compose-account/page.tsx` (the card becomes the window; a visible cancel appears)
- Modify: `renderer/app/strings.ts` (one key in all three sets)

- [ ] **Step 1: The window module**

Create `electron/compose-account-window.ts`, mirroring the shape of `electron/compose-window.ts`. It creates the window and nothing else — main owns the promise and the lifecycle.

```ts
export function openComposeAccountWindow(
  parent: BrowserWindow,
  preloadPath: string,
  url: string,
  rows: number,
  zoom: number,
): BrowserWindow
```

- `frame: false`, `transparent: true`, `backgroundColor: '#00000000'` — the page paints a rounded card with a border and a shadow, as `renderer/app/reconnect/page.tsx` already does.
- `resizable: false`, `minimizable: false`, `maximizable: false`, `skipTaskbar: true`, `parent`, `alwaysOnTop: true`.
- `show: false`, then `win.once('ready-to-show', () => { win.show(); win.focus(); })`. Showing before the first paint is what produces a white flash on a transparent window.
- `webPreferences: { preload: preloadPath, contextIsolation: true }`.

**Sizing, which is the part that will be wrong if it is not derived.** The card is 420 wide. Height is `92 + rows * 56 + 44` — header, one row each, footer. Both dimensions multiply by `zoom`. Then `win.center()`.

**Rene mode does not come for free here.** `applyReneZoom` sets the zoom factor on the main window and its views; a brand-new window starts at 1, so in Rene mode the picker would render small while the whole app around it is doubled. Pass the zoom in, apply it with `win.webContents.setZoomFactor(zoom)` before load, and multiply the window size by it. Main computes `zoom` as `prefs?.getAll().reneMode ? RENE_ZOOM_FACTOR : 1`.

- [ ] **Step 2: Rework the lifecycle in main**

Replace the `OverlayView` for this feature. Create the window per ask and destroy it on settle — reuse would carry state between two unrelated questions for no gain, since the picker is short-lived.

`settleComposeAccount(index)` must: read and null the resolver first, then destroy the window, then resolve. In that order, so the `closed` handler cannot re-enter and settle a second time.

Keep all three existing guards, and add a fourth:

4. **The user closes the window** — Alt+F4, or the taskbar. `win.on('closed', () => settleComposeAccount(null))` covers it. Because `settleComposeAccount` nulls the resolver before destroying, the destroy triggered by a click already cleared it and the `closed` handler harmlessly no-ops.

The existing `mainWindow` `'closed'` guard stays. Also destroy the picker if the main window goes away while it is open, or it outlives its parent.

- [ ] **Step 3: The page becomes the window**

The scrim exists because the overlay covered the app. A standalone window has nothing behind it to dim, so remove the `bg-black/20` wrapper and the click-to-cancel on it: the card now fills the window.

Replace the outer wrapper with a full-bleed card:

```tsx
<div className="flex h-screen w-full flex-col overflow-hidden rounded-2xl border border-black/[0.08] bg-white shadow-2xl dark:border-white/[0.08] dark:bg-neutral-900">
```

Keep `<style>{'html,body{background:transparent}'}</style>` as the first element — with a transparent window it is what stops Chromium painting an opaque rectangle around the rounded corners.

**A frameless window has no close button, so Esc must not be the only way out.** Add a real cancel button in the footer, beside the existing Esc hint, calling the same `pickComposeAccount(null)`:

```tsx
<button type="button" onClick={() => cancel()} className={/* the settings panel's BUTTON token */}>
  {S.composePickerCancel}
</button>
```

New string `composePickerCancel` in all three sets: English `'Cancel'`, Dutch `'Annuleren'`, Rene `'Laat maar'` — the last matching the word that variant already uses for cancelling elsewhere.

#### Review findings this task must also close

Task 18's review returned two Critical and four Important findings. Moving to a window is the fix for both Criticals, which is why they are folded in here rather than repaired in the overlay first.

**Critical 1 — the keyboard was unreachable, so the numerals were decoration.** `OverlayView.open()` never calls `webContents.focus()`, and nothing in `electron/` does; keys went to the Gmail view underneath. A `BrowserWindow` with `show()` then `focus()` takes real OS focus, which is what makes this work. Verify it by hand, because no unit test reaches it.

**Critical 2 — the promise never settled, wedging every later mailto.** The guard sat on `'closed'`, but `shouldHideOnClose` returns `!isQuitting`, so `main.ts` prevents `close` and hides; `'closed'` fires only when quitting. A dedicated window closes for real, so its own `'closed'` is sound. Keep the `mainWindow` guard as well, and settle on the main window's `hide` too — that covers the tray toggle.

**Important 1 — the second mailto is dropped AND mis-attributed.** Returning `null` matches the letter of "ignore", but the second `mailto:` arrives through `second-instance`, which focuses the window first. The user clicks a link for B, sees the picker still headlined with A's address, presses `1`, and composes to A. The recipient being the headline is what makes the wrong headline so convincing. Fix it with machinery that already exists: in the guard branch set `pendingMailto = mailtoUrl` and drain it in `settleComposeAccount`, so the second link is asked about after the first is answered instead of vanishing.

**Important 2 — a stale instance could wedge the feature permanently.** `composeAccountOverlay` was never nulled after the window died. Creating the window per ask and destroying it on settle removes the whole class; make sure the module variable is nulled too.

**Important 3 — the focused row was invisible.** Focus used `focus-visible:bg-black/[0.04]`, the same tint as hover, and Chromium generally will not match `:focus-visible` for a programmatic `.focus()`, so the "first row is focused so Enter alone works" affordance showed nothing at all. The component already tracks `focusIndex` — drive a visible ring from it rather than from a CSS pseudo-class, which also makes the state assertable.

**Important 4 — nine or more accounts clipped with no way to scroll.** The design supports nine shortcuts, so nine-plus rows is in scope. Give the row list `max-h` and `overflow-y-auto`, as `renderer/app/maildrop/page.tsx` does, and cap the window height at something the screen can hold rather than growing it without limit.

**Two Rene strings are wrong, and they are mine.** `Van wie komt het?` asks who *sent* this — the opposite of choosing a sender, and the native dialog it replaced said `Van wie moet het mailtje komen?`, where `moet … komen` carried the "choose" sense. And `Esc is weg` says "Esc is missing". Replace with:

```
composePickerFrom  (RENE): 'Van wie moet het komen?'
composePickerEsc   (RENE): 'Met Esc ga je weg'
composePickerSubject (RENE): 'Dit gaat over:'   // 'Waarover:' reads like a form field
```

**Also fold in, all small:** clear the previous ask so a reopened picker cannot flash the last recipient (create-per-ask already handles this — confirm it); and note in the report that `dark:` variants are inert in overlay and standalone pages because `darkMode: 'class'` is only toggled on the main document, so the card always renders light. Do not fix that here — it is pre-existing and affects `maildrop` and `reconnect` too.

- [ ] **Step 4: Verify**

`npx vitest run`, both typechecks, and `npm run build:main` — that last one is safe, is only esbuild over `electron/`, never touches `.next`, and is what puts the change into `dist-electron`, which the running app actually loads. Do NOT run the full `npm run build`; the dev server holds a lock on `.next`.

Then say plainly in the report that the focus behaviour, the sizing and the Rene zoom cannot be verified without a human at the running app, and list exactly what to try.

- [ ] **Step 5: Commit**

```bash
git commit electron/compose-account-window.ts electron/main.ts \
  renderer/app/compose-account/page.tsx renderer/app/strings.ts -F - <<'MSG'
feat: give the account picker its own focused window

As an overlay inside the main window the picker could only take keys once that
window had focus, and it was invisible when the window was minimised or hidden to
the tray — while the thing that triggers it always comes from another app. It is
now a frameless window that shows and focuses itself, sized from the number of
accounts and scaled with the Rene zoom factor, with a real cancel button since a
frameless window has no close box.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 16: Close the review findings from Tasks 13 and 15

All three verified still present in the code, not assumed.

**Files:**
- Modify: `tests/native-labels.test.ts`, `tests/update-popup.test.ts`, `tests/tray-controller.test.ts`
- Modify: `electron/native-labels.ts`, `electron/tray-labels.ts`, `renderer/app/strings.ts`

- [ ] **Step 1: The arity blind spot is live — port the helper that already solves it**

`tests/native-labels.test.ts:24` still reads `const filled = typeof value === 'function' ? value('x') : value;`. With the two-parameter `accountNotAddedBody`, that renders `"… undefined"`, which passes a non-empty check on a broken field. `tests/tray-labels.test.ts` already contains the correct helper — `fn(...Array(fn.length).fill('x'))` — with a comment explaining why a fixed count is wrong. Port it here and use it in every place that renders a function member, including the `a('x','x')` at line 73.

Then prove it bites: temporarily change one two-parameter member to drop its second interpolation, confirm a test fails, revert.

- [ ] **Step 2: Nothing proves the popup and the tray read their labels**

Every assertion in `tests/update-popup.test.ts` and `tests/tray-controller.test.ts` runs the English variant and compares against the English literal, so reinstating a hardcoded English string inside either module leaves the suite green. Add one Dutch-path assertion to each — keep every existing assertion on its literal English text, because comparing a constant to itself proves nothing:

```ts
// update-popup
expect(updateCheckPopup({ state: 'dev' }, nativeLabels('nl', false)).message).toContain('geïnstalleerde app');
// tray-controller
expect(updateItemLabel({ state: 'downloaded' }, true, trayLabels('nl', false))).toContain('installeren');
```

- [ ] **Step 3: One failure, three different Dutch sentences**

The same event reads three ways, and two of them are reachable one after the other — the tray item relabels itself, and clicking it opens a dialog that says something else:

| where | now |
| --- | --- |
| `electron/tray-labels.ts:67` | `'Controleren op updates is mislukt'` |
| `electron/native-labels.ts:80` | `'Zoeken naar updates is niet gelukt.'` |
| `renderer/app/strings.ts:1155` | `'Controleren op updates lukte niet: ${message}'` |

Settle on `controleren`, which is what the settings panel already uses, and make all three agree in wording and in whether they carry a full stop. Rene is already consistent across the two label files — leave it.

While there, the Dutch wording nits from the same review: `downloadCancelledTitle` is `'Download gestopt'` where a cancelled download is `geannuleerd`; `downloadCompleteTitle` is `'Download klaar'` where `voltooid` matches the register; `snoozeFor10/30/1Hour` read `'Voor 10 minuten'`, a calque where Dutch drops the preposition — `'10 minuten'`, which is also shorter in a menu that cannot wrap; and `downloadUpdate` puts the version after the verb, `'Update downloaden v0.2.0'`, where Dutch wants `'Update v0.2.0 downloaden'`.

- [ ] **Step 4: Verify and commit**

`npx vitest run`, both typechecks, `npm run build:main` (safe — esbuild over `electron/` only, never touches `.next`).

```bash
git commit tests/native-labels.test.ts tests/update-popup.test.ts tests/tray-controller.test.ts \
  electron/native-labels.ts electron/tray-labels.ts renderer/app/strings.ts -F - <<'MSG'
fix: close the review findings on the label sets

The completeness test rendered function members with a fixed argument count, so a
two-parameter member produced the literal text "undefined" and passed. Nothing
proved the update popup or the tray menu read their labels at all, since every
assertion ran the English variant against the English literal. And one failed
update check had three different Dutch sentences, two of them reachable in a row.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 21: The overlay routes ignore the language setting

Added during execution, at the project owner's decision, and it corrects a claim I made: after Task 15 I reported that everything the app draws itself was translated. It was not. The overlay renderer routes never went through the string sets at all.

| file | `getStrings` | hardcoded Dutch |
| --- | --- | --- |
| `renderer/app/maildrop/page.tsx` | 0 | 13 |
| `renderer/app/reconnect/page.tsx` | 0 | 3 |
| `renderer/app/reconnect-text.ts` | 0 | 4 |

Twenty strings in fixed Dutch that ignore the setting entirely, so an English user reads Dutch there. Same defect class as the two found in `main.ts`, in a layer my inventory never covered — it swept `electron/`, not the renderer routes.

**Files:**
- Modify: `renderer/app/maildrop/page.tsx`, `renderer/app/reconnect/page.tsx`, `renderer/app/reconnect-text.ts`
- Modify: `renderer/app/strings.ts` (twenty keys in all three sets)
- Modify: `electron/main.ts` (both overlays' payloads carry the locale)

**The pattern is already established** — `renderer/app/compose-account/page.tsx` does it correctly: the payload carries `locale` and `reneMode`, and the page calls `getStrings(locale, reneMode)`. Copy that, and do NOT have these pages resolve a locale or fetch prefs; a page that waited on a prefs round trip would render its first frame in the wrong language.

`reconnect-text.ts` is a pure module that builds a heading from an account list, so give `reconnectHeading` the strings as an argument rather than importing them — it stays pure and its existing tests keep working with an explicit set passed in.

- [ ] **Step 1** — move all twenty strings into `UiStrings` and all three sets, keeping the existing Dutch as the `nl` value where it is already good, writing English for `STRINGS_NORMAL`, and writing genuinely simplified Rene wording. The existing tests enforce key parity, non-emptiness and NL≠EN; run them rather than assuming.
- [ ] **Step 2** — add `locale` and `reneMode` to both overlay payloads in `electron/main.ts` and read them in the pages.
- [ ] **Step 3** — `npx vitest run`, both typechecks, `npm run build:main`.
- [ ] **Step 4** — commit with an English message describing which two screens stopped ignoring the setting.

---

### Task 9: Changelog and the whole-app check

**Files:**
- Modify: `CHANGELOG.md` (the `### Toegevoegd` block of `## [Nog niet uitgebracht]`, and the matching `### Added` block)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Write the changelog entry**

Add to `### Toegevoegd` under `## [Nog niet uitgebracht]`, in the Dutch half:

```markdown
- **De app spreekt Nederlands.** Bij Instellingen → Weergave staat naast het thema een
  keuze voor de taal: gelijk aan Windows, English of Nederlands. Standaard volgt de app
  je Windows-taal, dus op een Nederlandse computer is er niets te zetten. Alles wat de
  app zelf tekent gaat mee — het instellingenpaneel, het contextmenu en de vraag vanaf
  welk account je een mailtje verstuurt. Gmail zelf volgt de taal van je Google-account,
  daar gaat deze keuze niet over. De Rene-stand blijft doen wat hij deed en gaat voor op
  deze keuze.
```

Add the mirror entry to the `### Added` block in English.

- [ ] **Step 2: Run everything**

```bash
npx vitest run
npx tsc --noEmit
npx tsc --noEmit -p renderer/tsconfig.json
npm run build
```

Expected: all four clean.

- [ ] **Step 3: Check it in the running app**

Build and install, then walk the four states: Windows-Dutch with the pref on `Same as Windows`, the pref forced to `English`, the pref forced to `Nederlands`, and Rene mode on top of each. Confirm the panel, a right-click menu and a `mailto:` link with two accounts all speak the expected language, and that switching the select changes the panel without a restart.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog-notitie voor de Nederlandse interface"
```

---

## Self-Review

**Spec coverage.** Each decision in `docs/superpowers/specs/2026-08-06-interfacetaal-nederlands-design.md` maps to a task: decision 1 → Tasks 4 and 6; decision 2 → Task 2; decision 3 → Task 1; decision 4 → Task 3; decision 5 → Tasks 4 and 6; decision 6 → Tasks 7 and 8; decision 7 → Task 5; decision 8 → the tests in Tasks 1, 4, 6, 7 and 8. Nothing in the spec is unclaimed.

**Placeholders.** One deliberate deviation, called out and justified in Task 6: the Dutch strings are produced at implementation time against a fixed glossary and a test that fails on any value still equal to its English counterpart. Every other step carries its actual code. Task 8 Step 5 asks the implementer to work from grep output rather than a pre-written list, and gives the command.

**Two errors found and fixed while checking the plan against the code.** Task 4 Step 4 first claimed the category and colour maps were read by exported helpers with call sites in `WhatsNewSection.tsx` and `AccountsSection.tsx`. They are not: they are read from inside the string sets by two function-valued members, `changelogCategory` and `colorName`, so nothing outside `strings.ts` changes. The step now says that and shows the two overrides. Second, the completeness tests skipped anything that was not a string — which would have waved through all 13 function-valued entries, `gaPin` and `updAvailable` among them. Both tests now render function entries by calling them and compare the results.

**Type consistency.** `LanguagePref` and `Locale` come from `electron/locale.ts` in Task 1 and are used under those names in Tasks 2, 3, 4 and 8. `resolveLocale(pref, systemLocale)` keeps its argument order everywhere. `currentLocale()` is defined in Task 3 and called in Tasks 7 and 8. `getStrings(locale, reneMode)` has the locale first in its definition (Task 4) and at its call site (Task 3 Step 4). `nativeLabels(locale, reneMode)` follows the same order. `STRINGS_NL` is introduced in Task 4, extended in Task 5 and replaced in Task 6 — the plan says so at each point.

**One ordering trap, stated on purpose.** Task 3 leaves the renderer typecheck failing, because it changes the `getStrings` call before Task 4 changes the signature. Task 3 Step 5 says to expect that and not to fix it early. Running the tasks out of order breaks this.
