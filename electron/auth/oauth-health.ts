// Which accounts lost their Gmail link, and how big the banner about it should be.
//
// 'expired' means the link is gone and moving mail no longer works; 'push' means only
// notifications are down. The banner sits bottom-right and is sized to itself, because a
// view over the whole window would swallow every click meant for Gmail.

import type { AccountOAuthStatus, OAuthStatus } from '../../renderer/lib/oauth-status';



//===========================
// Types
//===========================

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

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}


//===========================
// Constants
//===========================

const RECONNECT_REASON: Record<OAuthStatus, ReconnectReason | null> = {
  linked: null,
  unlinked: 'expired',
  expired: 'expired',
  'push-only': 'push',
};

const WIDTH = 380;
const HEADER = 62;
const ROW = 46;
const PADDING = 14;
const MARGIN = 16;


//===========================
// Exported functions
//===========================

/**
 * The link state of every own account
 *
 * @param input
 * @returns one status per account, in the order they were given
 */
export function accountOAuthStatuses(input: HealthInput): AccountOAuthStatus[] {
  return input.ownEmails.map((email) => ({ email, status: statusFor(input, email) }));
}

// derived from the statuses rather than worked out again, so the banner and the panel
// cannot disagree about an account
/**
 * Which accounts the reconnect banner should name
 *
 * @param input
 * @returns one entry per unhealthy account; healthy ones are left out
 */
export function accountsNeedingReconnect(input: HealthInput): ReconnectAccount[] {
  const out: ReconnectAccount[] = [];
  for (const { email, status } of accountOAuthStatuses(input)) {
    const reason = RECONNECT_REASON[status];
    if (reason) out.push({ email, reason });
  }
  return out;
}

/**
 * Where the reconnect banner sits and how big it is
 *
 * @param win the window's content size
 * @param rows how many accounts the banner names
 * @returns bounds in the bottom-right corner, sized to the rows
 */
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


//===========================
// Helper functions
//===========================

/**
 * The link state of one account
 *
 * A gone link outranks a missing scope, since there is nothing to re-grant a scope on; and
 * a push fault counts only when push is configured, because every token stored before the
 * push scope existed lacks it.
 *
 * @param input
 * @param email
 * @returns the status the panel and the banner both read
 * @private
 */
function statusFor(input: HealthInput, email: string): OAuthStatus {
  if (!input.hasToken(email)) return 'unlinked';
  if (input.refreshFailed(email)) return 'expired';
  if (input.pushConfigured && (input.missingScopes(email) || input.pushRefused(email))) {
    return 'push-only';
  }
  return 'linked';
}
