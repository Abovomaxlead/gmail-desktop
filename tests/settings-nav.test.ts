import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SECTION,
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  attentionFrom,
  needsAttention,
} from '../renderer/app/settings/nav';

const quiet = { dnd: false, updateReady: false };

describe('SETTINGS_GROUPS', () => {
  // De drie groepen zijn een uitspraak over wat waar hoort: een logboek, de
  // voorkeuren, en wat er over de app te lezen valt. De haarlijnen in de kolom
  // volgen hieruit, dus als deze indeling schuift schuift het ontwerp mee.
  it('splits the column into a log, the preferences, and what there is to read', () => {
    expect(SETTINGS_GROUPS.map((g) => [...g])).toEqual([
      ['download-history'],
      [
        'general',
        'accounts',
        'appearance',
        'downloads',
        'gmail',
        'google-apps',
        'languages',
        'notifications',
        'phishing-protection',
        'updates',
        'verification-codes',
        'advanced',
      ],
      ['whats-new', 'about'],
    ]);
  });

  // In de middelste groep staat Algemeen vooraan (daar kom je het vaakst) en
  // Geavanceerd achteraan; wat ertussen zit staat op alfabet. Dat is de regel, en
  // hij is hier opgeschreven omdat er anders bij elke nieuwe sectie geraden wordt
  // waar hij hoort.
  it('keeps the middle group alphabetical between General and Advanced', () => {
    const middle = [...SETTINGS_GROUPS[1]];
    expect(middle[0]).toBe('general');
    expect(middle[middle.length - 1]).toBe('advanced');
    const between = middle.slice(1, -1);
    expect(between).toEqual([...between].sort());
  });

  it('has no section in two groups at once', () => {
    expect(new Set(SETTINGS_SECTIONS).size).toBe(SETTINGS_SECTIONS.length);
  });
});

describe('SETTINGS_SECTIONS', () => {
  // De platte lijst is de rij waarin de pijltjestoetsen lopen, en hij wordt uit de
  // groepen afgeleid. Deze test houdt vast dát hij dat is: een tweede, met de hand
  // bijgehouden lijst zou stil uit elkaar kunnen lopen met de kolom in beeld.
  it('is the groups in order, flattened', () => {
    expect(SETTINGS_SECTIONS).toEqual(SETTINGS_GROUPS.flat());
  });

  it('opens on the section you visit most', () => {
    expect(DEFAULT_SECTION).toBe('general');
    expect(SETTINGS_SECTIONS).toContain(DEFAULT_SECTION);
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

  // Bij Bijwerken en niet bij Over: daar staat de knop die de update uitvoert.
  it('marks updates when an update is waiting to be installed', () => {
    expect(needsAttention('updates', { ...quiet, updateReady: true })).toBe(true);
    expect(needsAttention('about', { ...quiet, updateReady: true })).toBe(false);
  });

  it('does not mark a section for another section\'s reason', () => {
    const both = { dnd: true, updateReady: true };
    for (const s of SETTINGS_SECTIONS) {
      if (s === 'notifications' || s === 'updates') continue;
      expect(needsAttention(s, both)).toBe(false);
    }
    expect(needsAttention('notifications', { ...quiet, updateReady: true })).toBe(false);
    expect(needsAttention('updates', { ...quiet, dnd: true })).toBe(false);
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

  it('marks updates while an update is waiting, in both of its states', () => {
    for (const state of ['available', 'downloaded'] as const) {
      const a = attentionFrom({ dnd: false }, state);
      expect(needsAttention('updates', a)).toBe(true);
    }
  });

  it('does not mark updates while it is only looking or downloading', () => {
    for (const state of ['idle', 'checking', 'downloading', 'not-available', 'error', 'dev'] as const) {
      const a = attentionFrom({ dnd: false }, state);
      expect(needsAttention('updates', a)).toBe(false);
    }
  });
});
