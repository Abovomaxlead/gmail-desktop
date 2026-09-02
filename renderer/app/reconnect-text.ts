// Text for the reconnect notice, kept pure so a test can hold it to account: the notice
// cannot be dismissed, so an untrue sentence stays on screen until the next release.
//
// Every account in the list is there for the same reason -- its token is gone -- so the
// wording only has to answer how many of them there are.

import type { ReconnectAccount } from '../lib/reconnect';

export interface ReconnectHeading {
  title: string;
  sub: string;
}

/**
 * The two lines the reconnect notice shows
 *
 * @param accounts
 * @returns {ReconnectHeading} both lines empty for an empty list, which is the one case with
 *   nothing true to say -- the notice itself draws nothing until the first list arrives
 */
export function reconnectHeading(accounts: ReconnectAccount[]): ReconnectHeading {
  if (accounts.length === 0) return { title: '', sub: '' };
  const many = accounts.length > 1;
  return {
    title: many ? `${accounts.length} accounts opnieuw verbinden` : 'Verbinding met Gmail verlopen',
    sub: many
      ? 'Zonder verbinding kan er geen mail verplaatst worden.'
      : 'Verbind opnieuw om mail te kunnen verplaatsen.',
  };
}
