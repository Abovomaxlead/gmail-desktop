'use client';

import type { Prefs } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';

// General: how the app behaves towards Windows - what it does with a mail link and
// what it does when you sign in. The default-mail state comes from Windows itself
// rather than from prefs, since it can be changed outside this app.

export function GeneralSection({
  S,
  prefs,
  isDefaultMail,
  onSetAutoStart,
  onSetLaunchMinimized,
  onSetDefaultMail,
}: {
  S: UiStrings;
  prefs: Prefs | null;
  isDefaultMail: boolean;
  onSetAutoStart: (v: boolean) => void;
  onSetLaunchMinimized: (v: boolean) => void;
  onSetDefaultMail: (v: boolean) => void;
}) {
  return (
    <Section title={S.navGeneral}>
      <SettingsGroup>
        <SettingRow
          label={S.defaultMailClient}
          description={S.defaultMailClientDescription}
          htmlFor="setting-default-mail"
        >
          <Switch id="setting-default-mail" checked={isDefaultMail} onChange={onSetDefaultMail} />
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
    </Section>
  );
}
