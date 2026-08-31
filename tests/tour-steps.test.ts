// The tour's script: its order, what gets dropped when the window cannot show it, and that
// every step names a string that exists. A step pointing at a key nobody wrote would draw
// a card with a blank title, which no type check catches on its own.

import { describe, it, expect } from 'vitest';
import { planTour, anchorSelector } from '../renderer/app/tour-steps';
import { STRINGS_NORMAL } from '../renderer/app/strings';

describe('planTour', () => {
  it('runs all eight steps when the mailbox has pinned apps', () => {
    expect(planTour({ hasPinned: true }).map((s) => s.id)).toEqual([
      'welcome',
      'tabs',
      'tab-menu',
      'add',
      'pinned',
      'maildrop',
      'feedback',
      'gear',
    ]);
  });

  it('drops the pinned step when nothing is pinned', () => {
    expect(planTour({ hasPinned: false }).map((s) => s.id)).toEqual([
      'welcome',
      'tabs',
      'tab-menu',
      'add',
      'maildrop',
      'feedback',
      'gear',
    ]);
  });

  it('gives every step a unique id', () => {
    const ids = planTour({ hasPinned: true }).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('centres the welcome and mail-drop steps and anchors the rest', () => {
    const steps = planTour({ hasPinned: true });
    expect(steps.filter((s) => s.anchor === null).map((s) => s.id)).toEqual([
      'welcome',
      'maildrop',
    ]);
    expect(steps.filter((s) => s.anchor !== null).length).toBe(6);
  });

  it('names a string that exists for every title and body', () => {
    for (const step of planTour({ hasPinned: true })) {
      expect(typeof STRINGS_NORMAL[step.titleKey], `${step.id} title`).toBe('string');
      expect(typeof STRINGS_NORMAL[step.bodyKey], `${step.id} body`).toBe('string');
    }
  });

  // The script is a module-level constant; handing it out by reference would let one caller
  // rewrite the tour for every later one.
  it('hands back copies rather than the script itself', () => {
    planTour({ hasPinned: true })[0].id = 'mutated';
    expect(planTour({ hasPinned: true })[0].id).toBe('welcome');
  });
});

describe('anchorSelector', () => {
  it('builds a data-tour selector', () => {
    expect(anchorSelector('gear')).toBe('[data-tour="gear"]');
  });

  it('has no selector for a centred step', () => {
    expect(anchorSelector(null)).toBeNull();
  });
});
