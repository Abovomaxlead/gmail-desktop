import { describe, it, expect } from 'vitest';
import { parseUnreadCount } from '../electron/unread-parser';

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

  // Gmail schrijft de teller in de taal van de gebruiker, en vanaf duizend zet
  // die er een scheidingsteken in: "(1.324)" in het Nederlands, "(1,324)" in het
  // Engels. Werd daar niet op gelezen, dan viel elk postvak met duizend of meer
  // ongelezen berichten terug op 0 — precies de accounts waar de teller ertoe doet.
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

  // Een scheidingsteken dat geen groep van drie afsluit is geen duizendtal. Zo'n
  // titel maakt Gmail niet, en er stilzwijgend een getal van bakken zou een
  // verzonnen teller op de badge zetten.
  it('does not read a separator that groups no thousands', () => {
    expect(parseUnreadCount('Inbox (1.5) - user@gmail.com - Gmail')).toBe(0);
  });
});
