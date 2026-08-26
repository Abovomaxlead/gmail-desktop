// Dropping mail onto a Gmail label: reading the label from the DOM and merging threads.

import { describe, it, expect } from 'vitest';
import {
  labelFromHref,
  labelFromDragTarget,
  labelListUrl,
  scrapeSettled,
  labelNamesFromHrefs,
  mergeTreeThreads,
  SCRAPE_MAX_THREADS,
  API_MAX_THREADS,
  MAX_PAGES,
  PAGE_SIZE,
  type LabelThread,
  type TreeThread,
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
  // A nested label is one name with a slash in it, and Gmail spells it out in full in its
  // own link. Reading only the part before the slash handed back the parent, so dragging a
  // subfolder emptied the folder above it.
  it('keeps the whole path of a nested label', () => {
    expect(labelFromHref('#label/Werk/Grote+klanten')).toBe('Werk/Grote klanten');
    expect(labelFromHref('#label/Werk/Klanten/Groot')).toBe('Werk/Klanten/Groot');
  });
  it('drops the page suffix of a nested label too', () => {
    expect(labelFromHref('#label/Werk/Grote+klanten/p2')).toBe('Werk/Grote klanten');
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
    it('finds a nested label in full from the row around it', () => {
      expect(labelFromDragTarget(navRow('Werk/Grote+klanten'))).toBe('Werk/Grote klanten');
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

// Dragging a label takes its sublabels with it: the navigation is the only list of them
// there is without the API, and one cap covers the whole tree rather than each label.
describe('labelNamesFromHrefs', () => {
  it('reads every label out of the navigation', () => {
    expect(
      labelNamesFromHrefs([
        'https://mail.google.com/mail/u/0/#label/Klanten',
        'https://mail.google.com/mail/u/0/#label/Klanten%2FAcme',
        'https://mail.google.com/mail/u/0/#inbox',
      ]),
    ).toEqual(['Klanten', 'Klanten/Acme']);
  });

  it('names a label once however often it is linked', () => {
    expect(labelNamesFromHrefs(['#label/Klanten', '#label/Klanten/p2'])).toEqual(['Klanten']);
  });
});

describe('mergeTreeThreads', () => {
  it('remembers which label a thread came from', () => {
    const acc: TreeThread[] = [];
    mergeTreeThreads(acc, 'Klanten', [{ threadId: 't1', subject: 'Een' }]);
    expect(acc).toEqual([{ threadId: 't1', subject: 'Een', labels: ['Klanten'] }]);
  });

  it('adds the second label to a thread that is in both', () => {
    const acc: TreeThread[] = [];
    mergeTreeThreads(acc, 'Klanten', [{ threadId: 't1', subject: 'Een' }]);
    const second = mergeTreeThreads(acc, 'Klanten/Acme', [{ threadId: 't1', subject: 'Een' }]);
    expect(acc).toHaveLength(1);
    expect(acc[0].labels).toEqual(['Klanten', 'Klanten/Acme']);
    expect(second.added).toBe(0);
  });

  it('does not repeat a label when a page is read twice', () => {
    const acc: TreeThread[] = [];
    mergeTreeThreads(acc, 'Klanten', [{ threadId: 't1', subject: 'Een' }]);
    mergeTreeThreads(acc, 'Klanten', [{ threadId: 't1', subject: 'Een' }]);
    expect(acc[0].labels).toEqual(['Klanten']);
  });

  it('caps the whole tree, not each label', () => {
    const acc: TreeThread[] = [];
    const page = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({ threadId: `t${from + i}`, subject: 's' }));
    mergeTreeThreads(acc, 'A', page(0, SCRAPE_MAX_THREADS));
    const over = mergeTreeThreads(acc, 'B', page(SCRAPE_MAX_THREADS, 5));
    expect(over.added).toBe(0);
    expect(over.total).toBe(SCRAPE_MAX_THREADS);
  });

  it('still lets a thread already in the accumulator gain a label at the cap', () => {
    const acc: TreeThread[] = [];
    const page = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({ threadId: `t${from + i}`, subject: 's' }));
    mergeTreeThreads(acc, 'A', page(0, SCRAPE_MAX_THREADS));
    mergeTreeThreads(acc, 'B', [{ threadId: 't0', subject: 's' }]);
    expect(acc[0].labels).toEqual(['A', 'B']);
  });

  it('skips entries without an id', () => {
    const acc: TreeThread[] = [];
    expect(
      mergeTreeThreads(acc, 'Klanten', [
        { threadId: '', subject: 'x' },
        { threadId: 't1', subject: 'Een' },
      ]).total,
    ).toBe(1);
  });
});

describe('the two caps', () => {
  // The scrape reads Gmail's own list view 50 rows at a time and it re-shows the last page for
  // a page number past the end, so there is a real point past which paging stops being worth
  // it. That is what this number is, and MAX_PAGES derives from it.
  it('bounds the scrape at what paging Gmail\'s list view is worth', () => {
    expect(SCRAPE_MAX_THREADS).toBe(2000);
    expect(MAX_PAGES).toBe(Math.ceil(SCRAPE_MAX_THREADS / PAGE_SIZE));
  });

  // Not a limit anyone should meet: threads.list pages 100 ids for 10 units, so a full one is
  // 500 pages and 5,000 units to plan. It exists so a runaway page loop cannot allocate without
  // end, which is a different job from the scrape's ceiling.
  it('bounds the API path far above anything a mailbox holds', () => {
    expect(API_MAX_THREADS).toBe(50_000);
    expect(API_MAX_THREADS).toBeGreaterThan(SCRAPE_MAX_THREADS);
  });
});
