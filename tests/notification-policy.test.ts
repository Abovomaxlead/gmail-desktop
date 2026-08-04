import { describe, it, expect } from 'vitest';
import {
  notificationsAllowed,
  notificationSilent,
  notificationPersist,
  wantsCalendarView,
  inQuietHours,
  mergeNotificationsFromPanel,
} from '../electron/notification-policy';
import type { AccountRef } from '../renderer/lib/account-ref';
import { DEFAULT_PREFS, type NotificationPrefs, type Prefs } from '../electron/prefs-store';

// `notifications` wordt hier een laag diep samengevoegd in plaats van vervangen.
// Anders moet elke test die alleen `dnd` wil zetten ook de velden opschrijven die
// niets met deze test te maken hebben (wat er in een melding staat, of geluid aan
// staat) — en dan zegt een test over gedempt zijn ineens ook iets over die.
function prefs(
  overrides: Omit<Partial<Prefs>, 'notifications'> & { notifications?: Partial<NotificationPrefs> },
): Prefs {
  const base = structuredClone(DEFAULT_PREFS);
  return {
    ...base,
    ...overrides,
    notifications: { ...base.notifications, ...(overrides.notifications ?? {}) },
  };
}

// Hetzelfde, voor een los blok meldingsvoorkeuren: `mergeNotificationsFromPanel`
// krijgt de opgeslagen stand als eerste argument.
const mute = (o: Partial<NotificationPrefs>): NotificationPrefs => ({
  ...structuredClone(DEFAULT_PREFS.notifications),
  ...o,
});
const at = (h: number, m = 0) => new Date(2026, 0, 1, h, m);

describe('inQuietHours', () => {
  it('handles a midnight-crossing window', () => {
    expect(inQuietHours('22:00', '07:00', 23 * 60)).toBe(true); // 23:00
    expect(inQuietHours('22:00', '07:00', 6 * 60)).toBe(true); // 06:00
    expect(inQuietHours('22:00', '07:00', 12 * 60)).toBe(false); // 12:00
  });
  it('handles a same-day window', () => {
    expect(inQuietHours('09:00', '17:00', 10 * 60)).toBe(true);
    expect(inQuietHours('09:00', '17:00', 20 * 60)).toBe(false);
  });
  it('treats start==end as never in quiet hours', () => {
    expect(inQuietHours('09:00', '09:00', 9 * 60)).toBe(false);
  });
});

describe('notificationsAllowed', () => {
  it('allows by default', () => {
    expect(notificationsAllowed(prefs({}), 'a@x.com', at(12))).toBe(true);
  });
  it('blocks all when DND is on', () => {
    expect(notificationsAllowed(prefs({ notifications: { dnd: true, quietHours: { enabled: false, start: '18:00', end: '08:00' } } }), 'a@x.com', at(12))).toBe(false);
  });
  it('blocks during quiet hours', () => {
    expect(notificationsAllowed(prefs({ notifications: { dnd: false, quietHours: { enabled: true, start: '18:00', end: '08:00' } } }), 'a@x.com', at(23))).toBe(false);
  });
  it('blocks a per-account opt-out', () => {
    const p = prefs({ accounts: { 'a@x.com': { notify: false } } });
    expect(notificationsAllowed(p, 'a@x.com', at(12))).toBe(false);
  });
  it('allows an account with notify:true even if another is off', () => {
    const p = prefs({ accounts: { 'a@x.com': { notify: false }, 'b@x.com': { notify: true } } });
    expect(notificationsAllowed(p, 'b@x.com', at(12))).toBe(true);
  });

  it('blocks while a timed snooze (dndUntil) is still in the future', () => {
    const p = prefs({
      notifications: { dnd: false, dndUntil: at(12, 30).getTime(), quietHours: { enabled: false, start: '18:00', end: '08:00' } },
    });
    expect(notificationsAllowed(p, 'a@x.com', at(12))).toBe(false); // 12:00 < 12:30
  });

  it('allows again once dndUntil has passed', () => {
    const p = prefs({
      notifications: { dnd: false, dndUntil: at(11, 30).getTime(), quietHours: { enabled: false, start: '18:00', end: '08:00' } },
    });
    expect(notificationsAllowed(p, 'a@x.com', at(12))).toBe(true); // 12:00 > 11:30
  });

  it('a snooze gates the calendar surface too', () => {
    const p = prefs({
      notifications: { dnd: false, dndUntil: at(13).getTime(), quietHours: { enabled: false, start: '18:00', end: '08:00' } },
      accounts: { 'a@x.com': { calendarNotify: true } },
    });
    expect(notificationsAllowed(p, 'a@x.com', at(12), 'calendar')).toBe(false);
  });
});

