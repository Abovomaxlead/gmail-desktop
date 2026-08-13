// Text for the dialogs main raises by itself. The renderer's string sets are out of
// reach here, so these three live separately, with the same precedence as everywhere
// else: Rene mode first, then the locale. Returning one frozen object per variant keeps
// the Rene comparison in the tests an identity check.

import type { Locale } from '../core/locale';


//===========================
// Types
//===========================

export interface NativeLabels {
  readonly composeTitle: string;
  readonly composeMessage: string;
  readonly cancel: string;
  readonly updateAvailableTitle: string;
  readonly updateAvailableBody: (version: string) => string;
  readonly linkOpenButton: string;
  readonly linkMessage: (host: string) => string;
  readonly linkDetail: (url: string) => string;
  readonly linkAlwaysAllow: (host: string) => string;
  readonly ok: string;
  readonly download: string;
  readonly later: string;
  readonly updateDevOnly: string;
  readonly updateAvailableMessage: (version?: string) => string;
  readonly updateLatestMessage: (version?: string) => string;
  readonly updateInstalledDetail: (version: string) => string;
  readonly updateCheckFailed: string;
  readonly accountNotAddedTitle: string;
  readonly accountNotAddedBody: (email: string, error: string) => string;
  readonly testNotificationBody: string;
  readonly downloadCompleteTitle: string;
  readonly downloadCancelledTitle: string;
  readonly downloadFailedTitle: string;
  readonly noSubject: string;
  /** The stack folded several notifications into one card and then could not paint it, so
   * the count has to leave as a system notification. Only main knows this happened, which
   * is why the wording lives here and not with the page's own summary. */
  readonly collapsedNotifications: (count: number) => string;
}


//===========================
// Label sets
//===========================

const EN: NativeLabels = Object.freeze({
  composeTitle: 'New message',
  composeMessage: 'Send from which account?',
  cancel: 'Cancel',
  updateAvailableTitle: 'Update available',
  updateAvailableBody: (version: string) => `Gmail Desktop ${version} is ready. Click to update.`,
  linkOpenButton: 'Open link',
  linkMessage: (host: string) => `Open ${host}?`,
  linkDetail: (url: string) => `This link leaves Gmail Desktop and opens in your browser.\n\n${url}`,
  linkAlwaysAllow: (host: string) => `Always allow ${host}`,
  ok: 'OK',
  download: 'Download',
  later: 'Later',
  updateDevOnly: 'Update checks only work in the installed app.',
  updateAvailableMessage: (version?: string) => `A new version${version ? ` (v${version})` : ''} is available.`,
  updateLatestMessage: (version?: string) => `You already have the latest version${version ? ` (v${version})` : ''}.`,
  updateInstalledDetail: (version: string) => `You have v${version} installed.`,
  updateCheckFailed: "Couldn't check for updates.",
  accountNotAddedTitle: 'Account not added',
  accountNotAddedBody: (email: string, error: string) =>
    `${email} is not linked to Gmail, so the account was not added. ${error}`,
  testNotificationBody: 'This is what a notification looks like.',
  downloadCompleteTitle: 'Download complete',
  downloadCancelledTitle: 'Download cancelled',
  downloadFailedTitle: 'Download failed',
  noSubject: '(no subject)',
  collapsedNotifications: (count: number) => `${count} new notifications`,
});

const NL: NativeLabels = Object.freeze({
  composeTitle: 'Nieuw bericht',
  composeMessage: 'Vanaf welk account wil je versturen?',
  cancel: 'Annuleren',
  updateAvailableTitle: 'Update beschikbaar',
  updateAvailableBody: (version: string) => `Gmail Desktop ${version} staat klaar. Klik om bij te werken.`,
  linkOpenButton: 'Link openen',
  linkMessage: (host: string) => `${host} openen?`,
  linkDetail: (url: string) => `Deze link verlaat Gmail Desktop en opent in je browser.\n\n${url}`,
  linkAlwaysAllow: (host: string) => `${host} altijd toestaan`,
  ok: 'OK',
  download: 'Downloaden',
  later: 'Later',
  updateDevOnly: 'Zoeken naar updates werkt alleen in de geïnstalleerde app.',
  updateAvailableMessage: (version?: string) => `Er is een nieuwe versie${version ? ` (v${version})` : ''}.`,
  updateLatestMessage: (version?: string) => `Je hebt de nieuwste versie al${version ? ` (v${version})` : ''}.`,
  updateInstalledDetail: (version: string) => `Je hebt v${version} geïnstalleerd.`,
  updateCheckFailed: 'Controleren op updates is mislukt',
  accountNotAddedTitle: 'Account niet toegevoegd',
  accountNotAddedBody: (email: string, error: string) =>
    `${email} is niet gekoppeld aan Gmail, dus het account is niet toegevoegd. ${error}`,
  testNotificationBody: 'Zo ziet een melding eruit.',
  downloadCompleteTitle: 'Download voltooid',
  downloadCancelledTitle: 'Download geannuleerd',
  downloadFailedTitle: 'Download mislukt',
  noSubject: '(geen onderwerp)',
  collapsedNotifications: (count: number) => `${count} nieuwe meldingen`,
});

const RENE: NativeLabels = Object.freeze({
  composeTitle: 'Nieuw mailtje',
  composeMessage: 'Van wie moet het mailtje komen?',
  cancel: 'Laat maar',
  updateAvailableTitle: 'Er is iets nieuws',
  updateAvailableBody: (version: string) => `Gmail Desktop ${version} is er. Klik hier om hem op te halen.`,
  linkOpenButton: 'Doe maar',
  linkMessage: (host: string) => `Naar ${host} gaan?`,
  linkDetail: (url: string) => `Deze link gaat naar je browser en niet naar deze app.\n\n${url}`,
  linkAlwaysAllow: (host: string) => `${host} mag altijd`,
  ok: 'Oké',
  download: 'Ophalen',
  later: 'Straks',
  updateDevOnly: 'Kijken of er iets nieuws is kan hier niet.',
  updateAvailableMessage: (version?: string) => `Er is iets nieuws${version ? ` (v${version})` : ''}.`,
  updateLatestMessage: (version?: string) => `Je hebt al de nieuwste${version ? ` (v${version})` : ''}.`,
  updateInstalledDetail: (version: string) => `Jij hebt nu v${version}.`,
  updateCheckFailed: 'Kijken of er iets nieuws is lukte niet.',
  accountNotAddedTitle: 'Dit account doet niet mee',
  accountNotAddedBody: (email: string, error: string) =>
    `${email} hoort niet bij Gmail, dus dit account doet niet mee. ${error}`,
  testNotificationBody: 'Zo ziet een berichtje eruit.',
  downloadCompleteTitle: 'Het is opgehaald',
  downloadCancelledTitle: 'Ophalen gestopt',
  downloadFailedTitle: 'Ophalen lukte niet',
  noSubject: '(zonder titel)',
  collapsedNotifications: (count: number) => `Er zijn ${count} nieuwe berichtjes`,
});


//===========================
// Exported functions
//===========================

/**
 * The labels for the dialogs main raises by itself
 *
 * @param locale
 * @param reneMode
 * @returns {NativeLabels} the same frozen object every time, so a test can compare identity
 */
export function nativeLabels(locale: Locale, reneMode: boolean): NativeLabels {
  if (reneMode) return RENE;
  return locale === 'nl' ? NL : EN;
}
