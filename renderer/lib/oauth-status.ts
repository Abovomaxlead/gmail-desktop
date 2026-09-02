// The OAuth link state of one account, in renderer/lib because main computes it and the
// accounts panel draws it — a second copy is a second thing to forget when a state is added.
//
// Three states, where the reconnect banner has one: the banner only says that something needs
// attention, while a list has to answer whether this account was ever connected.

export type OAuthStatus = 'linked' | 'unlinked' | 'expired';

export interface AccountOAuthStatus {
  email: string;
  status: OAuthStatus;
}

export interface OAuthStatusReport {
  configured: boolean;
  accounts: AccountOAuthStatus[];
}
