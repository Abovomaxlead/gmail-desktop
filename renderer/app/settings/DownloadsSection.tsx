'use client';

import { useEffect, useState } from 'react';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { BUTTON, VALUE } from './tokens';

// De twee onzichtbare tekens om het pad heen, met een naam in plaats van als
// letterlijk teken in de tekst: U+202A begint een stuk dat van links naar rechts
// leest en U+202C sluit het af. Zo staan ze als code in het bestand en niet als
// twee gaten in een template-string waar niemand ziet dat er iets staat.
const LRE = String.fromCharCode(0x202a);
const PDF = String.fromCharCode(0x202c);

// Downloads: waar de app dingen wegschrijft. Nu één plek — de map waar gesleepte
// mail in belandt.
export function DownloadsSection({ S }: { S: UiStrings }) {
  // Het pad komt uit het hoofdproces, want daar wordt de standaardmap opgelost;
  // `prefs.mailDrop.folder` is leeg zolang de gebruiker zelf niets heeft gekozen.
  // Deze sectie wordt gemonteerd wanneer je hem opent, dus dit haalt bij elk
  // bezoek het actuele pad op.
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
    <Section title={S.navDownloads}>
      <SettingsGroup>
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
            className={`max-w-[180px] truncate tabular-nums ${VALUE}`}
          >
            {mailDropFolder ? `${LRE}${mailDropFolder}${PDF}` : '—'}
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
      </SettingsGroup>
    </Section>
  );
}
