// Text for the dialogs main raises by itself. The renderer's string sets are out of
// reach here, so these three live separately, with the same precedence as everywhere
// else: Rene mode first, then the locale. Returning one frozen object per variant keeps
// the Rene comparison in the tests an identity check.

import type { Locale } from './locale';

export interface NativeLabels {
  composeTitle: string;
  composeMessage: string;
  cancel: string;
  updateAvailableTitle: string;
  updateAvailableBody: (version: string) => string;
  linkOpenButton: string;
  linkMessage: (host: string) => string;
  linkDetail: (url: string) => string;
  linkAlwaysAllow: (host: string) => string;
}

const EN: NativeLabels = {
  composeTitle: 'New message',
  composeMessage: 'Send from which account?',
  cancel: 'Cancel',
  updateAvailableTitle: 'Update available',
  updateAvailableBody: (version) => `Gmail Desktop ${version} is ready. Click to update.`,
  linkOpenButton: 'Open link',
  linkMessage: (host) => `Open ${host}?`,
  linkDetail: (url) => `This link leaves Gmail Desktop and opens in your browser.\n\n${url}`,
  linkAlwaysAllow: (host) => `Always allow ${host}`,
};

const NL: NativeLabels = {
  composeTitle: 'Nieuw bericht',
  composeMessage: 'Vanaf welk account wil je versturen?',
  cancel: 'Annuleren',
  updateAvailableTitle: 'Update beschikbaar',
  updateAvailableBody: (version) => `Gmail Desktop ${version} staat klaar. Klik om bij te werken.`,
  linkOpenButton: 'Link openen',
  linkMessage: (host) => `${host} openen?`,
  linkDetail: (url) => `Deze link verlaat Gmail Desktop en gaat open in je browser.\n\n${url}`,
  linkAlwaysAllow: (host) => `${host} altijd toestaan`,
};

const RENE: NativeLabels = {
  composeTitle: 'Nieuw mailtje',
  composeMessage: 'Van wie moet het mailtje komen?',
  cancel: 'Laat maar',
  updateAvailableTitle: 'Er is iets nieuws',
  updateAvailableBody: (version) => `Gmail Desktop ${version} is klaar. Klik hier om het nieuw te maken.`,
  linkOpenButton: 'Link openen',
  linkMessage: (host) => `${host} openen?`,
  linkDetail: (url) => `Deze link gaat naar je browser en niet naar deze app.\n\n${url}`,
  linkAlwaysAllow: (host) => `${host} mag altijd`,
};

export function nativeLabels(locale: Locale, reneMode: boolean): NativeLabels {
  if (reneMode) return RENE;
  return locale === 'nl' ? NL : EN;
}
