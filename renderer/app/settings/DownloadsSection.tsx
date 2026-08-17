'use client';

import { useEffect, useState } from 'react';
import type { Prefs } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';
import { BUTTON, HINT, VALUE } from './tokens';


//===========================
// Constants
//===========================

const LRE = String.fromCharCode(0x202a);
const PDF = String.fromCharCode(0x202c);


//===========================
// Component
//===========================

export function DownloadsSection({ S, prefs }: { S: UiStrings; prefs: Prefs | null }) {
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


//===========================
// Helper components
//===========================

function Path({ value }: { value: string }) {
  return (
    <span dir="rtl" title={value} className={`max-w-[180px] truncate tabular-nums ${VALUE}`}>
      {value ? `${LRE}${value}${PDF}` : '—'}
    </span>
  );
}
