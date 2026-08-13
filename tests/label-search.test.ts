// Narrowing the label picker to what you type, without losing what you already ticked.

import { describe, it, expect } from 'vitest';
import { filterLabels } from '../renderer/app/label-search';

const labels = [
  { id: 'INBOX', name: 'Postvak IN' },
  { id: 'L1', name: 'Offertes/Week 31' },
  { id: 'L2', name: 'Facturen 2026' },
  { id: 'L3', name: 'Offertes/Archief' },
];
const names = (out: { name: string }[]) => out.map((l) => l.name);

describe('filterLabels', () => {
  it('returns every label for an empty query', () => {
    expect(filterLabels(labels, '', [])).toEqual(labels);
    expect(filterLabels(labels, '   ', [])).toEqual(labels);
  });

  it('matches part of the name, whatever the case', () => {
    expect(names(filterLabels(labels, 'fact', []))).toEqual(['Facturen 2026']);
    expect(names(filterLabels(labels, 'POSTVAK', []))).toEqual(['Postvak IN']);
  });

  it('matches a nested label on its parent as well as its own name', () => {
    expect(names(filterLabels(labels, 'offertes', []))).toEqual([
      'Offertes/Week 31',
      'Offertes/Archief',
    ]);
    expect(names(filterLabels(labels, 'archief', []))).toEqual(['Offertes/Archief']);
  });

  it('asks for every word, in any order', () => {
    expect(names(filterLabels(labels, 'week offertes', []))).toEqual(['Offertes/Week 31']);
    expect(names(filterLabels(labels, 'offertes 2026', []))).toEqual([]);
  });

  it('keeps a ticked label in sight even when it does not match', () => {
    expect(names(filterLabels(labels, 'fact', ['L3']))).toEqual([
      'Facturen 2026',
      'Offertes/Archief',
    ]);
  });

  it('keeps the order the labels came in', () => {
    expect(names(filterLabels(labels, 'e', ['L2']))).toEqual([
      'Offertes/Week 31',
      'Facturen 2026',
      'Offertes/Archief',
    ]);
  });

  it('returns nothing when nothing matches and nothing is ticked', () => {
    expect(filterLabels(labels, 'zzz', [])).toEqual([]);
  });
});
