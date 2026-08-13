// Recognising the mail a Gmail notification was about, from the text it drew.

import { describe, it, expect } from 'vitest';
import { pickNotifiedMessage, subjectMatches, titleShowsSubject } from '../electron/notify/notify-match';
import type { MessageMeta } from '../electron/gmail/gmail-api';

const meta = (over: Partial<MessageMeta> = {}): MessageMeta => ({
  id: 'm1',
  threadId: 't1',
  from: 'Anna Bos <anna@example.com>',
  subject: 'Offerte week 33',
  internalDate: 1000,
  ...over,
});

describe('subjectMatches', () => {
  it('matches the subject as it stands', () => {
    expect(subjectMatches('Offerte week 33', 'Offerte week 33')).toBe(true);
  });

  it('does not match a different subject', () => {
    expect(subjectMatches('Offerte week 34', 'Offerte week 33')).toBe(false);
  });

  it('matches a subject Gmail cut short, by either kind of ellipsis', () => {
    const real = 'Offerte week 33 voor de nieuwe vestiging in Utrecht';
    expect(subjectMatches(real, 'Offerte week 33 voor de nieuwe…')).toBe(true);
    expect(subjectMatches(real, 'Offerte week 33 voor de nieuwe...')).toBe(true);
  });

  it('does not match a longer subject that was never cut', () => {
    expect(subjectMatches('Offerte week 33 voor Utrecht', 'Offerte week 33')).toBe(false);
  });

  it('folds the whitespace, because a wrapped subject arrives on one line', () => {
    expect(subjectMatches('Offerte\n  week 33', 'Offerte week 33')).toBe(true);
  });

  it('pairs a subjectless notification with subjectless mail and nothing else', () => {
    expect(subjectMatches('', '')).toBe(true);
    expect(subjectMatches('Offerte week 33', '')).toBe(false);
  });

  it('refuses a bare ellipsis rather than matching everything', () => {
    expect(subjectMatches('Offerte week 33', '…')).toBe(false);
  });
});

describe('titleShowsSubject', () => {
  const title = (subject: string) => `${subject} - luca@example.com - Gmail`;

  it('recognises the conversation Gmail says it is showing', () => {
    expect(titleShowsSubject(title('Nieuwe offerte'), 'Nieuwe offerte')).toBe(true);
  });

  it('accepts a title that is the subject and nothing else', () => {
    expect(titleShowsSubject('Nieuwe offerte', 'Nieuwe offerte')).toBe(true);
  });

  it('refuses a longer subject that merely starts the same', () => {
    expect(titleShowsSubject(title('Kennissessies september'), 'Kennissessies')).toBe(false);
  });

  it('refuses the conversation that was open before', () => {
    expect(titleShowsSubject(title('Kennissessies september'), 'Nieuwe offerte')).toBe(false);
  });

  it('refuses the inbox itself, where no conversation is open at all', () => {
    expect(titleShowsSubject('Postvak IN (3) - luca@example.com - Gmail', 'Nieuwe offerte')).toBe(
      false,
    );
  });

  it('matches a reply, whose Re: the title does not carry', () => {
    expect(titleShowsSubject(title('Nieuwe offerte'), 'Re: Nieuwe offerte')).toBe(true);
    expect(titleShowsSubject(title('Nieuwe offerte'), 'RE: Re: Nieuwe offerte')).toBe(true);
    expect(titleShowsSubject(title('Nieuwe offerte'), 'Fwd: Nieuwe offerte')).toBe(true);
    expect(titleShowsSubject(title('Nieuwe offerte'), 'Antw: Nieuwe offerte')).toBe(true);
  });

  it('keeps a subject that only looks like a prefix out of it', () => {
    expect(titleShowsSubject(title('Rembrandt'), 'Rembrandt')).toBe(true);
  });

  it('matches a subject Gmail cut short on what is left of it', () => {
    expect(
      titleShowsSubject(title('Offerte voor de nieuwe vestiging'), 'Offerte voor de nieuwe…'),
    ).toBe(true);
  });

  it('says no when there is no title yet, or nothing to compare it to', () => {
    expect(titleShowsSubject('', 'Nieuwe offerte')).toBe(false);
    expect(titleShowsSubject(title('Nieuwe offerte'), '')).toBe(false);
  });
});

describe('pickNotifiedMessage', () => {
  const notified = { sender: 'Anna Bos', subject: 'Offerte week 33' };

  it('returns the one message whose subject fits', () => {
    const wanted = meta({ id: 'm2', threadId: 't2' });
    const got = pickNotifiedMessage([meta({ subject: 'Iets anders' }), wanted], notified);
    expect(got?.threadId).toBe('t2');
  });

  it('returns null when the mail is not among the ones fetched', () => {
    expect(pickNotifiedMessage([meta({ subject: 'Iets anders' })], notified)).toBeNull();
  });

  it('returns null when there is nothing to compare against', () => {
    expect(pickNotifiedMessage([], notified)).toBeNull();
  });

  it('lets the sender settle two mails with the same subject', () => {
    const mine = meta({ id: 'm2', threadId: 't2', from: 'Anna Bos <anna@example.com>' });
    const other = meta({
      id: 'm3',
      threadId: 't3',
      from: 'Bram de Vries <bram@example.com>',
      internalDate: 9000,
    });
    expect(pickNotifiedMessage([other, mine], notified)?.threadId).toBe('t2');
  });

  it('takes the newest when the sender settles nothing either', () => {
    const older = meta({ id: 'm2', threadId: 't2', internalDate: 1000 });
    const newer = meta({ id: 'm3', threadId: 't3', internalDate: 2000 });
    expect(pickNotifiedMessage([older, newer], notified)?.threadId).toBe('t3');
    expect(pickNotifiedMessage([newer, older], notified)?.threadId).toBe('t3');
  });

  it('falls back to the newest match when no sender matches at all', () => {
    const a = meta({ id: 'm2', threadId: 't2', from: 'X <x@example.com>', internalDate: 1000 });
    const b = meta({ id: 'm3', threadId: 't3', from: 'Y <y@example.com>', internalDate: 2000 });
    expect(pickNotifiedMessage([a, b], notified)?.threadId).toBe('t3');
  });

  it('compares the display name, not the address Gmail never shows', () => {
    const wanted = meta({ id: 'm2', threadId: 't2', from: '"Bos, Anna" <anna@example.com>' });
    const other = meta({ id: 'm3', threadId: 't3', internalDate: 9000, from: 'anna@example.com' });
    const got = pickNotifiedMessage([wanted, other], { sender: 'Bos, Anna', subject: 'Offerte week 33' });
    expect(got?.threadId).toBe('t2');
  });
});
