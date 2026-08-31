// The tour's script: its order, what gets dropped when the window cannot show it, and that
// every step names a string that exists. A step pointing at a key nobody wrote would draw
// a card with a blank title, which no type check catches on its own.

import { describe, it, expect } from 'vitest';
import { planTour, anchorSelector, demoLabels } from '../renderer/app/tour-steps';
import { STRINGS_NORMAL, STRINGS_NL, STRINGS_RENE } from '../renderer/app/strings';

describe('planTour', () => {
  it('runs all nine steps, in order', () => {
    expect(planTour().map((s) => s.id)).toEqual([
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

  // The pinned step used to be dropped when the bar had no pinned Google app, which left the
  // one feature nobody finds unmentioned to exactly the users who had not found it. The bar
  // borrows an example button for the length of the tour instead, so nothing is conditional
  // any more and this is what stops the drop from creeping back in.
  it('drops nothing, whatever the window happens to show', () => {
    expect(planTour().length).toBe(9);
    expect(planTour().some((s) => s.id === 'pinned')).toBe(true);
  });

  it('gives every step a unique id', () => {
    const ids = planTour().map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('centres only the welcome step', () => {
    const steps = planTour();
    expect(steps.filter((s) => s.anchor === null).map((s) => s.id)).toEqual(['welcome']);
  });

  // Saving mail out has to come before filing it back in: the strip is what produces the
  // files the drop panel then asks about.
  it('shows the strip before the drop panel', () => {
    const ids = planTour().map((s) => s.id);
    expect(ids.indexOf('strip')).toBeLessThan(ids.indexOf('maildrop'));
  });

  it('gives a stage only to the two steps that draw their own anchor', () => {
    const staged = planTour().filter((s) => s.stage !== null);
    expect(staged.map((s) => [s.id, s.stage])).toEqual([
      ['strip', 'strip'],
      ['maildrop', 'label-panel'],
    ]);
  });

  // A staged step is anchored to something the tour renders itself, so the two have to agree
  // or the card would point at a stage that is not on screen.
  it('anchors every staged step to the stage and nothing else to it', () => {
    for (const step of planTour()) {
      expect(step.anchor === 'stage', `${step.id} anchor`).toBe(step.stage !== null);
    }
  });

  // The OS menu is the one thing a stage cannot imitate, so exactly one step pops it, and it
  // is the step that talks about right-clicking.
  it('pops the OS tab menu from the tab-menu step only', () => {
    const popping = planTour().filter((s) => s.opensTabMenu);
    expect(popping.map((s) => s.id)).toEqual(['tab-menu']);
  });

  // The menu opens under the active tab, towards the left of the strip. A card on that same
  // side lands underneath it and the text cannot be read, so the step that pops the menu has
  // to put its card at the other end. Tidying this back to match its neighbours is the
  // regression.
  it('keeps the card clear of the menu it pops', () => {
    const step = planTour().find((s) => s.opensTabMenu);
    expect(step?.on).toBe('bottom-end');
  });

  // A centred card has no anchor to be nudged off, so an offset there is a setting that reads
  // as if it does something and does not.
  it('nudges no card that has nothing to be nudged off', () => {
    for (const step of planTour()) {
      if (step.offset) expect(step.anchor, `${step.id} offset`).not.toBeNull();
    }
  });

  it('names a string that exists for every title and body', () => {
    for (const step of planTour()) {
      expect(typeof STRINGS_NORMAL[step.titleKey], `${step.id} title`).toBe('string');
      expect(typeof STRINGS_NORMAL[step.bodyKey], `${step.id} body`).toBe('string');
    }
  });

  // The script is a module-level constant; handing it out by reference would let one caller
  // rewrite the tour for every later one.
  it('hands back copies rather than the script itself', () => {
    planTour()[0].id = 'mutated';
    expect(planTour()[0].id).toBe('welcome');
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
