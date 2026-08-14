// Which accounts may hold a Gmail API token. Signing into the Gmail view is Google's
// business and stays open to anyone; linking an account is ours, and is limited to the
// work domain.
//
// The reason is that the two are easy to confuse. Adding a personal mailbox to the
// sidebar looks like a display choice, and it is — until consent turns it into an
// account the app syncs, watches for push, and drops mail into. Refusing the link is
// the narrow way to keep a private mailbox out of all of that while still letting
// someone read it in the view.
//
// A domain is compared whole rather than by suffix: 'notabovomaxlead.nl' ends in the
// work domain as text and has nothing to do with it, and a subdomain is a different
// Workspace. The check is one function so the consent flow, the status list and the
// startup purge cannot disagree about what counts as a work account.


//===========================
// Types
//===========================

/** Only the two members the purge needs, so a test can stand in for the store. */
export interface TokenStore {
  connected(): string[];
  remove(email: string): void;
}

/** The two fields of a Profile this module reads, so it stays free of Electron. */
export interface AccountProfile {
  kind: 'authuser' | 'delegated';
  email: string;
}


//===========================
// Constants
//===========================

export const ALLOWED_EMAIL_DOMAINS: readonly string[] = ['abovomaxlead.nl'];


//===========================
// Exported functions
//===========================

/**
 * Tells whether an address may be linked to the Gmail API
 *
 * @param email as it came from account detection, so casing and padding are unknown
 * @returns true only for an address in one of the allowed domains
 */
export function isAllowedAccount(email: string): boolean {
  const address = email.trim().toLowerCase();
  const at = address.lastIndexOf('@');
  // Zero means the address starts with '@' and has no local part; -1 means there is no
  // separator at all. Neither is an address.
  if (at <= 0) return false;
  return ALLOWED_EMAIL_DOMAINS.includes(address.slice(at + 1));
}

/**
 * The accounts the health check has anything to say about
 *
 * @param profiles every account in the sidebar, own and delegated
 * @returns own addresses that may hold a token, in the order they were given
 */
export function linkableOwnEmails(profiles: readonly AccountProfile[]): string[] {
  return profiles
    .filter((p) => p.kind === 'authuser' && isAllowedAccount(p.email))
    .map((p) => p.email);
}

/**
 * Unlinks every account that may no longer hold a token
 *
 * @param store the token file
 * @returns the accounts whose token was thrown away
 */
export function dropDisallowedTokens(store: TokenStore): string[] {
  const dropped = store.connected().filter((email) => !isAllowedAccount(email));
  for (const email of dropped) store.remove(email);
  return dropped;
}
