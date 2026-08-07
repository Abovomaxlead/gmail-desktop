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
