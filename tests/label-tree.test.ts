// Recreating a dragged label's nesting in another mailbox: which labels belong to the tree,
// what they are called there, and which of them have to be made.

import { describe, it, expect } from 'vitest';
import {
  labelTreeMembers,
  destinationName,
  planLabelTree,
  resolveMessageLabels,
} from '../electron/mail/label-tree';

describe('labelTreeMembers', () => {
  const all = ['Klanten', 'Klanten/Acme', 'Klanten/Acme/2025', 'Klantenservice', 'Archief'];

  it('takes the label itself and everything under it', () => {
    expect(labelTreeMembers(all, 'Klanten')).toEqual([
      'Klanten',
      'Klanten/Acme',
      'Klanten/Acme/2025',
    ]);
  });

  it('does not take a label that merely starts with the same letters', () => {
    expect(labelTreeMembers(all, 'Klanten')).not.toContain('Klantenservice');
  });

  it('starts at a sublabel when a sublabel was dragged', () => {
    expect(labelTreeMembers(all, 'Klanten/Acme')).toEqual(['Klanten/Acme', 'Klanten/Acme/2025']);
  });

  it('returns parents before their children', () => {
    const shuffled = ['Klanten/Acme/2025', 'Klanten', 'Klanten/Acme'];
    expect(labelTreeMembers(shuffled, 'Klanten')).toEqual([
      'Klanten',
      'Klanten/Acme',
      'Klanten/Acme/2025',
    ]);
  });

  it('is empty when the dragged label is not in the list', () => {
    expect(labelTreeMembers(all, 'Weg')).toEqual([]);
  });
});

describe('destinationName', () => {
  it('keeps the name when nothing is chosen to put it under', () => {
    expect(destinationName('Klanten', 'Klanten', null)).toBe('Klanten');
    expect(destinationName('Klanten', 'Klanten/Acme', null)).toBe('Klanten/Acme');
  });

  it('puts the tree under the chosen label', () => {
    expect(destinationName('Klanten', 'Klanten/Acme/2025', 'Archief')).toBe(
      'Archief/Klanten/Acme/2025',
    );
  });

  it('takes only the leaf name when a sublabel was dragged', () => {
    expect(destinationName('Klanten/Acme', 'Klanten/Acme', 'Archief')).toBe('Archief/Acme');
    expect(destinationName('Klanten/Acme', 'Klanten/Acme/2025', 'Archief')).toBe(
      'Archief/Acme/2025',
    );
    expect(destinationName('Klanten/Acme', 'Klanten/Acme/2025', null)).toBe('Acme/2025');
  });
});

describe('planLabelTree', () => {
  const members = ['Klanten', 'Klanten/Acme'];

  it('maps every member to the name it gets in the target', () => {
    const plan = planLabelTree(members, 'Klanten', 'Archief', new Map());
    expect(plan.destinations.get('Klanten')).toBe('Archief/Klanten');
    expect(plan.destinations.get('Klanten/Acme')).toBe('Archief/Klanten/Acme');
  });

  it('reuses a label that is already there instead of creating it', () => {
    const existing = new Map([['Klanten', 'Label_9']]);
    const plan = planLabelTree(members, 'Klanten', null, existing);
    expect(plan.reuse.get('Klanten')).toBe('Label_9');
    expect(plan.create).toEqual(['Klanten/Acme']);
  });

  it('lists what has to be made, parents first', () => {
    const deep = ['Klanten', 'Klanten/Acme', 'Klanten/Acme/2025'];
    const plan = planLabelTree(deep, 'Klanten', null, new Map());
    expect(plan.create).toEqual(['Klanten', 'Klanten/Acme', 'Klanten/Acme/2025']);
  });

  it('fills in an ancestor no member of its own occupies', () => {
    // Gmail lets Klanten/Acme/2025 exist without Klanten/Acme, so the copy has to make it
    const gappy = ['Klanten', 'Klanten/Acme/2025'];
    const plan = planLabelTree(gappy, 'Klanten', null, new Map());
    expect(plan.create).toEqual(['Klanten', 'Klanten/Acme', 'Klanten/Acme/2025']);
  });

  it('never creates the chosen parent itself', () => {
    const plan = planLabelTree(members, 'Klanten', 'Archief', new Map([['Archief', 'Label_1']]));
    expect(plan.create).not.toContain('Archief');
  });
});

describe('resolveMessageLabels', () => {
  const destinations = new Map([
    ['Klanten', 'Archief/Klanten'],
    ['Klanten/Acme', 'Archief/Klanten/Acme'],
  ]);
  const ids = new Map([
    ['Archief/Klanten', 'Label_1'],
    ['Archief/Klanten/Acme', 'Label_2'],
  ]);

  it('gives one message under two source labels both label ids', () => {
    expect(resolveMessageLabels(['Klanten', 'Klanten/Acme'], destinations, ids)).toEqual([
      'Label_1',
      'Label_2',
    ]);
  });

  it('skips a label whose creation failed rather than guessing a nearer one', () => {
    const partial = new Map([['Archief/Klanten', 'Label_1']]);
    expect(resolveMessageLabels(['Klanten', 'Klanten/Acme'], destinations, partial)).toEqual([
      'Label_1',
    ]);
  });

  it('never repeats an id', () => {
    const same = new Map([
      ['Klanten', 'Archief/Klanten'],
      ['Klanten/Acme', 'Archief/Klanten'],
    ]);
    expect(resolveMessageLabels(['Klanten', 'Klanten/Acme'], same, ids)).toEqual(['Label_1']);
  });
});
