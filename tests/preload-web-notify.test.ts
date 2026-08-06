// What the page sends main when Gmail raises a notification. The raw subject travels with
// it: main applies the privacy replacement, the same way it does for push mail, and the
// page keeps the original so a click can still find the thread by its subject.

import { describe, expect, it } from 'vitest';
import { webNotifyPayload } from '../electron/preload';

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
});
