'use client';

import type { ReactNode } from 'react';
import type { Prefs, UpdateStatus } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';
import { ACCENT_BUTTON, BUTTON, DANGER_TEXT } from './tokens';

function updateStatusText(u: UpdateStatus, S: UiStrings): string {
  switch (u.state) {
    case 'checking':
      return S.updChecking;
    case 'available':
      return S.updAvailable(u.version ?? '');
    case 'not-available':
      return S.updLatest;
    case 'downloading':
      return S.updDownloading(u.percent ?? 0);
    case 'downloaded':
      return S.updDownloaded;
    case 'error':
      return S.updError(u.message ?? 'unknown error');
    case 'dev':
      return S.updDev;
    default:
      return '';
  }
}

// De statusregel als bijtekst bij de updaterij. Twee dingen die de kale string
// niet kan dragen:
//
//   - `tabular-nums` als er een getal in staat. Bij het binnenhalen loopt een
//     percentage tot drie tekens op en weer terug; zonder tabelcijfers schuift de
//     hele regel bij elke tik heen en weer.
//   - rood als het mislukt is. Dat is een toestand die je van een meter afstand
//     moet kunnen zien, en de tekst ernaast is niet genoeg.
function updateStatusNode(u: UpdateStatus, S: UiStrings): ReactNode {
  const text = updateStatusText(u, S);
  if (!text) return undefined;
  const numeric = u.state === 'available' || u.state === 'downloading';
  const classes = `${numeric ? 'tabular-nums' : ''} ${u.state === 'error' ? DANGER_TEXT : ''}`.trim();
  return classes ? <span className={classes}>{text}</span> : text;
}

// Bijwerken: de stand van de update en de knop die bij die stand hoort. Een eigen
// sectie en niet een rij onder Over: dit is het enige in het paneel waar je komt
// om iets te laten gebeuren in plaats van om iets te zetten, en het puntje in de
// kolom hangt eraan.
export function UpdatesSection({
  S,
  prefs,
  update,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
}: {
  S: UiStrings;
  prefs: Prefs | null;
  update: UpdateStatus;
  onCheckUpdate: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
}) {
  const busy = update.state === 'checking' || update.state === 'downloading';

  return (
    <Section title={S.navUpdates}>
      <SettingsGroup>
        <SettingRow
          label={S.autoCheckUpdates}
          description={S.autoCheckUpdatesDescription}
          htmlFor="setting-auto-check"
        >
          <Switch
            id="setting-auto-check"
            checked={prefs?.updates.autoCheck !== false}
            onChange={(v) => window.desktop?.setUpdatePrefs({ autoCheck: v })}
          />
        </SettingRow>

        {/* Los van zelf kijken: je kan willen dat de app kijkt zonder dat hij je
            erover aanspreekt, en het omgekeerde kan ook — dan hoor je het alleen als
            je zelf op de knop hieronder drukt. */}
        <SettingRow
          label={S.notifyUpdates}
          description={S.notifyUpdatesDescription}
          htmlFor="setting-notify-updates"
        >
          <Switch
            id="setting-notify-updates"
            checked={prefs?.updates.notify !== false}
            onChange={(v) => window.desktop?.setUpdatePrefs({ notify: v })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup>
        {/* De stand van de update staat als bijtekst onder de naam van de rij, en
            de knoppen die bij die stand horen ernaast. Zie `updateStatusNode`
            voor waarom die bijtekst een node is en geen string. */}
        <SettingRow label={S.updates} description={updateStatusNode(update, S)}>
          {update.state === 'available' && (
            <button type="button" onClick={onDownloadUpdate} className={ACCENT_BUTTON}>
              {S.updateNow}
            </button>
          )}
          {update.state === 'downloaded' && (
            <button type="button" onClick={onInstallUpdate} className={ACCENT_BUTTON}>
              {S.restartInstall}
            </button>
          )}
          <button type="button" onClick={onCheckUpdate} disabled={busy} className={BUTTON}>
            {update.state === 'checking' ? S.checking : S.checkForUpdates}
          </button>
        </SettingRow>
      </SettingsGroup>
    </Section>
  );
}
