// Text for the dialogs main raises by itself. The renderer's string sets are out of
// reach here, so these three live separately, with the same precedence as everywhere
// else: Rene mode first, then the locale. Returning one frozen object per variant keeps
// the Rene comparison in the tests an identity check.

import type { Locale } from './locale';

export interface NativeLabels {
  composeTitle: string;
  composeMessage: string;
  cancel: string;
}

const EN: NativeLabels = {
  composeTitle: 'New message',
  composeMessage: 'Send from which account?',
  cancel: 'Cancel',
};

const NL: NativeLabels = {
  composeTitle: 'Nieuw bericht',
  composeMessage: 'Vanaf welk account wil je versturen?',
  cancel: 'Annuleren',
};

const RENE: NativeLabels = {
  composeTitle: 'Nieuw mailtje',
  composeMessage: 'Van wie moet het mailtje komen?',
  cancel: 'Laat maar',
};

export function nativeLabels(locale: Locale, reneMode: boolean): NativeLabels {
  if (reneMode) return RENE;
  return locale === 'nl' ? NL : EN;
}
