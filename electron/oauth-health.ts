// Which accounts lost their Gmail link, and how big the banner about it should be.
// The two reasons are not interchangeable: 'expired' means the link is really gone
// and moving mail no longer works, 'push' means only notifications are down. Push
// reasons count only when push is actually configured, since every pre-existing
// token predates the push-only scope and would otherwise banner every machine after
// an update. The banner is placed bottom-right and sized to itself, because a view
// over the whole window would swallow every click meant for Gmail.
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

export function accountsNeedingReconnect(input: HealthInput): ReconnectAccount[] {
  const out: ReconnectAccount[] = [];
  for (const email of input.ownEmails) {
    if (!input.hasToken(email) || input.refreshFailed(email)) {
      out.push({ email, reason: 'expired' });
    } else if (input.pushConfigured && (input.missingScopes(email) || input.pushRefused(email))) {
      out.push({ email, reason: 'push' });
    }
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
