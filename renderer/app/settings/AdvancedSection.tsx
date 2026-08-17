'use client';

import type { Prefs } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';
import { HINT } from './tokens';

export function AdvancedSection({ S, prefs }: { S: UiStrings; prefs: Prefs | null }) {
  const on = prefs?.advanced.hardwareAcceleration !== false;

  return (
    <Section title={S.navAdvanced}>
      <SettingsGroup title={S.miscellaneous}>
        <SettingRow
          label={S.hardwareAcceleration}
          description={S.hardwareAccelerationDescription}
          htmlFor="setting-hw-accel"
        >
          <Switch
            id="setting-hw-accel"
            checked={on}
            onChange={(v) => window.desktop?.setAdvanced({ hardwareAcceleration: v })}
          />
        </SettingRow>

        <p className={`mt-1 max-w-[46ch] ${HINT}`}>{S.restartRequired}</p>
      </SettingsGroup>
    </Section>
  );
}
