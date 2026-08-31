'use client';

import type { Prefs } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';
import { BUTTON } from './tokens';


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
  return (
    <Section title={S.navGeneral}>
      <SettingsGroup>
        <SettingRow
          label={S.defaultMailClient}
          description={
            <>
              {S.defaultMailClientDescription}
              <span className="mt-1 block font-medium text-neutral-700 dark:text-neutral-300">
                {isDefaultMail ? S.defaultMailIsDefault : S.defaultMailNotDefault}
              </span>
            </>
          }
        >
          <button type="button" className={BUTTON} onClick={onRequestDefaultMail}>
            {isDefaultMail ? S.defaultMailChangeButton : S.defaultMailSetButton}
          </button>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={S.startup}>
        <SettingRow label={S.autoStart} description={S.autoStartDescription} htmlFor="setting-auto-start">
          <Switch id="setting-auto-start" checked={!!prefs?.autoStart} onChange={onSetAutoStart} />
        </SettingRow>

        <SettingRow
          label={S.launchMinimized}
          description={S.launchMinimizedDescription}
          htmlFor="setting-launch-minimized"
        >
          <Switch
            id="setting-launch-minimized"
            checked={!!prefs?.launchMinimized}
            onChange={onSetLaunchMinimized}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={S.tourGroup}>
        <SettingRow label={S.tourReplay} description={S.tourReplayDescription}>
          <button type="button" className={BUTTON} onClick={onReplayTour}>
            {S.tourReplayButton}
          </button>
        </SettingRow>
      </SettingsGroup>
    </Section>
  );
}
