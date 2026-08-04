'use client';

import type { UpdateStatus } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { VALUE } from './tokens';

// De naam van de app is een eigennaam en wordt niet vertaald, dus hij staat niet
// in strings.ts.
const APP_NAME = 'Gmail Desktop';

// Over de app: welke app dit is en welke versie je hebt. Verder niets — het
// bijwerken staat bij Bijwerken en de changelog bij Wat is er nieuw, want dat zijn
// dingen die je komt doen en lezen. Dit is de sectie waar je komt om één getal op
// te zoeken, meestal omdat iemand ernaar vraagt.
export function AboutSection({ S, update }: { S: UiStrings; update: UpdateStatus }) {
  return (
    <Section title={S.navAbout}>
      <SettingsGroup>
        <SettingRow label={APP_NAME}>
          {/* Het versienummer is gegevens: `tabular-nums`. De maat komt uit
              `VALUE` — dezelfde rol als het pad van de dropmap bij Downloads, dus
              dezelfde maat. */}
          <span className={`tabular-nums ${VALUE}`}>
            {S.versionPrefix} {update.currentVersion ?? '—'}
          </span>
        </SettingRow>
      </SettingsGroup>
    </Section>
  );
}
