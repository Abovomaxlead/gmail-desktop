'use client';

import { useEffect, useState } from 'react';
import type { Prefs } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';
import { BUTTON, HINT, VALUE } from './tokens';

// De twee onzichtbare tekens om een pad heen, met een naam in plaats van als
// letterlijk teken in de tekst: U+202A begint een stuk dat van links naar rechts
// leest en U+202C sluit het af. Zo staan ze als code in het bestand en niet als
// twee gaten in een template-string waar niemand ziet dat er iets staat.
const LRE = String.fromCharCode(0x202a);
const PDF = String.fromCharCode(0x202c);

// Een pad zoals het in een rij hoort: gegevens, dus `tabular-nums`, en afgekapt aan
// het begin. Het einde van een pad zegt meer dan het begin, dus `dir="rtl"` legt de
// ellipsis links. De LRE/PDF eromheen houden de tekens zelf in leesrichting, ook als
// een pad op een \ eindigt — zonder die twee springt een scheidingsteken aan het
// eind naar voren. `title` heeft het pad ongeschonden, voor onder de muis.
function Path({ value }: { value: string }) {
  return (
    <span dir="rtl" title={value} className={`max-w-[180px] truncate tabular-nums ${VALUE}`}>
      {value ? `${LRE}${value}${PDF}` : '—'}
    </span>
  );
}

// Downloads: wat de app doet met een bestand dat binnenkomt, en waar het heen gaat.
// Twee soorten: een gewone download uit Gmail (de bovenste groep) en mail die je in
// de balk hebt laten vallen (de onderste). Dat zijn twee mappen en twee stromen, en
// ze staan hier onder elkaar omdat je ze op dezelfde plek zoekt.
export function DownloadsSection({ S, prefs }: { S: UiStrings; prefs: Prefs | null }) {
  // Het pad van de dropmap komt uit het hoofdproces, want daar wordt de
  // standaardmap opgelost; `prefs.mailDrop.folder` is leeg zolang de gebruiker zelf
  // niets heeft gekozen. Deze sectie wordt gemonteerd wanneer je hem opent, dus dit
  // haalt bij elk bezoek het actuele pad op.
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

  const d = prefs?.downloads;

  return (
    <Section title={S.navDownloads}>
      <SettingsGroup title={S.navGeneral}>
        <SettingRow
          label={S.saveAsDialog}
          description={S.saveAsDialogDescription}
          htmlFor="setting-save-as"
        >
          <Switch
            id="setting-save-as"
            checked={d?.saveAsDialog === true}
            onChange={(v) => window.desktop?.setDownloadPrefs({ saveAsDialog: v })}
          />
        </SettingRow>

        <SettingRow
          label={S.openFolderWhenDone}
          description={S.openFolderWhenDoneDescription}
          htmlFor="setting-open-folder"
        >
          <Switch
            id="setting-open-folder"
            checked={d?.openFolderWhenDone === true}
            onChange={(v) => window.desktop?.setDownloadPrefs({ openFolderWhenDone: v })}
          />
        </SettingRow>

        {/* Het pad staat er als tekst en niet in een invulveld: een pad met de hand
            typen levert een map op die er niet is, en de kiezer van het systeem weet
            wél of hij bestaat. Leeg = de downloadmap van Windows, en dan staat die
            hier — main lost hem op, dus er staat nooit niets. */}
        <SettingRow label={S.downloadFolder} description={S.downloadFolderDescription}>
          <Path value={d?.folder ?? ''} />
          <button
            type="button"
            onClick={() => void window.desktop?.pickDownloadFolder()}
            className={BUTTON}
          >
            {S.change}
          </button>
        </SettingRow>
        {!d?.folder && <p className={`mt-1 ${HINT}`}>{S.downloadFolderDefault}</p>}
      </SettingsGroup>

      <SettingsGroup title={S.mailDropGroup}>
        <SettingRow label={S.mailDropFolder} description={S.mailDropHint}>
          <Path value={mailDropFolder} />
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
