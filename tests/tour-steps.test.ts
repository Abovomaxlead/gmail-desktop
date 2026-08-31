// The tour's script: its order, what gets dropped when the window cannot show it, and that
// every step names a string that exists. A step pointing at a key nobody wrote would draw
// a card with a blank title, which no type check catches on its own.

import { describe, it, expect } from 'vitest';
import { planTour, anchorSelector, demoLabels } from '../renderer/app/tour-steps';
import { STRINGS_NORMAL, STRINGS_NL, STRINGS_RENE } from '../renderer/app/strings';

describe('planTour', () => {
  it('runs all nine steps when the mailbox has pinned apps', () => {
    expect(planTour({ hasPinned: true }).map((s) => s.id)).toEqual([
      'welcome',
      'tabs',
      'tab-menu',
      'add',
      'pinned',
      'strip',
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
      'strip',
      'maildrop',
      'feedback',
      'gear',
    ]);
  });

  it('gives every step a unique id', () => {
    const ids = planTour({ hasPinned: true }).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('centres only the welcome step', () => {
    const steps = planTour({ hasPinned: true });
    expect(steps.filter((s) => s.anchor === null).map((s) => s.id)).toEqual(['welcome']);
  });

  // Saving mail out has to come before filing it back in: the strip is what produces the
  // files the drop panel then asks about.
  it('shows the strip before the drop panel', () => {
    const ids = planTour({ hasPinned: true }).map((s) => s.id);
    expect(ids.indexOf('strip')).toBeLessThan(ids.indexOf('maildrop'));
  });

  it('gives a stage only to the two steps that draw their own anchor', () => {
    const staged = planTour({ hasPinned: true }).filter((s) => s.stage !== null);
    expect(staged.map((s) => [s.id, s.stage])).toEqual([
      ['strip', 'strip'],
      ['maildrop', 'label-panel'],
    ]);
  });

  // A staged step is anchored to something the tour renders itself, so the two have to agree
  // or the card would point at a stage that is not on screen.
  it('anchors every staged step to the stage and nothing else to it', () => {
    for (const step of planTour({ hasPinned: true })) {
      expect(step.anchor === 'stage', `${step.id} anchor`).toBe(step.stage !== null);
    }
  });

  // The OS menu is the one thing a stage cannot imitate, so exactly one step pops it, and it
  // is the step that talks about right-clicking.
  it('pops the OS tab menu from the tab-menu step only', () => {
    const popping = planTour({ hasPinned: true }).filter((s) => s.opensTabMenu);
    expect(popping.map((s) => s.id)).toEqual(['tab-menu']);
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

  it('builds one for the stage the tour draws itself', () => {
    expect(anchorSelector('stage')).toBe('[data-tour="stage"]');
  });

  it('has no selector for a centred step', () => {
    expect(anchorSelector(null)).toBeNull();
  });
});

describe('demoLabels', () => {
  it('turns the comma-separated names into rows', () => {
    expect(demoLabels('Clients,Invoices')).toEqual([
      { id: 'tour-demo-label-0', name: 'Clients' },
      { id: 'tour-demo-label-1', name: 'Invoices' },
    ]);
  });

  it('trims the names and drops the empties', () => {
    expect(demoLabels(' Klanten , , Facturen ,').map((l) => l.name)).toEqual([
      'Klanten',
      'Facturen',
    ]);
  });

  it('gives every row an id no Gmail label can collide with', () => {
    for (const row of demoLabels('a,b,c')) expect(row.id.startsWith('tour-demo-label-')).toBe(true);
  });

  // An empty list would draw an empty panel, which is worse than no panel at all, so each
  // set has to carry names.
  it('yields rows for all three string sets', () => {
    for (const [set, name] of [
      [STRINGS_NORMAL, 'en'],
      [STRINGS_NL, 'nl'],
      [STRINGS_RENE, 'rene'],
    ] as const) {
      expect(demoLabels(set.tourDemoLabels).length, name).toBeGreaterThan(2);
    }
  });
});
