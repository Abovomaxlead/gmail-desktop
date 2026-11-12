// Gmail's "select all N in this view": which list the page names, and how the banner is read.

import { describe, it, expect } from 'vitest';
import {
  bannerCount,
  isWholeSelectionMark,
  listViewFromHash,
  wholeViewOf,
} from '../electron/mail/drag/whole-view';

describe('listViewFromHash', () => {
  // Measured: a label of 153 at 100 per page is "#label/Klanten%2FAlpha+tours", and selecting
  // the whole list from page two must still mean the whole label.
  it('names the label alone, on any page of it', () => {
    expect(listViewFromHash('#label/Klanten%2FAlpha+tours', false)).toEqual({
      kind: 'label',
      name: 'Klanten/Alpha tours',
    });
    expect(listViewFromHash('#label/Klanten/Alpha+tours/p2', false)).toEqual({
      kind: 'label',
      name: 'Klanten/Alpha tours',
    });
  });

  it('decodes a search as Gmail writes it in the hash', () => {
    expect(listViewFromHash('#search/from%3Aalpha+has%3Aattachment/p3', false)).toEqual({
      kind: 'query',
      labelIds: [],
      q: 'from:alpha has:attachment',
      includeSpamTrash: false,
    });
  });

  // A tabbed inbox shows Primary under #inbox; the whole inbox would sweep in every tab.
  it('limits a tabbed inbox to Primary', () => {
    expect(listViewFromHash('#inbox', true)).toMatchObject({ labelIds: ['INBOX'], q: 'category:primary' });
    expect(listViewFromHash('#inbox', false)).toMatchObject({ labelIds: ['INBOX'], q: '' });
    expect(listViewFromHash('#category/promotions', true)).toMatchObject({
      labelIds: ['CATEGORY_PROMOTIONS'],
      q: '',
    });
  });

  it('asks for spam and trash only in their own views', () => {
    expect(listViewFromHash('#trash', false)).toMatchObject({ labelIds: ['TRASH'], includeSpamTrash: true });
    expect(listViewFromHash('#all', false)).toMatchObject({ labelIds: [], includeSpamTrash: false });
  });

  // An open conversation, or a view the API has no equivalent for, must not be read as some
  // other list: the drag is refused rather than saving the wrong set.
  it('answers null for anything it cannot list the same way', () => {
    expect(listViewFromHash('#inbox/FMfcgzQbfLpx', false)).toBeNull();
    expect(listViewFromHash('#advanced-search/subset=all', false)).toBeNull();
    expect(listViewFromHash('#snoozed', false)).toBeNull();
    expect(listViewFromHash('#search/', false)).toBeNull();
    expect(listViewFromHash('', false)).toBeNull();
  });
});

describe('the banner', () => {
  it('is known by the clear-selection id only, not by one that starts with it', () => {
    expect(isWholeSelectionMark('125946; u014N:cOuCgd; dYFj7e:true')).toBe(true);
    expect(isWholeSelectionMark('125945; u014N:cOuCgd; dYFj7e:true')).toBe(false);
    expect(isWholeSelectionMark('1259460; u014N:cOuCgd')).toBe(false);
    expect(isWholeSelectionMark(null)).toBe(false);
  });

  it('counts past the locale grouping', () => {
    expect(bannerCount('153')).toBe(153);
    expect(bannerCount('1.234')).toBe(1234);
    expect(bannerCount('1,234')).toBe(1234);
    expect(bannerCount('')).toBeNull();
  });
});

describe('wholeViewOf', () => {
  // With conversation view off every row is one mail, and Gmail's count is of mails.
  it('lists messages when the ticked rows are messages, conversations otherwise', () => {
    const message = [{ threadId: 'a', message: { permId: 'msg-f:1' } }];
    expect(wholeViewOf('#sent', false, 153, message).unit).toBe('message');
    expect(wholeViewOf('#sent', false, 153, [{ threadId: 'a' }]).unit).toBe('thread');
  });
});
