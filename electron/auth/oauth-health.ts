// Which accounts lost their Gmail link, and how big the banner about it should be.
//
// Being named is the whole message -- the link is gone and moving mail no longer works. The
// banner sits bottom-right and is sized to itself, because a view over the whole window would
// swallow every click meant for Gmail.

import type { AccountOAuthStatus, OAuthStatus } from '../../renderer/lib/oauth-status';
import type { ReconnectAccount } from '../../renderer/lib/reconnect';


//===========================
// Types
//===========================

export interface HealthInput {
  ownEmails: string[];
  hasToken: (email: string) => boolean;
  refreshFailed: (email: string) => boolean;
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

// A table rather than `status !== 'linked'`, so a new status has to say here whether the
// banner names it instead of being swept in by a default nobody chose.
const NEEDS_RECONNECT: Record<OAuthStatus, boolean> = {
  linked: false,
  unlinked: true,
  expired: true,
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
  return accountOAuthStatuses(input)
    .filter(({ status }) => NEEDS_RECONNECT[status])
    .map(({ email }) => ({ email }));
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
 * A missing token and a failed refresh are told apart because a list has to answer whether
 * this account was ever connected, while the banner only says something needs attention
 *
 * @param input
 * @param email
 * @returns the status the panel and the banner both read
 * @private
 */
function statusFor(input: HealthInput, email: string): OAuthStatus {
  if (!input.hasToken(email)) return 'unlinked';
  if (input.refreshFailed(email)) return 'expired';
  return 'linked';
}
