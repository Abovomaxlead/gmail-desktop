import { describe, it, expect } from 'vitest';
import { SETTINGS_SECTIONS, attentionFrom, needsAttention } from '../renderer/app/settings/nav';

const quiet = { dnd: false, updateReady: false };

describe('SETTINGS_SECTIONS', () => {
  // Algemeen eerst omdat je daar het vaakst komt; Over laatst omdat je daar
  // alleen komt als je iets zoekt.
  it('lists the four sections in display order', () => {
    expect(SETTINGS_SECTIONS).toEqual(['general', 'notifications', 'accounts', 'about']);
  });
});

describe('needsAttention', () => {
  it('marks nothing when everything is as expected', () => {
    for (const s of SETTINGS_SECTIONS) expect(needsAttention(s, quiet)).toBe(false);
  });

  // Dit is het hele punt van de puntjes: je wil zien dat je meldingen uit staan
  // zonder de sectie te openen, want dat is precies wat je zou vergeten.
  it('marks notifications while do-not-disturb is on', () => {
    expect(needsAttention('notifications', { ...quiet, dnd: true })).toBe(true);
  });

  it('marks notifications while a timed snooze is still running', () => {
    expect(needsAttention('notifications', { ...quiet, dndUntil: 1 })).toBe(true);
  });

  it('marks about when an update is waiting to be installed', () => {
    expect(needsAttention('about', { ...quiet, updateReady: true })).toBe(true);
  });

  it('does not mark a section for another section\'s reason', () => {
    expect(needsAttention('general', { dnd: true, updateReady: true })).toBe(false);
    expect(needsAttention('accounts', { dnd: true, updateReady: true })).toBe(false);
    expect(needsAttention('notifications', { ...quiet, updateReady: true })).toBe(false);
    expect(needsAttention('about', { ...quiet, dnd: true })).toBe(false);
  });
});

// De weg van de voorkeuren naar het puntje. De test hierboven op `dndUntil` was
// dode code: het paneel gaf dat veld niet door, dus een demping vanuit het
// tray-menu — het waarschijnlijkste van de twee gevallen — gaf nooit een puntje.
// Deze groep houdt die weg vast, en niet alleen het eindstuk.
describe('attentionFrom', () => {
  it('has nothing to report before the preferences have arrived', () => {
    const a = attentionFrom(undefined, undefined);
    expect(a).toEqual({ dnd: false, dndUntil: undefined, updateReady: false });
    for (const s of SETTINGS_SECTIONS) expect(needsAttention(s, a)).toBe(false);
  });

  it('marks notifications for the switch in the panel', () => {
    const a = attentionFrom({ dnd: true }, 'idle');
    expect(needsAttention('notifications', a)).toBe(true);
  });

  // Het geval waarvoor het puntje bestaat: je zet in het tray-menu een uur stil,
  // opent daarna de instellingen, en ziet dat je meldingen uit staan.
  it('marks notifications for a timed snooze set from the tray', () => {
    const a = attentionFrom({ dnd: false, dndUntil: 4_000_000_000_000 }, 'idle');
    expect(a.dndUntil).toBe(4_000_000_000_000);
    expect(needsAttention('notifications', a)).toBe(true);
  });

  // Het hoofdproces wist een verlopen demping zelf (`refreshNotifyAllowed`) en
  // stuurt de voorkeuren dan opnieuw. Zolang het veld weg is, is het puntje weg.
  it('stops marking notifications once the main process has cleared the snooze', () => {
    const a = attentionFrom({ dnd: false, dndUntil: undefined }, 'idle');
    expect(needsAttention('notifications', a)).toBe(false);
  });

  it('marks about while an update is waiting, in both of its states', () => {
    for (const state of ['available', 'downloaded'] as const) {
      const a = attentionFrom({ dnd: false }, state);
      expect(needsAttention('about', a)).toBe(true);
    }
  });

  it('does not mark about while it is only looking or downloading', () => {
    for (const state of ['idle', 'checking', 'downloading', 'not-available', 'error', 'dev'] as const) {
      const a = attentionFrom({ dnd: false }, state);
      expect(needsAttention('about', a)).toBe(false);
    }
  });
});
