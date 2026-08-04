'use client';

import type { UpdateStatus } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { VALUE } from './tokens';

// About: which app this is and which version you have. Updating lives in Updates
// and the changelog in What's new.

const APP_NAME = 'Gmail Desktop';

export function AboutSection({ S, update }: { S: UiStrings; update: UpdateStatus }) {
  return (
    <Section title={S.navAbout}>
      <SettingsGroup>
        <SettingRow label={APP_NAME}>
          <span className={`tabular-nums ${VALUE}`}>
            {S.versionPrefix} {update.currentVersion ?? '—'}
          </span>
        </SettingRow>
      </SettingsGroup>
    </Section>
  );
}
