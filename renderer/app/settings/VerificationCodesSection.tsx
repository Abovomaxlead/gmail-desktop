'use client';

import type { Prefs } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';
import { DANGER_TEXT, FIELD, HINT } from './tokens';

// Verification codes: the app reads an incoming message, recognises a code in it and
// puts it on the clipboard. Everything defaults to off. Nothing reacts to new mail
// yet, which is why the section says so on screen. With copying off the three rows
// below it are disabled rather than hidden, so the section does not jump and the
// choices stay visible. Deleting the mail is the one irreversible setting here, and
// the only row carrying a red warning.

export function VerificationCodesSection({ S, prefs }: { S: UiStrings; prefs: Prefs | null }) {
  const vc = prefs?.verificationCodes;
  const locked = vc?.autoCopy !== true;

  return (
    <Section title={S.navVerificationCodes}>
      <SettingsGroup>
        <p className={`mb-1 max-w-[46ch] ${HINT}`}>{S.vcNotWiredYet}</p>
      </SettingsGroup>

      <SettingsGroup>
        <SettingRow label={S.vcAutoCopy} description={S.vcAutoCopyDescription} htmlFor="setting-vc-auto-copy">
          <Switch
            id="setting-vc-auto-copy"
            checked={vc?.autoCopy === true}
            onChange={(v) => window.desktop?.setVerificationCodes({ autoCopy: v })}
          />
        </SettingRow>

        <SettingRow
          label={S.vcConfidence}
          description={S.vcConfidenceDescription}
          htmlFor="setting-vc-confidence"
        >
          <select
            id="setting-vc-confidence"
            disabled={locked}
            value={vc?.confidence ?? 'high'}
            onChange={(e) =>
              window.desktop?.setVerificationCodes({
                confidence: e.target.value as 'medium' | 'high',
              })
            }
            className={`${FIELD} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <option value="medium">{S.vcConfidenceMedium}</option>
            <option value="high">{S.vcConfidenceHigh}</option>
          </select>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup>
        <SettingRow label={S.vcMarkRead} description={S.vcMarkReadDescription} htmlFor="setting-vc-mark-read">
          <Switch
            id="setting-vc-mark-read"
            disabled={locked}
            checked={vc?.markRead === true}
            onChange={(v) => window.desktop?.setVerificationCodes({ markRead: v })}
          />
        </SettingRow>

        <SettingRow
          label={S.vcDelete}
          description={
            <>
              {S.vcDeleteDescription}
              <span className={`mt-1 block font-medium ${DANGER_TEXT}`}>{S.vcDeleteWarning}</span>
            </>
          }
          htmlFor="setting-vc-delete"
        >
          <Switch
            id="setting-vc-delete"
            disabled={locked}
            checked={vc?.deleteAfter === true}
            onChange={(v) => window.desktop?.setVerificationCodes({ deleteAfter: v })}
          />
        </SettingRow>
      </SettingsGroup>
    </Section>
  );
}
