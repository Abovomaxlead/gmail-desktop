// The OAuth link state of one account, in renderer/lib because main computes it and the
// accounts panel draws it — a second copy is a second thing to forget when a state is added.
//
// Four states, where the reconnect banner has two: the banner only says that something
// needs attention, while a list has to answer whether this account was ever connected.
// 'push-only' is the one that must not be folded in — the link works and only notifications
// are down, so reporting it as gone sends someone re-granting consent for nothing.

export type OAuthStatus = 'linked' | 'unlinked' | 'expired' | 'push-only';

export interface AccountOAuthStatus {
  email: string;
  status: OAuthStatus;
}

export interface OAuthStatusReport {
  configured: boolean;
  accounts: AccountOAuthStatus[];
}
