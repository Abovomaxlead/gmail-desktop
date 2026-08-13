// Text for the reconnect notice, kept pure so a test can hold it to account: the
// notice cannot be dismissed, so a sentence that is not true stays on screen until
// the next release. 'expired' means the token is gone and moving mail stops working;
// 'push' means the token still works but lacks the scope push needs, so only the
// notifications and the unread counter are affected. A mixed list may only say what
// is true for every account in it.

export type ReconnectReason = 'expired' | 'push';

export interface ReconnectAccount {
  email: string;
  reason: ReconnectReason;
}

export interface ReconnectHeading {
  title: string;
  sub: string;
}

/**
 * The two lines the reconnect notice shows
 *
 * @param accounts
 * @returns {ReconnectHeading} wording a mixed list can carry: it may only say what is true
 *   for every account in it
 */
export function reconnectHeading(accounts: ReconnectAccount[]): ReconnectHeading {
  const many = accounts.length > 1;
  if (accounts.every((a) => a.reason === 'push')) {
    return {
      title: many ? `${accounts.length} accounts opnieuw toestaan` : 'Meldingen staan stil',
      sub: 'Sta opnieuw toe om meldingen en de ongelezen-teller te krijgen.',
    };
  }
  if (accounts.every((a) => a.reason === 'expired')) {
    return {
      title: many ? `${accounts.length} accounts opnieuw verbinden` : 'Verbinding met Gmail verlopen',
      sub: many
        ? 'Zonder verbinding kan er geen mail verplaatst worden.'
        : 'Verbind opnieuw om mail te kunnen verplaatsen.',
    };
  }
  return {
    title: `${accounts.length} accounts opnieuw verbinden`,
    sub: 'Verbind opnieuw voor het verplaatsen van mail en voor meldingen.',
  };
}
