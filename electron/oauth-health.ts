// Which accounts lost their Gmail link, and how big the banner about it should be.
// The two reasons are not interchangeable: 'expired' means the link is really gone
// and moving mail no longer works, 'push' means only notifications are down. Push
// reasons count only when push is actually configured, since every pre-existing
// token predates the push-only scope and would otherwise banner every machine after
// an update. The banner is placed bottom-right and sized to itself, because a view
// over the whole window would swallow every click meant for Gmail.
import type { AccountOAuthStatus, OAuthStatus } from '../renderer/lib/oauth-status';

export type ReconnectReason = 'expired' | 'push';

export interface ReconnectAccount {
  email: string;
  reason: ReconnectReason;
}

export interface HealthInput {
  ownEmails: string[];
  hasToken: (email: string) => boolean;
  refreshFailed: (email: string) => boolean;
  pushConfigured: boolean;
  missingScopes: (email: string) => boolean;
  pushRefused: (email: string) => boolean;
}

/** The link state of every own account, in the order they were given. The panel draws
 * these directly; the banner takes the projection below. */
export function accountOAuthStatuses(input: HealthInput): AccountOAuthStatus[] {
  return input.ownEmails.map((email) => ({ email, status: statusFor(input, email) }));
}

/** Precedence matters and is not arbitrary. A link that is gone outranks a scope that is
 * missing, because there is nothing to re-grant a scope on; and a push fault only counts
 * when push is configured, since every token stored before the push scope existed lacks
 * it and would otherwise flag every machine after an update. */
function statusFor(input: HealthInput, email: string): OAuthStatus {
  if (!input.hasToken(email)) return 'unlinked';
  if (input.refreshFailed(email)) return 'expired';
  if (input.pushConfigured && (input.missingScopes(email) || input.pushRefused(email))) {
    return 'push-only';
  }
  return 'linked';
}

/** How each status reads to the banner, which has only two reasons and only needs two: a
 * link that is gone is 'expired' whether it expired or was never made, because the
 * sentence the banner writes about it is the same either way. `linked` maps explicitly to
 * `null`, which is what keeps a healthy account out of the banner. The map is total rather
 * than `Partial` on purpose: a `Partial` map answers `undefined` for any status nobody
 * mapped, so a fifth `OAuthStatus` added later would drop its accounts out of the banner
 * silently, with a green test suite. A total map turns that same mistake into a compile
 * error right here, at the point where the omission happens. */
const RECONNECT_REASON: Record<OAuthStatus, ReconnectReason | null> = {
  linked: null,
  unlinked: 'expired',
  expired: 'expired',
  'push-only': 'push',
};

/** Which accounts the banner should name, derived from the statuses rather than worked out
 * again. Two functions reading the same inputs to answer overlapping questions is how the
 * banner and the accounts panel would come to disagree about one account, and that
 * disagreement would be invisible until someone reported it. */
export function accountsNeedingReconnect(input: HealthInput): ReconnectAccount[] {
  const out: ReconnectAccount[] = [];
  for (const { email, status } of accountOAuthStatuses(input)) {
    const reason = RECONNECT_REASON[status];
    if (reason) out.push({ email, reason });
  }
  return out;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const WIDTH = 380;
const HEADER = 62;
const ROW = 46;
const PADDING = 14;
const MARGIN = 16;

export function bannerBounds(win: { width: number; height: number }, rows: number): Rect {
  const width = Math.min(WIDTH, Math.max(240, win.width - MARGIN * 2));
  const wanted = HEADER + Math.max(1, rows) * ROW + PADDING;
  const height = Math.min(wanted, Math.max(120, Math.round(win.height * 0.6)));
  return {
    x: Math.max(0, win.width - width - MARGIN),
    y: Math.max(0, win.height - height - MARGIN),
    width,
    height,
  };
}
