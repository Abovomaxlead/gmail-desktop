import { describe, it, expect } from 'vitest';
import { mailboxTitleLoaded, parseUnreadCount } from '../electron/unread-parser';

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
    // De vorm zonder adres is wat Gmail tijdens het opstarten kort laat staan.
    expect(mailboxTitleLoaded('Inbox - Gmail')).toBe(false);
  });
  it('returns false for null/undefined/empty', () => {
    expect(mailboxTitleLoaded(null)).toBe(false);
    expect(mailboxTitleLoaded(undefined)).toBe(false);
    expect(mailboxTitleLoaded('')).toBe(false);
  });
});
