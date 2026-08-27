// Deciding that a delegated mailbox's URL has gone dead, off the one thing the app can see
// without asking Google anything: the page title of the view that URL opened.
//
// The opaque id in /mail/u/<n>/d/<id>/ rotates. When it does, Gmail drops the view on the
// signed-in account's own mailbox instead, and the view goes on running under the delegated
// profile -- which is the report this fixes: "a delegated mailbox that always worked shows my
// own inbox".

import { describe, it, expect } from 'vitest';
import {
  titleMailbox,
  mailUrlVerdict,
  deadDelegatedUrls,
} from '../electron/delegation/delegated-health';

describe('titleMailbox', () => {
  // Gmail titles a mail view "<page> - <address> - Gmail". The address is read out of the
  // segment before the suffix and never out of the page part, which is where a subject sits.
  it('reads the mailbox out of a loaded title', () => {
    expect(titleMailbox('Inbox (9) - support@abovomaxlead.nl - Gmail')).toBe(
      'support@abovomaxlead.nl',
    );
  });

  // Shape, never words: the page part is translated and must not be matched on.
  it('reads it out of a translated title just the same', () => {
    expect(titleMailbox('Postvak IN (3) - support@abovomaxlead.nl - Gmail')).toBe(
      'support@abovomaxlead.nl',
    );
  });

  it('reads it out of an open conversation, which still names its mailbox', () => {
    expect(titleMailbox('Re: factuur 2231 - support@abovomaxlead.nl - Gmail')).toBe(
      'support@abovomaxlead.nl',
    );
  });

  // The trap: a subject that carries an address of its own. The mailbox is the last segment
  // before the suffix, so the subject can hold as many addresses as it likes.
  it('takes the mailbox and not an address inside the subject', () => {
    expect(titleMailbox('bericht van piet@elders.nl - support@abovomaxlead.nl - Gmail')).toBe(
      'support@abovomaxlead.nl',
    );
  });

  it('lowercases what it answers, so two spellings compare equal', () => {
    expect(titleMailbox('Inbox - Support@Abovomaxlead.NL - Gmail')).toBe(
      'support@abovomaxlead.nl',
    );
  });

  it('answers nothing for a title that names no mailbox', () => {
    expect(titleMailbox('Gmail')).toBeNull();
    expect(titleMailbox('Inbox - Gmail')).toBeNull();
    expect(titleMailbox('Sign in - Google Accounts')).toBeNull();
  });

  it('answers nothing for a title that is not there yet', () => {
    expect(titleMailbox(null)).toBeNull();
    expect(titleMailbox(undefined)).toBeNull();
    expect(titleMailbox('')).toBeNull();
  });
});

describe('mailUrlVerdict', () => {
  it('calls a url alive when the view shows the mailbox it was opened for', () => {
    expect(mailUrlVerdict('support@abovomaxlead.nl', 'Inbox (9) - support@abovomaxlead.nl - Gmail')).toBe(
      'ok',
    );
  });

  it('compares addresses without caring about case', () => {
    expect(mailUrlVerdict('Support@Abovomaxlead.nl', 'Inbox - support@abovomaxlead.nl - Gmail')).toBe(
      'ok',
    );
  });

  // The bug, as one assertion: the delegated view is showing the signed-in account's own
  // mailbox, which is what a rotated id leaves behind.
  it('calls a url dead when the view shows a different mailbox', () => {
    expect(
      mailUrlVerdict('support@abovomaxlead.nl', 'Inbox (9) - luca.manuel@abovomaxlead.nl - Gmail'),
    ).toBe('dead');
  });

  // Everything that is merely not known yet has to stay 'unknown': a view still loading, a
  // login page, a signed-out account. Reading any of those as dead would scrape the switcher
  // for a url that was never broken.
  it('knows nothing from a title that has not settled', () => {
    expect(mailUrlVerdict('support@abovomaxlead.nl', null)).toBe('unknown');
    expect(mailUrlVerdict('support@abovomaxlead.nl', '')).toBe('unknown');
    expect(mailUrlVerdict('support@abovomaxlead.nl', 'Gmail')).toBe('unknown');
    expect(mailUrlVerdict('support@abovomaxlead.nl', 'Sign in - Google Accounts')).toBe('unknown');
  });
});

describe('deadDelegatedUrls', () => {
  it('names only the mailboxes whose view is showing someone else', () => {
    expect(
      deadDelegatedUrls([
        { email: 'support@abovomaxlead.nl', title: 'Inbox (9) - luca.manuel@abovomaxlead.nl - Gmail' },
        { email: 'bart@abovomaxlead.nl', title: 'Inbox - bart@abovomaxlead.nl - Gmail' },
        { email: 'info@abovomaxlead.nl', title: null },
      ]),
    ).toEqual(['support@abovomaxlead.nl']);
  });

  it('names nothing when every view shows its own mailbox', () => {
    expect(
      deadDelegatedUrls([{ email: 'bart@abovomaxlead.nl', title: 'Inbox - bart@abovomaxlead.nl - Gmail' }]),
    ).toEqual([]);
  });

  it('names nothing at all when there is nothing to judge', () => {
    expect(deadDelegatedUrls([])).toEqual([]);
  });

  it('names a mailbox once however many views report it', () => {
    const wrong = 'Inbox - luca.manuel@abovomaxlead.nl - Gmail';
    expect(
      deadDelegatedUrls([
        { email: 'support@abovomaxlead.nl', title: wrong },
        { email: 'support@abovomaxlead.nl', title: wrong },
      ]),
    ).toEqual(['support@abovomaxlead.nl']);
  });
});
