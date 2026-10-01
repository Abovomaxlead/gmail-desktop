'use client';

import { useState } from 'react';
import type { Profile } from '../page';
import { MESSAGE_CHARS } from '../../lib/feedback';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';
import { ACCENT_BUTTON, FIELD, HINT } from './tokens';

// Feedback: what the user types, and whether the diagnostics ride along. Nothing here is
// remembered — the message is gone the moment the compose window has it, which is why this
// section sits outside the preferences in the nav.
//
// The button writes a mail rather than sending one. Sending happens in Gmail, by the user,
// after they have read what is in it.

export function FeedbackSection({
  S,
  profiles,
  draft,
  onDraftChange,
}: {
  S: UiStrings;
  profiles: Profile[];
  /** Held above this component: switching sections or closing the panel unmounts it, and
   * losing a half-written bug report is how you teach someone to stop reporting them. */
  draft: string;
  onDraftChange: (text: string) => void;
}) {
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);

  const hasMailbox = profiles.some((p) => p.kind === 'authuser');
  const canSend = hasMailbox && draft.trim() !== '';

  async function send() {
    if (!canSend) return;
    // Only empty the box once a window is actually on its way. Main refuses an empty message
    // and a machine with nothing signed in, and neither may cost the user their text.
    const opened = await window.desktop?.sendFeedback({ text: draft, includeDiagnostics });
    if (opened) onDraftChange('');
  }

  return (
    <Section title={S.navFeedback}>
      <SettingsGroup>
        <p className={`max-w-[60ch] ${HINT}`}>{S.feedbackIntro}</p>

        <textarea
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder={S.feedbackPlaceholder}
          rows={7}
          // Matches MESSAGE_CHARS in feedback-mail.ts, which cuts what arrives beyond it: the
          // body travels as a URL, so the limit exists either way and is kinder here.
          maxLength={MESSAGE_CHARS}
          aria-label={S.navFeedback}
          className={`mt-3 w-full resize-y leading-snug ${FIELD}`}
        />
      </SettingsGroup>

      <SettingsGroup>
        <SettingRow
          label={S.feedbackIncludeDiagnostics}
          description={S.feedbackIncludeDiagnosticsDescription}
          htmlFor="setting-feedback-diagnostics"
        >
          <Switch
            id="setting-feedback-diagnostics"
            checked={includeDiagnostics}
            onChange={setIncludeDiagnostics}
          />
        </SettingRow>

        <div className="mt-4 flex items-center justify-end gap-3">
          {!hasMailbox && <span className={HINT}>{S.feedbackNoMailbox}</span>}
          <button type="button" onClick={send} disabled={!canSend} className={ACCENT_BUTTON}>
            {S.feedbackSend}
          </button>
        </div>
      </SettingsGroup>
    </Section>
  );
}
