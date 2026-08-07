// What the page sends main when Gmail raises a notification. The raw subject travels with
// it: main applies the privacy replacement, the same way it does for push mail, and the
// page keeps the original so a click can still find the thread by its subject.

import { describe, expect, it } from 'vitest';
import { webNotifyPageId, webNotifyPayload } from '../electron/preload';
import { webNotifySourceKey } from '../renderer/lib/toast';

describe('webNotifyPayload', () => {
  it('carries the title, the body and the id', () => {
    expect(webNotifyPayload('w1', 'Ada Lovelace', { body: 'Re: the engine' })).toEqual({
      id: 'w1',
      title: 'Ada Lovelace',
      body: 'Re: the engine',
    });
  });

  it('sends an empty body when the page passed no options', () => {
    expect(webNotifyPayload('w2', 'Ada', undefined)).toEqual({ id: 'w2', title: 'Ada', body: '' });
  });

  it('sends an empty body when the page passed options without one', () => {
    expect(webNotifyPayload('w3', 'Ada', { tag: 'x' })).toEqual({ id: 'w3', title: 'Ada', body: '' });
  });

  it('stringifies a body that is not a string', () => {
    expect(webNotifyPayload('w4', 'Ada', { body: 42 as unknown as string }).body).toBe('42');
  });

  // The title comes out of `new Notification(x)` inside Google's own page, so its type is
  // whatever that page passed and not what the signature claims. An object reaching the
  // card is rendered as a React child, which throws and unmounts the whole toasts page -
  // taking every later notification with it.
  it('stringifies a title that is not a string', () => {
    expect(webNotifyPayload('w5', { a: 1 } as unknown as string).title).toBe('[object Object]');
    expect(webNotifyPayload('w6', 42 as unknown as string).title).toBe('42');
  });

  it('sends an empty title when the page passed none', () => {
    expect(webNotifyPayload('w7', undefined as unknown as string).title).toBe('');
    expect(webNotifyPayload('w8', null as unknown as string).title).toBe('');
  });
});

// A reload keeps the same WebContents, so pairing the counter with the view's id is not
// enough on its own: the counter restarts at 1 and the pair repeats. The id a page hands
// out therefore carries which load of that page issued it.
describe('webNotifyPageId', () => {
  it('keeps two loads of one page apart when the counter has restarted', () => {
    expect(webNotifyPageId('abc', 1)).not.toBe(webNotifyPageId('xyz', 1));
  });

  it('keeps two notifications from one load apart', () => {
    expect(webNotifyPageId('abc', 1)).not.toBe(webNotifyPageId('abc', 2));
  });

  it('is stable, so the body stored at show time is the one the click reads', () => {
    expect(webNotifyPageId('abc', 1)).toBe(webNotifyPageId('abc', 1));
  });
});

// Every view numbers its own notifications from 1, so the page-side id alone is not a name
// main can file them under: two accounts both raise a "w1" and the second would overwrite
// the first, sending a click to the wrong page — which resolves the subject against the
// wrong DOM and opens an unrelated conversation. A reload does the same within one account.
describe('webNotifySourceKey', () => {
  it('keeps two views apart when they issue the same page-side id', () => {
    expect(webNotifySourceKey(11, 'w1')).not.toBe(webNotifySourceKey(12, 'w1'));
  });

  it('keeps two notifications from one view apart', () => {
    expect(webNotifySourceKey(11, 'w1')).not.toBe(webNotifySourceKey(11, 'w2'));
  });

  it('is stable, so the delete after a click finds what the show put there', () => {
    expect(webNotifySourceKey(11, 'w1')).toBe(webNotifySourceKey(11, 'w1'));
  });
});
