// Dropping mail onto a Gmail label: reading the label from the DOM and merging threads.

import { describe, it, expect } from 'vitest';
import {
  labelFromHref,
  labelFromDragTarget,
  labelListUrl,
  mergeThreads,
  scrapeSettled,
  MAX_THREADS,
  type LabelThread,
} from '../electron/mail/label-drop';

const node = (attrs: Record<string, string>, parent: any = null, descendants: any[] = []): any => ({
  getAttribute: (n: string) => attrs[n] ?? null,
  parentElement: parent,
  querySelectorAll: () => descendants,
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

  // A nav row is far wider than the link inside it: the unread count, the hover menu and
  // the space around the name all sit outside the anchor, and a press there saw no label.
  describe('a press beside the link inside the row', () => {
    const navRow = (...labels: string[]) =>
      node({ role: 'link' }, null, labels.map((l) => node({ href: `#label/${l}` })));

    it('finds the link inside the pressed row', () => {
      expect(labelFromDragTarget(navRow('Offertes'))).toBe('Offertes');
    });
    it('finds it from the unread count beside the name', () => {
      expect(labelFromDragTarget(node({}, navRow('Offertes')))).toBe('Offertes');
    });
    it('refuses to guess once the search reaches the whole navigation', () => {
      expect(labelFromDragTarget(navRow('Offertes', 'Klanten'))).toBeNull();
    });
    it('leaves a row of a built-in view alone', () => {
      expect(labelFromDragTarget(node({ role: 'link' }, null, [node({ href: '#inbox' })]))).toBeNull();
    });
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

// Gmail fills a list row by row, so the first read of a page is whatever had rendered by
// then. Accepting it turned a label of forty into a folder of two.
describe('scrapeSettled', () => {
  const t = (id: string): LabelThread => ({ threadId: id, subject: `Onderwerp ${id}` });

  it('refuses the first read, however many rows it already found', () => {
    expect(scrapeSettled([], [t('a'), t('b')], '')).toBe(false);
  });
  it('refuses a read that grew since the one before it', () => {
    expect(scrapeSettled([t('a'), t('b')], [t('a'), t('b'), t('c')], '')).toBe(false);
  });
  it('accepts a read that repeats the one before it', () => {
    expect(scrapeSettled([t('a'), t('b')], [t('a'), t('b')], '')).toBe(true);
  });
  it('refuses a read whose rows changed without changing in number', () => {
    expect(scrapeSettled([t('a'), t('b')], [t('a'), t('c')], '')).toBe(false);
  });
  it('refuses an empty page, which is a list that has not drawn yet', () => {
    expect(scrapeSettled([], [], '')).toBe(false);
  });
  // Navigating to page 2 leaves page 1 on screen until Gmail replaces it, and a settled read
  // of the wrong page is still the wrong page.
  it('refuses a page still showing the one before it', () => {
    expect(scrapeSettled([t('a'), t('b')], [t('a'), t('b')], 'a')).toBe(false);
    expect(scrapeSettled([t('c'), t('d')], [t('c'), t('d')], 'a')).toBe(true);
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
