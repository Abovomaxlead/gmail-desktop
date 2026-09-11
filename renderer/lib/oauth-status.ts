// The OAuth link state of one account, in renderer/lib because main computes it and the
// accounts panel draws it — a second copy is a second thing to forget when a state is added.
//
// Four states, where the reconnect banner has one: the banner only says that something needs
// attention, while a list has to answer whether this account was ever connected.
//
// 'incomplete' is a token that still works but was granted fewer rights than this version of
// the app needs -- adding a scope (see SCOPES in electron/auth/google-oauth.ts) puts every
// stored token in that state. Told apart from 'expired' because nothing is wrong with the
// connection: it is the app that started asking for more, and "connection expired" would send
// somebody looking for a network problem that is not there.

export type OAuthStatus = 'linked' | 'unlinked' | 'expired' | 'incomplete';

export interface AccountOAuthStatus {
  email: string;
  status: OAuthStatus;
}

export interface OAuthStatusReport {
  configured: boolean;
  accounts: AccountOAuthStatus[];
}
