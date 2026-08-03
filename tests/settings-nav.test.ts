import { describe, it, expect } from 'vitest';
import { SETTINGS_SECTIONS, needsAttention } from '../renderer/app/settings/nav';

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
