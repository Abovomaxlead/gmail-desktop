// The reconnect notice's wording. It cannot be dismissed, so a sentence that is not
// true stays on screen until the next release.

import { describe, it, expect } from 'vitest';
import { reconnectHeading } from '../renderer/app/reconnect-text';

const expired = (email: string) => ({ email, reason: 'expired' as const });
const push = (email: string) => ({ email, reason: 'push' as const });

describe('reconnectHeading', () => {
  it('says the connection expired when that is what happened', () => {
    const h = reconnectHeading([expired('a@x.nl')]);
    expect(h.title).toBe('Verbinding met Gmail verlopen');
    expect(h.sub).toContain('verplaatsen');
  });

  it('does not claim anything expired when only push needs permission', () => {
    const h = reconnectHeading([push('a@x.nl')]);
    expect(h.title).not.toContain('verlopen');
    expect(h.sub).not.toContain('verplaatsen');
    expect(h.sub.toLowerCase()).toContain('meldingen');
  });

  it('scales to more than one account without changing what it claims', () => {
    expect(reconnectHeading([push('a@x.nl'), push('b@x.nl')]).sub.toLowerCase()).toContain(
      'meldingen',
    );
    expect(reconnectHeading([expired('a@x.nl'), expired('b@x.nl')]).title).toBe(
      '2 accounts opnieuw verbinden',
    );
  });

  it('only says what holds for every account in a mixed list', () => {
    const h = reconnectHeading([expired('a@x.nl'), push('b@x.nl')]);
    expect(h.title).toBe('2 accounts opnieuw verbinden');
    expect(h.sub).toContain('verplaatsen');
    expect(h.sub.toLowerCase()).toContain('meldingen');
  });
});
