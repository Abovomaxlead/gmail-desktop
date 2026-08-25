'use client';

import type { ReactNode } from 'react';
import type { Prefs, UpdateStatus } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';
import { ACCENT_BUTTON, BUTTON, DANGER_TEXT } from './tokens';
import { hasPrereleaseTag } from '../../lib/version';

// Updates: the state of the update and the button that belongs to that state. The
// status line is a node rather than a string so a percentage can carry `tabular-nums`
// and a failure can be red.


//===========================
// Component
//===========================

export function UpdatesSection({
  S,
  prefs,
  update,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
}: {
  S: UiStrings;
  prefs: Prefs | null;
  update: UpdateStatus;
  onCheckUpdate: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
}) {
  const busy = update.state === 'checking' || update.state === 'downloading';

  return (
    <Section title={S.navUpdates}>
      <SettingsGroup>
        <SettingRow
          label={S.autoCheckUpdates}
          description={S.autoCheckUpdatesDescription}
          htmlFor="setting-auto-check"
        >
          <Switch
            id="setting-auto-check"
            checked={prefs?.updates.autoCheck !== false}
            onChange={(v) => window.desktop?.setUpdatePrefs({ autoCheck: v })}
          />
        </SettingRow>

        <SettingRow
          label={S.notifyUpdates}
          description={S.notifyUpdatesDescription}
          htmlFor="setting-notify-updates"
        >
          <Switch
            id="setting-notify-updates"
            checked={prefs?.updates.notify !== false}
            onChange={(v) => window.desktop?.setUpdatePrefs({ notify: v })}
          />
        </SettingRow>

        <SettingRow
          label={S.prereleaseUpdates}
          description={prereleaseDescription(prefs, update, S)}
          htmlFor="setting-prerelease"
        >
          <Switch
            id="setting-prerelease"
            checked={prereleaseOn(prefs, update)}
            onChange={(v) => window.desktop?.setUpdatePrefs({ allowPrerelease: v })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup>
        <SettingRow label={S.updates} description={updateStatusNode(update, S)}>
          {update.state === 'available' && (
            <button type="button" onClick={onDownloadUpdate} className={ACCENT_BUTTON}>
              {S.updateNow}
            </button>
          )}
          {update.state === 'downloaded' && (
            <button type="button" onClick={onInstallUpdate} className={ACCENT_BUTTON}>
              {S.restartInstall}
            </button>
          )}
          <button type="button" onClick={onCheckUpdate} disabled={busy} className={BUTTON}>
            {update.state === 'checking' ? S.checking : S.checkForUpdates}
          </button>
        </SettingRow>
      </SettingsGroup>
    </Section>
  );
}


//===========================
// Helper functions
//===========================

/**
 * Whether the prerelease switch shows as on
 *
 * Mirrors the main process: an untouched setting falls back to whether this build is itself a
 * prerelease, so the switch shows the channel actually in use rather than a default nobody
 * chose.
 *
 * @param prefs
 * @param u carries the running version
 * @returns the switch position
 * @private
 */
function prereleaseOn(prefs: Prefs | null, u: UpdateStatus): boolean {
  const chosen = prefs?.updates.allowPrerelease;
  if (typeof chosen === 'boolean') return chosen;
  return hasPrereleaseTag(u.currentVersion ?? '');
}

/**
 * The line under the prerelease switch
 *
 * Running a prerelease with the switch off is the one state that looks broken -- every check
 * says "nothing new" until the finished version ships -- so that case explains itself.
 *
 * @param prefs
 * @param u
 * @param S
 * @returns the description to show
 * @private
 */
function prereleaseDescription(prefs: Prefs | null, u: UpdateStatus, S: UiStrings): string {
  const version = u.currentVersion ?? '';
  if (!prereleaseOn(prefs, u) && hasPrereleaseTag(version)) {
    return `${S.prereleaseUpdatesDescription} ${S.prereleaseStuckOnBeta(version)}`;
  }
  return S.prereleaseUpdatesDescription;
}

function updateStatusText(u: UpdateStatus, S: UiStrings): string {
  switch (u.state) {
    case 'checking':
      return S.updChecking;
    case 'available':
      return S.updAvailable(u.version ?? '');
    case 'not-available':
      return S.updLatest;
    case 'downloading':
      return S.updDownloading(u.percent ?? 0);
    case 'downloaded':
      return S.updDownloaded;
    case 'error':
      return S.updError(u.message ?? 'unknown error');
    case 'dev':
      return S.updDev;
    default:
      return '';
  }
}

function updateStatusNode(u: UpdateStatus, S: UiStrings): ReactNode {
  const text = updateStatusText(u, S);
  if (!text) return undefined;
  const numeric = u.state === 'available' || u.state === 'downloading';
  const classes = `${numeric ? 'tabular-nums' : ''} ${u.state === 'error' ? DANGER_TEXT : ''}`.trim();
  return classes ? <span className={classes}>{text}</span> : text;
}
