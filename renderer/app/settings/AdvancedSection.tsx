'use client';

import type { Prefs } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';
import { HINT } from './tokens';

// Geavanceerd: de knoppen waar je alleen komt als iets niet werkt.
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

        {/* Dat het pas na een herstart geldt is geen voetnoot maar de helft van wat
            je moet weten: zonder deze regel zet je de schakelaar om, ziet niets
            veranderen, en concludeert dat hij stuk is. Chromium leest dit vóór het
            opstarten van zijn grafische proces, en dat gebeurt één keer per start. */}
        <p className={`mt-1 max-w-[46ch] ${HINT}`}>{S.restartRequired}</p>
      </SettingsGroup>
    </Section>
  );
}