describe('notificationsAllowed — surface', () => {
  const base = () => structuredClone(DEFAULT_PREFS);

  it("defaults to the mail surface", () => {
    const p = base();
    expect(notificationsAllowed(p, 'a@x.com', at(12))).toBe(true); // no 4th arg → mail
  });

  it('mail: allowed unless notify===false', () => {
    const p = base();
    expect(notificationsAllowed(p, 'a@x.com', at(12), 'mail')).toBe(true);
    p.accounts['a@x.com'] = { notify: false };
    expect(notificationsAllowed(p, 'a@x.com', at(12), 'mail')).toBe(false);
  });

  it('calendar: off by default, on only when calendarNotify===true', () => {
    const p = base();
    expect(notificationsAllowed(p, 'a@x.com', at(12), 'calendar')).toBe(false); // opt-in
    p.accounts['a@x.com'] = { calendarNotify: true };
    expect(notificationsAllowed(p, 'a@x.com', at(12), 'calendar')).toBe(true);
  });

  it('calendar toggle is independent of mail toggle', () => {
    const p = base();
    p.accounts['a@x.com'] = { notify: false, calendarNotify: true };
    expect(notificationsAllowed(p, 'a@x.com', at(12), 'mail')).toBe(false);
    expect(notificationsAllowed(p, 'a@x.com', at(12), 'calendar')).toBe(true);
  });

  it('never allows the Google app surfaces (v1: no notifications)', () => {
    const p = base();
    // Even a fully opted-in account gets no Drive/Chat/etc. notifications.
    p.accounts['a@x.com'] = { notify: true, calendarNotify: true };
    for (const surface of ['drive', 'docs', 'sheets', 'slides', 'keep', 'contacts', 'chat'] as const) {
      expect(notificationsAllowed(p, 'a@x.com', at(12), surface)).toBe(false);
    }
  });

  it('DND and quiet hours gate calendar too', () => {
    const dnd = base();
    dnd.notifications.dnd = true;
    dnd.accounts['a@x.com'] = { calendarNotify: true };
    expect(notificationsAllowed(dnd, 'a@x.com', at(12), 'calendar')).toBe(false);

    const qh = base();
    qh.notifications.quietHours = { enabled: true, start: '18:00', end: '08:00' };
    qh.accounts['a@x.com'] = { calendarNotify: true };
    expect(notificationsAllowed(qh, 'a@x.com', at(23), 'calendar')).toBe(false);
  });
});

// De bug die dit dekt: het paneel stuurt alleen {dnd, quietHours}, en
// `setNotifications` schrijft wat het krijgt wholesale weg. Zonder deze functie
// verdwijnt een lopende tray-snooze (`dndUntil`) zodra de stille uren wijzigen.
describe('mergeNotificationsFromPanel', () => {
  const quietHours = { enabled: false, start: '18:00', end: '08:00' };

  it('keeps a running snooze when only quiet hours change (dnd untouched)', () => {
    const current = mute({ dnd: false, dndUntil: 4_000_000_000_000, quietHours });
    const result = mergeNotificationsFromPanel(current, {
      dnd: false, // echoed back unchanged by the quiet-hours controls
      quietHours: { ...quietHours, enabled: true },
    });
    expect(result.dndUntil).toBe(4_000_000_000_000);
    expect(result.quietHours.enabled).toBe(true);
  });

  it('clears a running snooze when the DND switch is explicitly toggled off', () => {
    // Snooze started from the tray leaves dnd:false; the switch was never on.
    // Toggling it "off" again (still false -> false) must NOT be confused with
    // an actual flip — this case is covered by the "untouched" test above.
    // Here the switch genuinely changes: it was on, and the user turns it off,
    // which is the "un-mute me" case called out in the design discussion.
    const current = mute({ dnd: true, dndUntil: 4_000_000_000_000, quietHours });
    const result = mergeNotificationsFromPanel(current, { dnd: false, quietHours });
    expect(result.dnd).toBe(false);
    expect(result.dndUntil).toBeUndefined();
  });

  it('clears a running snooze when the DND switch is explicitly toggled on', () => {
    // Mirrors the tray's own `setSnooze(null)` branch: turning DND on
    // indefinitely supersedes any timed snooze, so it clears dndUntil too.
    const current = mute({ dnd: false, dndUntil: 4_000_000_000_000, quietHours });
    const result = mergeNotificationsFromPanel(current, { dnd: true, quietHours });
    expect(result.dnd).toBe(true);
    expect(result.dndUntil).toBeUndefined();
  });

  it('has nothing to preserve when no snooze is running', () => {
    const current = mute({ dnd: false, quietHours });
    const result = mergeNotificationsFromPanel(current, {
      dnd: false,
      quietHours: { ...quietHours, start: '20:00' },
    });
    expect(result.dndUntil).toBeUndefined();
  });
});

