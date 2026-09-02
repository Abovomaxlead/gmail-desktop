// The reconnect notice's wording. It cannot be dismissed, so a sentence that is not
// true stays on screen until the next release.

import { describe, it, expect } from 'vitest';
import { reconnectHeading } from '../renderer/app/reconnect-text';

const expired = (email: string) => ({ email, reason: 'expired' as const });

describe('reconnectHeading', () => {
  it('says the connection expired when that is what happened', () => {
    const h = reconnectHeading([expired('a@x.nl')]);
    expect(h.title).toBe('Verbinding met Gmail verlopen');
    expect(h.sub).toContain('verplaatsen');
  });

  it('scales to more than one account without changing what it claims', () => {
    const h = reconnectHeading([expired('a@x.nl'), expired('b@x.nl')]);
    expect(h.title).toBe('2 accounts opnieuw verbinden');
    expect(h.sub).toContain('verplaatst');
  });

  // The card is drawn from whatever the list says, so a heading for nobody would be a claim
  // about an account that is not there.
  it('says nothing at all when there is no account yet', () => {
    expect(reconnectHeading([])).toEqual({ title: '', sub: '' });
  });
});
