'use client';

import type { Prefs } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';
import { FIELD, HINT } from './tokens';

// Appearance: the theme, the master switch above the per-account unread counts, the
// tray icon, and the minimum window size. The tray row that depends on the tray
// being enabled is disabled rather than hidden, because a disappearing row makes the
// section jump under your hands. Tray colour is deliberately absent: it would need a
// monochrome icon that is not in assets/ yet, so the section says so instead.

export function AppearanceSection({ S, prefs }: { S: UiStrings; prefs: Prefs | null }) {
  const tray = prefs?.appearance.tray;

  return (
    <Section title={S.navAppearance}>
      <SettingsGroup title={S.navGeneral}>
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
        <SettingRow label={S.language} description={S.languageDescription} htmlFor="setting-language">
          <select
            id="setting-language"
            value={prefs?.language ?? 'system'}
            onChange={(e) => window.desktop?.setLanguage(e.target.value as 'system' | 'en' | 'nl')}
            className={FIELD}
          >
            <option value="system">{S.languageSystem}</option>
            <option value="en">{S.languageEnglish}</option>
            <option value="nl">{S.languageDutch}</option>
          </select>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={S.navAccounts}>
        <SettingRow
          label={S.showUnreadBadges}
          description={S.showUnreadBadgesDescription}
          htmlFor="setting-show-badges"
        >
          <Switch
            id="setting-show-badges"
            checked={prefs?.appearance.showUnreadBadges !== false}
            onChange={(v) => window.desktop?.setAppearance({ showUnreadBadges: v })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={S.systemTray}>
        <SettingRow label={S.trayEnabled} description={S.trayEnabledDescription} htmlFor="setting-tray">
          <Switch
            id="setting-tray"
            checked={tray?.enabled !== false}
            onChange={(v) => window.desktop?.setAppearance({ tray: { enabled: v } })}
          />
        </SettingRow>

        <SettingRow
          label={S.traySelectUnread}
          description={S.traySelectUnreadDescription}
          htmlFor="setting-tray-unread"
        >
          <Switch
            id="setting-tray-unread"
            disabled={tray?.enabled === false}
            checked={tray?.selectUnreadOnClick === true}
            onChange={(v) => window.desktop?.setAppearance({ tray: { selectUnreadOnClick: v } })}
          />
        </SettingRow>

        <p className={`mt-1 ${HINT}`}>{S.trayColourTodo}</p>
      </SettingsGroup>

      <SettingsGroup title={S.windowGroup}>
        <SettingRow
          label={S.restrictMinWindowSize}
          description={S.restrictMinWindowSizeDescription}
          htmlFor="setting-min-size"
        >
          <Switch
            id="setting-min-size"
            checked={prefs?.appearance.restrictMinWindowSize !== false}
            onChange={(v) => window.desktop?.setAppearance({ restrictMinWindowSize: v })}
          />
        </SettingRow>
      </SettingsGroup>
    </Section>
  );
}
