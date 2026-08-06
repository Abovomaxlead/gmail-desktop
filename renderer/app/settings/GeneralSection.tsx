'use client';

import type { Prefs } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';
import { BUTTON } from './tokens';

// General: how the app behaves towards Windows - what it does with a mail link and
// what it does when you sign in. The default-mail state comes from Windows itself
// rather than from prefs, since it can be changed outside this app.
//
// Mail is a button and not a switch on purpose: Windows signs the mailto: association
// itself, so no app can flip it. A switch would spring back and read as a bug. The
// button hands the choice to Windows and the line underneath reports what it made of it.

export function GeneralSection({
  S,
  prefs,
  isDefaultMail,
  onSetAutoStart,
  onSetLaunchMinimized,
  onRequestDefaultMail,
}: {
  S: UiStrings;
  prefs: Prefs | null;
  isDefaultMail: boolean;
  onSetAutoStart: (v: boolean) => void;
  onSetLaunchMinimized: (v: boolean) => void;
  onRequestDefaultMail: () => void;
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
    </Section>
  );
}
