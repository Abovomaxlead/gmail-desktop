// The OAuth link state of one account. In renderer/lib because both sides need it:
// electron/oauth-health.ts computes it from what main knows about the tokens, and the
// accounts panel draws it. Sharing the type is the point — a second copy on the renderer
// side is a second thing to forget when a state is added.
//
// Four states, where the reconnect banner has two. The banner only has to say that
// something needs attention, so "no token was ever stored" and "the token stopped
// refreshing" are the same sentence to it. A list has to answer a different question —
// whether this account was ever connected at all — and cannot do that from one reason.
//
// 'push-only' is the state that would be most misleading if it were folded into the
// others: the link works, mail can still be moved, and only notifications and the unread
// counter are down. Telling someone their connection is gone when it is not sends them
// re-granting consent for a problem they do not have.
export type OAuthStatus = 'linked' | 'unlinked' | 'expired' | 'push-only';

export interface AccountOAuthStatus {
  email: string;
  status: OAuthStatus;
}

/** What main reports about linking on this machine.
 *
 * `configured` exists because its absence cost a colleague a working install. The OAuth
 * client credentials live in a file in userData that the installer cannot carry — it holds
 * a secret — so a fresh machine has no way to link anything, and every path that needs the
 * config gives up quietly: no consent screen when an account is added, no statuses, no
 * banner. An earlier version of this type left the flag out on the grounds that an account
 * with no entry simply gets no status line, which covered a delegated mailbox, an
 * unconfigured machine and the moment before the first check with one rule. It covered them
 * by making them indistinguishable, and "nothing to say" renders exactly like "all is
 * well". This flag is the difference between those two. */
export interface OAuthStatusReport {
  configured: boolean;
  accounts: AccountOAuthStatus[];
}
