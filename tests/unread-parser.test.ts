// Reading the unread count out of the Gmail page title.

import { describe, it, expect } from 'vitest';
import {
  mailboxTitleLoaded,
  parseUnreadCount,
  showsInboxList,
} from '../electron/unread/unread-parser';

describe('parseUnreadCount', () => {
  it('reads the count from a Gmail inbox title', () => {
    expect(parseUnreadCount('Inbox (12) - user@gmail.com - Gmail')).toBe(12);
  });
  it('returns 0 when there is no count', () => {
    expect(parseUnreadCount('Inbox - user@gmail.com - Gmail')).toBe(0);
  });
  it('returns 0 for null/undefined/empty', () => {
    expect(parseUnreadCount(null)).toBe(0);
    expect(parseUnreadCount(undefined)).toBe(0);
    expect(parseUnreadCount('')).toBe(0);
  });
  it('takes the first parenthesised number only', () => {
    expect(parseUnreadCount('Inbox (3) - (spam) - Gmail')).toBe(3);
  });

  it('reads a grouped thousands count in any locale', () => {
    expect(parseUnreadCount('Inbox (1.324) - user@gmail.com - Gmail')).toBe(1324);
    expect(parseUnreadCount('Inbox (1,324) - user@gmail.com - Gmail')).toBe(1324);
    expect(parseUnreadCount('Postvak IN (12.345) - user@gmail.com - Gmail')).toBe(12345);
    expect(parseUnreadCount('Inbox (1 324) - user@gmail.com - Gmail')).toBe(1324);
    expect(parseUnreadCount('Inbox (1 324) - user@gmail.com - Gmail')).toBe(1324);
  });

  it('still reads an ungrouped count of any size', () => {
    expect(parseUnreadCount('Inbox (999) - user@gmail.com - Gmail')).toBe(999);
    expect(parseUnreadCount('Inbox (1324) - user@gmail.com - Gmail')).toBe(1324);
  });

  it('does not read a separator that groups no thousands', () => {
    expect(parseUnreadCount('Inbox (1.5) - user@gmail.com - Gmail')).toBe(0);
  });
});

describe('mailboxTitleLoaded', () => {
  it('recognises a loaded mailbox, with and without a count', () => {
    expect(mailboxTitleLoaded('Inbox (12) - user@gmail.com - Gmail')).toBe(true);
    expect(mailboxTitleLoaded('Inbox - user@gmail.com - Gmail')).toBe(true);
  });
  it('recognises a loaded mailbox in any locale (folder name is translated)', () => {
    expect(mailboxTitleLoaded('Postvak IN (3) - user@example.nl - Gmail')).toBe(true);
    expect(mailboxTitleLoaded('Boîte de réception - user@example.fr - Gmail')).toBe(true);
  });
  it('rejects the bare title Gmail shows before the mailbox is up', () => {
    expect(mailboxTitleLoaded('Gmail')).toBe(false);
    expect(mailboxTitleLoaded('Loading...')).toBe(false);
  });
  it('rejects a sign-in/chooser page', () => {
    expect(mailboxTitleLoaded('Sign in - Google Accounts')).toBe(false);
    expect(mailboxTitleLoaded('Choose an account')).toBe(false);
  });
  it('rejects a Gmail-suffixed title without an address', () => {
    expect(mailboxTitleLoaded('Inbox - Gmail')).toBe(false);
  });
  it('returns false for null/undefined/empty', () => {
    expect(mailboxTitleLoaded(null)).toBe(false);
    expect(mailboxTitleLoaded(undefined)).toBe(false);
    expect(mailboxTitleLoaded('')).toBe(false);
  });
});

// The count in the title is the count of the view on screen, so the badge may only take it
// from the one view whose count it is supposed to show.
describe('showsInboxList', () => {
  it('recognises the inbox, including the hash Gmail starts with', () => {
    expect(showsInboxList('')).toBe(true);
    expect(showsInboxList('#inbox')).toBe(true);
    expect(showsInboxList('#')).toBe(true);
  });
  it('recognises a later page of the inbox, which counts the same mailbox', () => {
    expect(showsInboxList('#inbox/p2')).toBe(true);
    expect(showsInboxList('#inbox/p13')).toBe(true);
  });
  it('rejects a label, whose title carries that label’s count', () => {
    expect(showsInboxList('#label/Facturen')).toBe(false);
    expect(showsInboxList('#label/Klanten/Acme')).toBe(false);
  });
  it('rejects Gmail’s other views', () => {
    expect(showsInboxList('#sent')).toBe(false);
    expect(showsInboxList('#all')).toBe(false);
    expect(showsInboxList('#spam')).toBe(false);
    expect(showsInboxList('#search/factuur')).toBe(false);
    expect(showsInboxList('#imp')).toBe(false);
  });
  it('rejects an open conversation, whose title is the subject and carries no count', () => {
    expect(showsInboxList('#inbox/FMfcgzQhVrDqdSFCTfmJlfHgxhKCQwXv')).toBe(false);
    expect(showsInboxList('#inbox/19ff4d23f66d4d3c')).toBe(false);
  });
  it('is case-insensitive, since the hash is written by hand in places', () => {
    expect(showsInboxList('#INBOX')).toBe(true);
  });
});
