// Which accounts may hold a Gmail API token. Signing into the Gmail view stays open to
// anyone; linking an account is limited to the work domain, so a private mailbox is
// readable without being synced, watched for push or dropped into.
//
// One function, so the consent flow, the status list and the startup purge cannot disagree.


//===========================
// Types
//===========================

export interface TokenStore {
  connected(): string[];
  remove(email: string): void;
}

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
 * The mailboxes a dragged mail may be copied into
 *
 * @param profiles every account in the sidebar, own and delegated
 * @param source the mailbox the drag came out of, left out; empty when it is not known
 * @returns the addresses that may be offered as a copy target, in sidebar order
 */
export function copyTargetEmails(
  profiles: readonly AccountProfile[],
  source: string,
): string[] {
  return profiles
    .filter((p) => p.kind === 'authuser' || p.kind === 'delegated')
    .filter((p) => isAllowedAccount(p.email))
    .filter((p) => !source || p.email !== source)
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
