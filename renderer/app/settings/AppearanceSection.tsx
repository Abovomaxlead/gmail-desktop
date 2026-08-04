'use client';

import type { Prefs } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { FIELD } from './tokens';

// Weergave: hoe de app eruitziet. Nu één instelling — welk thema hij volgt. Het
// stond bij Algemeen, tussen het instellen van de standaard-mailclient en de
// opstartkeuzes, en dat is een andere soort vraag: die twee gaan over hoe de app
// zich tegenover Windows gedraagt en deze over hoe hij eruitziet.
export function AppearanceSection({ S, prefs }: { S: UiStrings; prefs: Prefs | null }) {
  return (
    <Section title={S.navAppearance}>
      <SettingsGroup>
        <SettingRow label={S.theme} description={S.themeDescription} htmlFor="setting-theme">
          <select
            id="setting-theme"
            value={prefs?.theme ?? 'system'}
            onChange={(e) => window.desktop?.setTheme(e.target.value as 'system' | 'light' | 'dark')}
            className={FIELD}
          >
            <option value="system">{S.themeSystem}</option>
            <option value="light">{S.themeLight}</option>
            <option value="dark">{S.themeDark}</option>
          </select>
        </SettingRow>
      </SettingsGroup>
    </Section>
  );
}
