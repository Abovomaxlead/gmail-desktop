// Parsing the delegated mailboxes out of Google's account switcher.

import { describe, it, expect } from 'vitest';
import { parseDelegatedEntries } from '../electron/delegation/delegation';

const DELEGATED = 'https://mail.google.com/mail/u/0/d/AEoRXRTYOddZV924KXKu6a5zD9bNp1IJo1ctbL1EvLsatGZu6d_R/';

describe('parseDelegatedEntries', () => {
  it('normalizes and keeps Google’s href verbatim as the mailUrl', () => {
    const [e] = parseDelegatedEntries([{ email: '  Bart@Abovomaxlead.NL ', href: DELEGATED }]);
    expect(e.email).toBe('bart@abovomaxlead.nl');
    expect(e.mailUrl).toBe(DELEGATED);
  });
  it('drops entries missing an email or href', () => {
    expect(parseDelegatedEntries([{ email: '', href: DELEGATED }])).toEqual([]);
    expect(parseDelegatedEntries([{ email: 'x@y.com', href: '' }])).toEqual([]);
  });
});