// De twee hoofdschakelaars uit Meldingen. Beide standaard aan, dus zonder dat de
// gebruiker iets doet beslist de keuze per account — precies zoals daarvoor.
describe('global masters', () => {
  it('silences every surface when the sound master is off', () => {
    const p = prefs({ notifications: { sound: false }, accounts: { 'a@x.com': { notifySound: true } } });
    expect(notificationSilent(p, 'a@x.com')).toBe(true);
    // Ook een agendaherinnering, die de keuze per account juist negeert: "geen
    // geluid" is een uitspraak over alle meldingen.
    expect(notificationSilent(p, 'a@x.com', 'calendar')).toBe(true);
  });

  it('leaves the per-account choice in charge while the sound master is on', () => {
    const p = prefs({ notifications: { sound: true }, accounts: { 'a@x.com': { notifySound: false } } });
    expect(notificationSilent(p, 'a@x.com')).toBe(true);
    const q = prefs({ notifications: { sound: true }, accounts: { 'a@x.com': { notifySound: true } } });
    expect(notificationSilent(q, 'a@x.com')).toBe(false);
  });

  it('blocks calendar reminders when the Google Apps master is off', () => {
    const p = prefs({
      notifications: { googleApps: false },
      accounts: { 'a@x.com': { calendarNotify: true } },
    });
    expect(notificationsAllowed(p, 'a@x.com', at(12), 'calendar')).toBe(false);
    // Post gaat door: de hoofdschakelaar gaat over de andere Google-apps.
    expect(notificationsAllowed(p, 'a@x.com', at(12), 'mail')).toBe(true);
  });

  it('still needs the per-account opt-in while the Google Apps master is on', () => {
    const p = prefs({ notifications: { googleApps: true }, accounts: { 'a@x.com': {} } });
    expect(notificationsAllowed(p, 'a@x.com', at(12), 'calendar')).toBe(false);
    const q = prefs({
      notifications: { googleApps: true },
      accounts: { 'a@x.com': { calendarNotify: true } },
    });
    expect(notificationsAllowed(q, 'a@x.com', at(12), 'calendar')).toBe(true);
  });
});

// Het paneel stuurt alleen `dnd` en `quietHours`; de vier velden over de inhoud van
// een melding en over geluid staan in hetzelfde blok en mogen daar niet door
// verdwijnen. Dit is dezelfde soort bug als die met `dndUntil`, een laag hoger.
describe('mergeNotificationsFromPanel keeps the content and sound fields', () => {
  it('leaves showSender, showSubject, sound and googleApps as they were', () => {
    const current = mute({
      dnd: false,
      showSender: false,
      showSubject: false,
      sound: false,
      googleApps: false,
    });
    const result = mergeNotificationsFromPanel(current, {
      dnd: false,
      quietHours: { enabled: true, start: '18:00', end: '08:00' },
    });
    expect(result.showSender).toBe(false);
    expect(result.showSubject).toBe(false);
    expect(result.sound).toBe(false);
    expect(result.googleApps).toBe(false);
    expect(result.quietHours.enabled).toBe(true);
  });
});

describe('notificationSilent', () => {
  it('is not silent by default (field absent)', () => {
    expect(notificationSilent(prefs({}), 'a@x.com')).toBe(false);
  });
  it('is silent when notifySound is false', () => {
    const p = prefs({ accounts: { 'a@x.com': { notifySound: false } } });
    expect(notificationSilent(p, 'a@x.com')).toBe(true);
  });
  it('is not silent when notifySound is true', () => {
    const p = prefs({ accounts: { 'a@x.com': { notifySound: true } } });
    expect(notificationSilent(p, 'a@x.com')).toBe(false);
  });
  it('is never silent for non-mail surfaces', () => {
    const p = prefs({ accounts: { 'a@x.com': { notifySound: false } } });
    expect(notificationSilent(p, 'a@x.com', 'calendar')).toBe(false);
  });
  it('is independent of DND (silent stays as configured)', () => {
    const p = prefs({
      notifications: { dnd: true, quietHours: { enabled: false, start: '18:00', end: '08:00' } },
      accounts: { 'a@x.com': { notifySound: false } },
    });
    expect(notificationSilent(p, 'a@x.com')).toBe(true);
  });
});

