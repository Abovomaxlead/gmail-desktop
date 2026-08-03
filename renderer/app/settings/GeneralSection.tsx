'use client';

import { useEffect, useState } from 'react';
import type { Prefs } from '../page';
import type { UiStrings } from '../strings';
import { SettingRow } from './SettingRow';

// De opmaaktokens van het paneel, in één keer bovenaan. Let op de haakjes bij de
// haarlijn: `divide-black/8` bestaat niet in Tailwind 3 (de schaal voor
// doorzichtigheid gaat per 5) en valt stil weg; `divide-black/[0.08]` wel.
const CARD =
  'divide-y divide-black/[0.08] rounded-xl border border-black/[0.08] bg-white px-4 dark:divide-white/[0.08] dark:border-white/[0.08] dark:bg-neutral-900';

// Dezelfde ring als in de schil, maar met de offset in de kaartkleur in plaats
// van in de vlakkleur — alles hieronder staat op een kaart.
const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-900';

const BUTTON = `shrink-0 rounded-lg bg-neutral-200 px-3 py-1.5 text-[13px] font-medium text-neutral-900 transition hover:bg-neutral-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700 motion-reduce:transition-none ${FOCUS_RING}`;

const SELECT = `rounded-md border border-black/[0.08] bg-neutral-100 px-2 py-1 text-[13px] text-neutral-900 dark:border-white/[0.08] dark:bg-neutral-800 dark:text-neutral-100 ${FOCUS_RING}`;

const CHECKBOX = `h-4 w-4 accent-neutral-900 dark:accent-neutral-100 ${FOCUS_RING}`;

// Algemeen: de vijf instellingen die niet over meldingen, accounts of de app zelf
// gaan. Elke instelling gaat door dezelfde `SettingRow`, dus alle controls
// eindigen op één lijn rechts.
export function GeneralSection({
  S,
  prefs,
  isDefaultMail,
  onSetAutoStart,
  onSetDefaultMail,
}: {
  S: UiStrings;
  prefs: Prefs | null;
  isDefaultMail: boolean;
  onSetAutoStart: (v: boolean) => void;
  onSetDefaultMail: () => void;
}) {
  // Waar gesleepte mail wordt opgeslagen. Het pad komt uit de hoofdprocess,
  // want daar wordt de standaardmap opgelost; `prefs.mailDrop.folder` is leeg
  // zolang de gebruiker zelf niets heeft gekozen. Deze sectie wordt gemonteerd
  // wanneer je hem opent, dus dit haalt bij elk bezoek het actuele pad op.
  const [mailDropFolder, setMailDropFolder] = useState('');
  useEffect(() => {
    let alive = true;
    window.desktop
      ?.getMailDropFolder()
      .then((f) => {
        if (alive) setMailDropFolder(f);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[20px] font-semibold tracking-tight">{S.sectionGeneral}</h2>

      <div className={CARD}>
        <SettingRow label={S.autoStart} description={S.autoStartDescription} htmlFor="setting-auto-start">
          <input
            id="setting-auto-start"
            type="checkbox"
            checked={!!prefs?.autoStart}
            onChange={(e) => onSetAutoStart(e.target.checked)}
            className={CHECKBOX}
          />
        </SettingRow>

        {/* De status staat naast de knop en niet in de bijtekst: de bijtekst zegt
            wat er gebeurt als je hem indrukt, de status zegt hoe het nu staat. */}
        <SettingRow label={S.setDefaultMail} description={S.setDefaultMailHint}>
          <span className="text-xs text-neutral-500">
            {isDefaultMail ? S.isDefaultMail : S.notDefaultMail}
          </span>
          <button type="button" onClick={onSetDefaultMail} disabled={isDefaultMail} className={BUTTON}>
            {S.setDefaultMail}
          </button>
        </SettingRow>

        <SettingRow label={S.theme} htmlFor="setting-theme">
          <select
            id="setting-theme"
            value={prefs?.theme ?? 'system'}
            onChange={(e) => window.desktop?.setTheme(e.target.value as 'system' | 'light' | 'dark')}
            className={SELECT}
          >
            <option value="system">{S.themeSystem}</option>
            <option value="light">{S.themeLight}</option>
            <option value="dark">{S.themeDark}</option>
          </select>
        </SettingRow>

        <SettingRow
          label={S.notificationOpenLabel}
          description={S.notificationOpenDescription}
          htmlFor="setting-notification-open"
        >
          <select
            id="setting-notification-open"
            value={prefs?.notificationOpen ?? 'app'}
            onChange={(e) => window.desktop?.setNotificationOpen(e.target.value as 'app' | 'window')}
            className={SELECT}
          >
            <option value="app">{S.openInApp}</option>
            <option value="window">{S.openInWindow}</option>
          </select>
        </SettingRow>

        <SettingRow label={S.mailDropFolder} description={S.mailDropHint}>
          {/* Het pad is gegevens: `tabular-nums`, en afgekapt aan het begin. Het
              einde van een pad zegt meer dan het begin, dus `dir="rtl"` legt de
              ellipsis links. De LRE/PDF eromheen (U+202A/U+202C) houden de
              tekens zelf in leesrichting, ook als een pad op een \ eindigt —
              zonder die twee springt een scheidingsteken aan het eind naar
              voren. `title` heeft het pad ongeschonden, voor onder de muis. */}
          <span
            dir="rtl"
            title={mailDropFolder}
            className="max-w-[200px] truncate text-xs tabular-nums text-neutral-500"
          >
            {mailDropFolder ? `\u202a${mailDropFolder}\u202c` : '—'}
          </span>
          <button
            type="button"
            onClick={() => void window.desktop?.pickMailDropFolder().then(setMailDropFolder)}
            className={BUTTON}
          >
            {S.mailDropChoose}
          </button>
          <button type="button" onClick={() => window.desktop?.openMailDropFolder()} className={BUTTON}>
            {S.mailDropOpen}
          </button>
        </SettingRow>
      </div>
    </section>
  );
}
