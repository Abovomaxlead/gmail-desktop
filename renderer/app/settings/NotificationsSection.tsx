'use client';

import type { AccountPref, Prefs, Profile } from '../page';
import { isCompleteTime } from '../settings-utils';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';
import { SOUNDS, playSound, soundNameOrDefault } from '../../lib/notification-sound';
import { BLOCK_TITLE, BUTTON, CHECKBOX, DIVIDER, FIELD, FOCUS_RING, HAIRLINE, HINT, PANEL } from './tokens';



//===========================
// Types
//===========================

interface ToggleColumn {
  key: string;
  header: string;
  name: string;
  cell: (p: Profile, a: AccountPref | undefined) => { checked: boolean; set: (v: boolean) => void } | null;
}


//===========================
// Constants
//===========================

const TIME = `${FIELD} tabular-nums disabled:cursor-not-allowed disabled:opacity-50`;

const MATRIX_TITLE_ID = 'per-account-notifications-title';

const QUIET_END_LABEL_ID = 'setting-quiet-end-label';


//===========================
// Component
//===========================

export function NotificationsSection({
  S,
  prefs,
  profiles,
  onSetNotifications,
}: {
  S: UiStrings;
  prefs: Prefs | null;
  profiles: Profile[];
  onSetNotifications: (arg: {
    dnd: boolean;
    quietHours: { enabled: boolean; start: string; end: string };
  }) => void;
}) {
  const quiet = prefs?.notifications.quietHours;
  const quietOn = quiet?.enabled === true;
  const columns = toggleColumns(S);

  return (
    <Section title={S.navNotifications}>
      <SettingsGroup>
        <SettingRow label={S.dnd} description={S.dndDescription} htmlFor="setting-dnd">
          <Switch
            id="setting-dnd"
            checked={!!prefs?.notifications.dnd}
            onChange={(v) => {
              if (!prefs) return;
              onSetNotifications({ dnd: v, quietHours: prefs.notifications.quietHours });
            }}
          />
        </SettingRow>

        <SettingRow
          label={S.quietHours}
          description={S.quietHoursDescription}
          htmlFor="setting-quiet-hours"
        >
          <Switch
            id="setting-quiet-hours"
            checked={!!quiet?.enabled}
            onChange={(v) => {
              if (!prefs) return;
              onSetNotifications({
                dnd: prefs.notifications.dnd,
                quietHours: { ...prefs.notifications.quietHours, enabled: v },
              });
            }}
          />
        </SettingRow>

        <SettingRow label={S.from} htmlFor="setting-quiet-start">
          <input
            key={quiet ? 'start-ready' : 'start-loading'}
            id="setting-quiet-start"
            type="time"
            disabled={!quietOn}
            defaultValue={quiet?.start ?? ''}
            onChange={(e) => {
              if (!prefs || !isCompleteTime(e.target.value)) return;
              onSetNotifications({
                dnd: prefs.notifications.dnd,
                quietHours: { ...prefs.notifications.quietHours, start: e.target.value },
              });
            }}
            className={TIME}
          />
          <span id={QUIET_END_LABEL_ID} className="text-xs text-neutral-500 dark:text-neutral-400">
            {S.to}
          </span>
          <input
            key={quiet ? 'end-ready' : 'end-loading'}
            id="setting-quiet-end"
            aria-labelledby={QUIET_END_LABEL_ID}
            type="time"
            disabled={!quietOn}
            defaultValue={quiet?.end ?? ''}
            onChange={(e) => {
              if (!prefs || !isCompleteTime(e.target.value)) return;
              onSetNotifications({
                dnd: prefs.notifications.dnd,
                quietHours: { ...prefs.notifications.quietHours, end: e.target.value },
              });
            }}
            className={TIME}
          />
        </SettingRow>

        <SettingRow
          label={S.notificationOpenLabel}
          description={S.notificationOpenDescription}
          htmlFor="setting-notification-open"
        >
          <select
            id="setting-notification-open"
            value={prefs?.notificationOpen ?? 'app'}
            onChange={(e) => window.desktop?.setNotificationOpen(e.target.value as 'app' | 'window')}
            className={FIELD}
          >
            <option value="app">{S.openInApp}</option>
            <option value="window">{S.openInWindow}</option>
          </select>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={S.notificationContent}>
        <SettingRow label={S.showSender} description={S.showSenderDescription} htmlFor="setting-show-sender">
          <Switch
            id="setting-show-sender"
            checked={prefs?.notifications.showSender !== false}
            onChange={(v) => window.desktop?.setNotificationExtras({ showSender: v })}
          />
        </SettingRow>

        <SettingRow
          label={S.showSubject}
          description={S.showSubjectDescription}
          htmlFor="setting-show-subject"
        >
          <Switch
            id="setting-show-subject"
            checked={prefs?.notifications.showSubject !== false}
            onChange={(v) => window.desktop?.setNotificationExtras({ showSubject: v })}
          />
        </SettingRow>

        <SettingRow label={S.testNotification} description={S.testNotificationDescription}>
          <button type="button" onClick={() => window.desktop?.testNotification()} className={BUTTON}>
            {S.testNotificationButton}
          </button>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={S.soundGroup}>
        <SettingRow label={S.playSound} description={S.playSoundDescription} htmlFor="setting-play-sound">
          <Switch
            id="setting-play-sound"
            checked={prefs?.notifications.sound !== false}
            onChange={(v) => window.desktop?.setNotificationExtras({ sound: v })}
          />
        </SettingRow>
        <SettingRow label={S.soundChoice} description={S.soundChoiceDescription} htmlFor="setting-sound-name">
          <select
            id="setting-sound-name"
            disabled={prefs?.notifications.sound === false}
            value={prefs?.notifications.soundName ?? ''}
            onChange={(e) => window.desktop?.setNotificationExtras({ soundName: e.target.value })}
            className={`${FIELD} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {/* The empty value is what an untouched prefs file holds, and it resolves to
                DEFAULT_SOUND rather than to silence - which makes it the same sound as the
                first entry below it. The label says so, because two entries that produce
                one sound is a trap in a list opened to choose between them. Removing the
                option instead would leave every stored '' with nothing selected, and every
                preference naming one of the synthesised sounds this replaced lands here
                too. */}
            <option value="">{S.soundDefault}</option>
            {SOUNDS.map((s) => (
              <option key={s.name} value={s.name}>
                {soundLabel(S, s.name)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={prefs?.notifications.sound === false}
            onClick={() =>
              playSound(
                soundNameOrDefault(prefs?.notifications.soundName ?? ''),
                prefs?.notifications.volume ?? 1,
              )
            }
            className={BUTTON}
          >
            {S.soundPreview}
          </button>
        </SettingRow>

        <SettingRow
          label={S.volumeLabel(Math.round((prefs?.notifications.volume ?? 1) * 100))}
          description={S.volumeDescription}
          htmlFor="setting-sound-volume"
        >
          <input
            id="setting-sound-volume"
            type="range"
            min={0}
            max={100}
            step={5}
            disabled={prefs?.notifications.sound === false}
            value={Math.round((prefs?.notifications.volume ?? 1) * 100)}
            onChange={(e) =>
              window.desktop?.setNotificationExtras({ volume: Number(e.target.value) / 100 })
            }
            className={`w-40 accent-neutral-900 disabled:cursor-not-allowed disabled:opacity-50 dark:accent-neutral-100 ${FOCUS_RING}`}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={S.navGoogleApps}>
        <SettingRow
          label={S.googleAppsNotifications}
          description={S.googleAppsNotificationsDescription}
          htmlFor="setting-google-apps-notify"
        >
          <Switch
            id="setting-google-apps-notify"
            checked={prefs?.notifications.googleApps !== false}
            onChange={(v) => window.desktop?.setNotificationExtras({ googleApps: v })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={S.navDownloads}>
        <SettingRow
          label={S.downloadNotify}
          description={S.downloadNotifyDescription}
          htmlFor="setting-download-notify"
        >
          <Switch
            id="setting-download-notify"
            checked={prefs?.downloads.notify !== false}
            onChange={(v) => window.desktop?.setDownloadPrefs({ notify: v })}
          />
        </SettingRow>

        <SettingRow
          label={S.downloadOnClick}
          description={S.downloadOnClickDescription}
          htmlFor="setting-download-click"
        >
          <select
            id="setting-download-click"
            disabled={prefs?.downloads.notify === false}
            value={prefs?.downloads.notifyClick ?? 'show-in-folder'}
            onChange={(e) =>
              window.desktop?.setDownloadPrefs({
                notifyClick: e.target.value as 'show-in-folder' | 'open-file' | 'nothing',
              })
            }
            className={`${FIELD} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <option value="show-in-folder">{S.downloadClickShowInFolder}</option>
            <option value="open-file">{S.downloadClickOpenFile}</option>
            <option value="nothing">{S.downloadClickNothing}</option>
          </select>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup>
        <h3 id={MATRIX_TITLE_ID} className={`${BLOCK_TITLE} mb-3`}>
          {S.perAccountNotifications}
        </h3>

        {profiles.length === 0 ? (
          <p className={`${PANEL} px-4 py-3.5 text-[13.5px] text-neutral-500 dark:text-neutral-400`}>{S.noAccounts}</p>
        ) : (
          <div className={`${PANEL} overflow-x-auto`}>
            <table
              aria-labelledby={MATRIX_TITLE_ID}
              className="w-full min-w-[420px] table-fixed text-[13px]"
            >
              <thead>
                <tr className={`border-b ${HAIRLINE}`}>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400">
                    {S.accountLabelField}
                  </th>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      title={c.name}
                      className="w-16 px-1 py-2 align-bottom text-center text-xs font-medium leading-tight text-neutral-500 dark:text-neutral-400"
                    >
                      <span className="block whitespace-normal break-words">{c.header}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className={`divide-y ${DIVIDER}`}>
                {profiles.map((p) => {
                  const account = prefs?.accounts?.[p.email];
                  return (
                    <tr key={p.email}>
                      <th scope="row" title={p.email} className="px-4 py-2 text-left font-normal">
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            aria-hidden
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: p.color }}
                          />
                          <span className="min-w-0 truncate font-medium leading-tight">
                            {displayName(p)}
                          </span>
                        </span>
                      </th>
                      {columns.map((c) => {
                        const cell = c.cell(p, account);
                        return (
                          <td key={c.key} className="px-1 py-2 text-center">
                            {cell ? (
                              <input
                                type="checkbox"
                                checked={cell.checked}
                                onChange={(e) => cell.set(e.target.checked)}
                                aria-label={c.name}
                                title={c.name}
                                className={CHECKBOX}
                              />
                            ) : (
                              <>
                                <span aria-hidden className="text-neutral-400 dark:text-neutral-600">
                                  —
                                </span>
                                <span className="sr-only">{S.toggleNotApplicable}</span>
                              </>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SettingsGroup>
    </Section>
  );
}


//===========================
// Helper functions
//===========================

// The switch rather than a label on SoundSpec, because a sound's name is a stored
// preference key and must not move with the interface language. Falling back to the raw
// name keeps a sound listed even if its label is ever forgotten.
function soundLabel(S: UiStrings, name: string): string {
  switch (name) {
    case 'notify-1':
      return S.soundNotify1;
    case 'notify-2':
      return S.soundNotify2;
    case 'notify-3':
      return S.soundNotify3;
    case 'notify-4':
      return S.soundNotify4;
    default:
      return name;
  }
}

function toggleColumns(S: UiStrings): ToggleColumn[] {
  return [
    {
      key: 'notify',
      header: S.mailToggle,
      name: S.mailToggleTitle,
      cell: (p, a) => ({
        checked: a?.notify !== false,
        set: (v) => window.desktop?.setAccountPref({ email: p.email, notify: v }),
      }),
    },
    {
      key: 'calendar',
      header: S.calendarToggle,
      name: S.calendarToggleTitle,
      cell: (p, a) =>
        p.hasCalendar
          ? {
              checked: a?.calendarNotify === true,
              set: (v) => window.desktop?.setAccountPref({ email: p.email, calendarNotify: v }),
            }
          : null,
    },
    {
      key: 'badge',
      header: S.badgeToggle,
      name: S.badgeToggleTitle,
      cell: (p, a) => ({
        checked: a?.badgeCount !== false,
        set: (v) => window.desktop?.setAccountPref({ email: p.email, badgeCount: v }),
      }),
    },
    {
      key: 'sound',
      header: S.soundToggle,
      name: S.soundToggleTitle,
      cell: (p, a) => ({
        checked: a?.notifySound !== false,
        set: (v) => window.desktop?.setAccountPref({ email: p.email, notifySound: v }),
      }),
    },
    {
      key: 'persist',
      header: S.persistToggle,
      name: S.persistToggleTitle,
      cell: (p, a) => ({
        checked: a?.notifyPersist === true,
        set: (v) => window.desktop?.setAccountPref({ email: p.email, notifyPersist: v }),
      }),
    },
  ];
}

function displayName(p: Profile): string {
  return p.label?.trim() || p.name?.trim() || p.email;
}
