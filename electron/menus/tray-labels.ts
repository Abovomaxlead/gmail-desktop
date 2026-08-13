// Text for the system-tray icon's context menu. Same shape and the same precedence as
// native-labels.ts: Rene mode first, then the locale, one frozen object per variant so
// the Rene comparison in the tests stays an identity check.

import type { Locale } from '../core/locale';


//===========================
// Types
//===========================

export interface TrayLabels {
  readonly open: string;
  readonly quit: string;
  readonly startAtLogin: string;
  readonly snoozeNotifications: string;
  readonly notificationsOff: string;
  readonly snoozedUntil: (time: string) => string;
  readonly snoozeFor10: string;
  readonly snoozeFor30: string;
  readonly snoozeFor1Hour: string;
  readonly snoozeUntilTurnedOn: string;
  readonly turnNotificationsOn: string;
  readonly checkForUpdates: string;
  readonly checkForUpdatesDev: string;
  readonly checkingForUpdates: string;
  readonly downloadUpdate: (version?: string) => string;
  readonly downloadingUpdate: (percent: number) => string;
  readonly restartToInstall: string;
  readonly updateCheckFailed: string;
}


//===========================
// Label sets
//===========================

const EN: TrayLabels = Object.freeze({
  open: 'Open',
  quit: 'Quit',
  startAtLogin: 'Start at login',
  snoozeNotifications: 'Snooze notifications',
  notificationsOff: 'Notifications off',
  snoozedUntil: (time: string) => `Notifications snoozed until ${time}`,
  snoozeFor10: 'For 10 minutes',
  snoozeFor30: 'For 30 minutes',
  snoozeFor1Hour: 'For 1 hour',
  snoozeUntilTurnedOn: 'Until I turn them back on',
  turnNotificationsOn: 'Turn notifications on',
  checkForUpdates: 'Check for updates',
  checkForUpdatesDev: 'Check for updates (dev)',
  checkingForUpdates: 'Checking for updates…',
  downloadUpdate: (version?: string) => `Download update${version ? ` v${version}` : ''}`,
  downloadingUpdate: (percent: number) => `Downloading update… ${percent}%`,
  restartToInstall: 'Restart to install update',
  updateCheckFailed: 'Update check failed — retry',
});

const NL: TrayLabels = Object.freeze({
  open: 'Openen',
  quit: 'Afsluiten',
  startAtLogin: 'Starten bij aanmelden',
  snoozeNotifications: 'Meldingen uitstellen',
  notificationsOff: 'Meldingen uit',
  snoozedUntil: (time: string) => `Meldingen uitgesteld tot ${time}`,
  snoozeFor10: '10 minuten',
  snoozeFor30: '30 minuten',
  snoozeFor1Hour: '1 uur',
  snoozeUntilTurnedOn: 'Tot je ze weer aanzet',
  turnNotificationsOn: 'Meldingen weer aanzetten',
  checkForUpdates: 'Op updates controleren',
  checkForUpdatesDev: 'Op updates controleren (dev)',
  checkingForUpdates: 'Controleren op updates…',
  downloadUpdate: (version?: string) => `Update${version ? ` v${version}` : ''} downloaden`,
  downloadingUpdate: (percent: number) => `Update downloaden… ${percent}%`,
  restartToInstall: 'Opnieuw opstarten om te installeren',
  updateCheckFailed: 'Controleren op updates is mislukt',
});

const RENE: TrayLabels = Object.freeze({
  open: 'Laat zien',
  quit: 'Uitzetten',
  startAtLogin: 'De app gaat vanzelf aan',
  snoozeNotifications: 'Even stil zijn',
  notificationsOff: 'Het is stil',
  snoozedUntil: (time: string) => `Stil tot ${time}`,
  snoozeFor10: '10 minuutjes',
  snoozeFor30: '30 minuutjes',
  snoozeFor1Hour: '1 uurtje',
  snoozeUntilTurnedOn: 'Tot je hem weer aandoet',
  turnNotificationsOn: 'Geluid weer aan',
  checkForUpdates: 'Is er iets nieuws?',
  checkForUpdatesDev: 'Is er iets nieuws? (dev)',
  checkingForUpdates: 'Even kijken…',
  downloadUpdate: (version?: string) => `Update ophalen${version ? ` v${version}` : ''}`,
  downloadingUpdate: (percent: number) => `Update ophalen… ${percent}%`,
  restartToInstall: 'De app gaat even uit en weer aan',
  updateCheckFailed: 'Kijken of er iets nieuws is lukte niet.',
});


//===========================
// Exported functions
//===========================

/**
 * The labels for the tray icon's context menu
 *
 * @param locale
 * @param reneMode
 * @returns {TrayLabels} the same frozen object every time, so a test can compare identity
 */
export function trayLabels(locale: Locale, reneMode: boolean): TrayLabels {
  if (reneMode) return RENE;
  return locale === 'nl' ? NL : EN;
}
