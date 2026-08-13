// Dropping mail onto a Gmail label: reading the label from the DOM and merging threads.

import { describe, it, expect } from 'vitest';
import {
  labelFromHref,
  labelFromDragTarget,
  labelListUrl,
  mergeThreads,
  MAX_THREADS,
  type LabelThread,
} from '../electron/mail/label-drop';

const node = (attrs: Record<string, string>, parent: any = null): any => ({
  getAttribute: (n: string) => attrs[n] ?? null,
  parentElement: parent,
});

describe('labelFromHref', () => {
  it('reads the label from a nav link', () => {
    expect(labelFromHref('https://mail.google.com/mail/u/0/#label/Klanten')).toBe('Klanten');
  });
  it('decodes spaces and special characters', () => {
    expect(labelFromHref('#label/Grote%20klanten')).toBe('Grote klanten');
    expect(labelFromHref('#label/Caf%C3%A9')).toBe('Café');
    expect(labelFromHref('#label/Grote+klanten')).toBe('Grote klanten');
  });
  it('keeps only the label itself, not the page suffix', () => {
    expect(labelFromHref('#label/Klanten/p3')).toBe('Klanten');
  });
  it('rejects the inbox and other built-in views', () => {
    expect(labelFromHref('#inbox')).toBeNull();
    expect(labelFromHref('#sent')).toBeNull();
    expect(labelFromHref('#starred')).toBeNull();
    expect(labelFromHref('')).toBeNull();
  });
  it('survives a malformed percent escape', () => {
    expect(labelFromHref('#label/100%kapot')).toBe('100%kapot');
  });
});

describe('labelFromDragTarget', () => {
  it('walks up from the pressed text to the nav link', () => {
    const link = node({ href: '#label/Offertes' });
    expect(labelFromDragTarget(node({}, node({}, link)))).toBe('Offertes');
  });
  it('returns null when no ancestor is a label link', () => {
    expect(labelFromDragTarget(node({ href: '#inbox' }, node({})))).toBeNull();
    expect(labelFromDragTarget(null)).toBeNull();
  });
  it('does not loop forever on a cyclic parent chain', () => {
    const self: any = { getAttribute: () => null, parentElement: null };
    self.parentElement = self;
    expect(labelFromDragTarget(self)).toBeNull();
  });
});

describe('labelListUrl', () => {
  it('builds page one without a suffix', () => {
    expect(labelListUrl('0', 'Klanten', 1)).toBe('https://mail.google.com/mail/u/0/#label/Klanten');
  });
  it('adds the page suffix and honours the authuser slot', () => {
    expect(labelListUrl('2', 'Klanten', 3)).toBe(
      'https://mail.google.com/mail/u/2/#label/Klanten/p3',
    );
  });
  it('encodes a space but keeps the slash of a nested label', () => {
    expect(labelListUrl('0', 'Werk/Grote klanten', 1)).toBe(
      'https://mail.google.com/mail/u/0/#label/Werk/Grote%20klanten',
    );
  });
});

describe('mergeThreads', () => {
  const t = (id: string): LabelThread => ({ threadId: id, subject: `Onderwerp ${id}` });

  it('adds new threads and reports how many', () => {
    const acc = [t('a')];
    expect(mergeThreads(acc, [t('b'), t('c')])).toEqual({ added: 2, total: 3 });
  });
  it('reports zero when a page repeats what we already had', () => {
    const acc = [t('a'), t('b')];
    expect(mergeThreads(acc, [t('a'), t('b')])).toEqual({ added: 0, total: 2 });
  });
  it('skips entries without an id', () => {
    const acc: LabelThread[] = [];
    expect(mergeThreads(acc, [{ threadId: '', subject: 'x' }, t('a')]).total).toBe(1);
  });
  it('stops at the cap instead of growing without bound', () => {
    const acc: LabelThread[] = [];
    const page = Array.from({ length: MAX_THREADS + 25 }, (_, i) => t(`id${i}`));
    expect(mergeThreads(acc, page)).toEqual({ added: MAX_THREADS, total: MAX_THREADS });
  });
});
