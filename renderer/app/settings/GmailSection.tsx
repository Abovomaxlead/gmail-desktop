'use client';

import type { Prefs } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';

// Gmail: what the app changes about Gmail. Only the compose flow is left, and it
// touches nothing but this app's own window - the CSS that used to be laid over
// Google's own page is gone, along with the switch that drove it. Every switch reads
// `=== true`, so a missing key or a prefs file from an older version reads as off.

export function GmailSection({ S, prefs }: { S: UiStrings; prefs: Prefs | null }) {
  const gmail = prefs?.gmail;

  return (
    <Section title={S.navGmail}>
      <SettingsGroup title={S.gmailComposeGroup}>
        <SettingRow
          label={S.gmailComposeNewWindow}
          description={S.gmailComposeNewWindowDescription}
          htmlFor="setting-gmail-compose-new-window"
        >
          <Switch
            id="setting-gmail-compose-new-window"
            checked={gmail?.alwaysComposeInNewWindow === true}
            onChange={(v) => window.desktop?.setGmail({ alwaysComposeInNewWindow: v })}
          />
        </SettingRow>

        <SettingRow
          label={S.gmailCloseCompose}
          description={S.gmailCloseComposeDescription}
          htmlFor="setting-gmail-close-compose"
        >
          <Switch
            id="setting-gmail-close-compose"
            disabled={gmail?.alwaysComposeInNewWindow !== true}
            checked={gmail?.closeComposeAfterSend === true}
            onChange={(v) => window.desktop?.setGmail({ closeComposeAfterSend: v })}
          />
        </SettingRow>
      </SettingsGroup>
    </Section>
  );
}
