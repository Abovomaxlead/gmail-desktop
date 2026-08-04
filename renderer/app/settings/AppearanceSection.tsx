'use client';

import type { Prefs } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';
import { FIELD, HINT } from './tokens';

// Weergave: hoe de app eruitziet en waar hij zich laat zien. Het thema, de
// hoofdschakelaar boven de ongelezen-getallen, het icoon in de systeembalk, en de
// ondergrens van de vensterbreedte.
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
      </SettingsGroup>

      <SettingsGroup title={S.navAccounts}>
        {/* De hoofdschakelaar boven het "Getal"-vinkje per account bij Meldingen.
            Uit verbergt élk getal — op de taakbalk en op de tabbladen — ook van een
            account dat wél meetelt. Dat het de keuze per account overstemt staat in
            de bijtekst, want anders lijkt die keuze stuk. */}
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

        {/* Uitgeschakeld en niet verborgen als het icoon uit staat: verdwijnt de rij,
            dan verspringt de sectie onder je handen zodra je de schakelaar erboven
            omzet. `disabled` op de schakelaar zegt hetzelfde zonder te bewegen. */}
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

        {/* De kleur van het icoon hoort hier ook, en die is er nog niet. Dat staat er
            met zoveel woorden in plaats van als schakelaar die niets doet: het icoon
            is het gekleurde app-logo, en "licht" of "donker" vraagt om een monochrome
            variant die nog niet in assets/ zit. */}
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
