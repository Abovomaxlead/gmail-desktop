'use client';

import type { Prefs } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';
import { HINT } from './tokens';

// Gmail: what the app changes about Gmail. The two groups separate two kinds of
// change - Inbox is CSS laid over Google's own page (electron/gmail-tweaks.ts) and
// can silently stop working, while Compose only touches this app's own window.
// Every switch reads `=== true`: these are edits to a page that is not ours, so
// they all default to off and an older prefs file must not turn them all on.

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

      <SettingsGroup title={S.gmailInboxGroup}>
        <SettingRow
          label={S.gmailHideInboxFooter}
          description={S.gmailHideInboxFooterDescription}
          htmlFor="setting-gmail-hide-inbox-footer"
        >
          <Switch
            id="setting-gmail-hide-inbox-footer"
            checked={gmail?.hideInboxFooter === true}
            onChange={(v) => window.desktop?.setGmail({ hideInboxFooter: v })}
          />
        </SettingRow>

        <p className={`mt-1 max-w-[46ch] ${HINT}`}>{S.gmailTweakFragile}</p>
      </SettingsGroup>
    </Section>
  );
}