// A hidden calendar view exists only to fire reminders, so it follows the
// calendarNotify opt-in — but a delegated mailbox whose calendar URL was never
// captured has no calendar to load. Trusting the pref alone crashed main with
// loadURL(null) the moment such a delegate was restored at startup.
describe('wantsCalendarView', () => {
  const authuser: AccountRef = { kind: 'authuser', index: 0 };
  const delegateNoCal: AccountRef = {
    kind: 'delegated',
    email: 'd@x.com',
    mailUrl: 'https://m/',
    calendarUrl: null,
  };
  const delegateWithCal: AccountRef = { ...delegateNoCal, calendarUrl: 'https://c/' };

  it('is off when the account never opted in', () => {
    expect(wantsCalendarView(prefs({}), 'a@x.com', authuser)).toBe(false);
  });
  it('is on for an opted-in authuser account', () => {
    const p = prefs({ accounts: { 'a@x.com': { calendarNotify: true } } });
    expect(wantsCalendarView(p, 'a@x.com', authuser)).toBe(true);
  });
  it('is off for an opted-in delegate with no captured calendar url', () => {
    const p = prefs({ accounts: { 'd@x.com': { calendarNotify: true } } });
    expect(wantsCalendarView(p, 'd@x.com', delegateNoCal)).toBe(false);
  });
  it('is on for an opted-in delegate that does have a calendar', () => {
    const p = prefs({ accounts: { 'd@x.com': { calendarNotify: true } } });
    expect(wantsCalendarView(p, 'd@x.com', delegateWithCal)).toBe(true);
  });
});

describe('notificationsAllowed — push', () => {
  // Een gedekt account krijgt zijn meldingen van de API. Zou de webview ook nog
  // melden, dan kwam alles dubbel.
  it('mutes the webview for an account push covers', () => {
    const p = prefs({ accounts: { 'a@x.nl': { notify: true } } });
    expect(notificationsAllowed(p, 'a@x.nl', new Date(), 'mail', true)).toBe(false);
  });

  it('leaves the webview alone for an account push does not cover', () => {
    const p = prefs({ accounts: { 'a@x.nl': { notify: true } } });
    expect(notificationsAllowed(p, 'a@x.nl', new Date(), 'mail', false)).toBe(true);
  });

  it('defaults to not covered, so nothing changes for callers that do not pass it', () => {
    const p = prefs({ accounts: { 'a@x.nl': { notify: true } } });
    expect(notificationsAllowed(p, 'a@x.nl', new Date(), 'mail')).toBe(true);
  });

  // Dempen gaat over de webview, niet over de gebruiker: staat de melding uit,
  // dan blijft hij uit, ook als push hem zou kunnen sturen.
  it('does not turn a switched-off account back on', () => {
    const p = prefs({ accounts: { 'a@x.nl': { notify: false } } });
    expect(notificationsAllowed(p, 'a@x.nl', new Date(), 'mail', false)).toBe(false);
  });

  // De agenda meldt via zijn eigen view en heeft niets met de mail-push te maken.
  it('does not let mail coverage touch the calendar surface', () => {
    const p = prefs({ accounts: { 'a@x.nl': { calendarNotify: true } } });
    expect(notificationsAllowed(p, 'a@x.nl', new Date(), 'calendar', true)).toBe(true);
  });
});

describe('notificationPersist', () => {
  it('does not persist by default (field absent)', () => {
    expect(notificationPersist(prefs({}), 'a@x.com')).toBe(false);
  });
  it('persists when notifyPersist is true', () => {
    const p = prefs({ accounts: { 'a@x.com': { notifyPersist: true } } });
    expect(notificationPersist(p, 'a@x.com')).toBe(true);
  });
  it('does not persist when notifyPersist is false', () => {
    const p = prefs({ accounts: { 'a@x.com': { notifyPersist: false } } });
    expect(notificationPersist(p, 'a@x.com')).toBe(false);
  });
  it('is per account', () => {
    const p = prefs({ accounts: { 'a@x.com': { notifyPersist: true }, 'b@x.com': {} } });
    expect(notificationPersist(p, 'a@x.com')).toBe(true);
    expect(notificationPersist(p, 'b@x.com')).toBe(false);
  });
  it('is unknown-account safe', () => {
    expect(notificationPersist(prefs({}), 'nobody@x.com')).toBe(false);
  });
});
