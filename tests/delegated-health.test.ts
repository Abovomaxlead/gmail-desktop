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
  delegatedRepairFor,
  mayRereadSwitcher,
  urlFingerprint,
  MAX_DELEGATED_REPAIRS,
  REREAD_GAP_MS,
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

// A title naming the wrong mailbox has two causes, and only one of them is the rotated id the
// switcher scrape exists for. The other is a view that was redirected away from a url that is
// still perfectly good: signed out, the delegated url answers with a login page, and signing
// back in continues into the signed-in account's own inbox. Scraping cannot cure that -- the
// switcher hands back the same url and nothing is replaced -- so the two have to be told apart.
describe('delegatedRepairFor', () => {
  const HOME = 'https://mail.google.com/mail/u/0/d/AOr0Kc1x9Qm/';

  it('sends a view that was redirected off its mailbox back to it', () => {
    expect(
      delegatedRepairFor({
        mailUrl: HOME,
        currentUrl: 'https://mail.google.com/mail/u/0/',
        sentHomeFor: null,
        homeUrl: HOME,
        attempts: 0,
      }),
    ).toBe('send-home');
  });

  it('sends a view sitting on a login page back to its mailbox', () => {
    expect(
      delegatedRepairFor({
        mailUrl: HOME,
        currentUrl: 'https://accounts.google.com/ServiceLogin?continue=x',
        sentHomeFor: null,
        homeUrl: HOME,
        attempts: 0,
      }),
    ).toBe('send-home');
  });

  // The rotated id: the view is exactly where it was put and still shows another mailbox, so
  // the url itself is the thing that is wrong and only the switcher knows the new one.
  it('re-reads the url for a view still sitting on it', () => {
    expect(
      delegatedRepairFor({
        mailUrl: HOME,
        currentUrl: `${HOME}#inbox`,
        sentHomeFor: null,
        homeUrl: HOME,
        attempts: 0,
      }),
    ).toBe('reread-url');
  });

  // Both faces at once: the url rotated while the view was also redirected. Going home is
  // tried first because it is free, and when the title still says the wrong mailbox the next
  // sample must fall through to the scrape rather than send it home for ever.
  it('re-reads the url once going home has been tried for it', () => {
    expect(
      delegatedRepairFor({
        mailUrl: HOME,
        currentUrl: 'https://mail.google.com/mail/u/0/',
        sentHomeFor: HOME,
        homeUrl: HOME,
        attempts: 1,
      }),
    ).toBe('reread-url');
  });

  // A url that was replaced since is a different one, so going home is worth trying again.
  it('sends home again after the url changed', () => {
    expect(
      delegatedRepairFor({
        mailUrl: HOME,
        currentUrl: 'https://mail.google.com/mail/u/0/',
        sentHomeFor: 'https://mail.google.com/mail/u/0/d/AOr0KcOLD/',
        homeUrl: HOME,
        attempts: 0,
      }),
    ).toBe('send-home');
  });

  // Where the view is cannot be read, so there is no drift to act on and the scrape is the
  // only honest answer left.
  it('re-reads the url when where the view sits is unknown', () => {
    expect(
      delegatedRepairFor({ mailUrl: HOME, currentUrl: null, sentHomeFor: null, homeUrl: HOME, attempts: 0 }),
    ).toBe(
      'reread-url',
    );
  });

  // The expired id with a fresh one already fetched in the background: the view is moved
  // straight to it, without asking the switcher again
  it('loads the stored url when the view was opened with an older one', () => {
    expect(
      delegatedRepairFor({
        mailUrl: HOME,
        currentUrl: 'https://mail.google.com/mail/u/0/',
        sentHomeFor: null,
        homeUrl: 'https://mail.google.com/mail/u/0/d/AOr0KcOLD/',
        attempts: 0,
      }),
    ).toBe('load-stored');
  });

  // A mailbox that cannot be opened however often it is retried must stop being reloaded,
  // or the view flickers between attempts for ever
  it('gives up once the repairs have run out', () => {
    expect(
      delegatedRepairFor({
        mailUrl: HOME,
        currentUrl: `${HOME}#inbox`,
        sentHomeFor: HOME,
        homeUrl: HOME,
        attempts: MAX_DELEGATED_REPAIRS,
      }),
    ).toBe('give-up');
  });

  it('keeps repairing while attempts are left', () => {
    expect(
      delegatedRepairFor({
        mailUrl: HOME,
        currentUrl: `${HOME}#inbox`,
        sentHomeFor: HOME,
        homeUrl: HOME,
        attempts: MAX_DELEGATED_REPAIRS - 1,
      }),
    ).toBe('reread-url');
  });
});

describe('mayRereadSwitcher', () => {
  it('reads at once when the switcher was never read for this mailbox', () => {
    expect(mayRereadSwitcher(null, 1_000)).toBe(true);
  });

  // A read that found nothing new is retried, but not on every sample
  it('waits the gap before reading again', () => {
    expect(mayRereadSwitcher(1_000, 1_000 + REREAD_GAP_MS - 1)).toBe(false);
    expect(mayRereadSwitcher(1_000, 1_000 + REREAD_GAP_MS)).toBe(true);
  });
});

describe('urlFingerprint', () => {
  const A = 'https://mail.google.com/mail/u/0/d/AJBOaaaa/';
  const B = 'https://mail.google.com/mail/u/0/d/AJBObbbb/';

  it('gives one url the same print every time', () => {
    expect(urlFingerprint(A)).toBe(urlFingerprint(A));
  });

  it('tells two ids apart', () => {
    expect(urlFingerprint(A)).not.toBe(urlFingerprint(B));
  });

  // The print goes into a log people send around, so the id itself must never appear in it
  it('never contains the id', () => {
    expect(urlFingerprint(A)).not.toContain('AJBO');
    expect(urlFingerprint(A)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('says none for a mailbox without a url', () => {
    expect(urlFingerprint(null)).toBe('none');
  });
});
