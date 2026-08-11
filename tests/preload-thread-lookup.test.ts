// Gmail's new-mail notification carries no thread id, so the thread to open is found
// by matching the notification body against the inbox rows' subject spans, newest first.

import { describe, expect, it } from 'vitest';
import { findThreadIdBySubject, matchThreadsBySubject } from '../electron/preload';

type FakeEl = { text: string; id: string };
function doc(rows: FakeEl[]) {
  return {
    querySelectorAll: () =>
      rows.map((r) => ({
        textContent: r.text,
        getAttribute: (name: string) => (name === 'data-legacy-thread-id' ? r.id : null),
      })),
  };
}

describe('findThreadIdBySubject', () => {
  it('returns the first row whose subject matches exactly (newest first)', () => {
    const d = doc([
      { text: 'Weekly report', id: 'aaa' },
      { text: 'Notificatieklik test', id: 'bbb' },
      { text: 'Notificatieklik test', id: 'ccc' },
    ]);
    expect(findThreadIdBySubject(d, 'Notificatieklik test')).toBe('bbb');
  });

  it('trims whitespace on both sides of the comparison', () => {
    const d = doc([{ text: '  Hello  ', id: 'x1' }]);
    expect(findThreadIdBySubject(d, 'Hello ')).toBe('x1');
  });

  it('falls back to prefix match when the notification body is ellipsized', () => {
    const d = doc([{ text: 'A very long subject line that Gmail cut off somewhere', id: 'y1' }]);
    expect(findThreadIdBySubject(d, 'A very long subject line that…')).toBe('y1');
    expect(findThreadIdBySubject(d, 'A very long subject line that...')).toBe('y1');
  });

  it('returns null when nothing matches or the subject is empty', () => {
    const d = doc([{ text: 'Something', id: 'z1' }]);
    expect(findThreadIdBySubject(d, 'Other')).toBeNull();
    expect(findThreadIdBySubject(d, '')).toBeNull();
    expect(findThreadIdBySubject(doc([]), 'Something')).toBeNull();
  });

  it('ignores rows without a usable id', () => {
    const d = {
      querySelectorAll: () => [
        { textContent: 'Hit', getAttribute: () => null },
        { textContent: 'Hit', getAttribute: (n: string) => (n === 'data-legacy-thread-id' ? 'ok1' : null) },
      ],
    };
    expect(findThreadIdBySubject(d, 'Hit')).toBe('ok1');
  });
});

// The count behind the answer. Picking the first match is a guess whenever there is more
// than one, and the guess is invisible in the id that comes out of it — which is why a
// click landing on the wrong conversation could not be told apart from one landing on no
// conversation at all.
describe('matchThreadsBySubject', () => {
  it('reports every thread carrying the subject, so an ambiguous match is visible', () => {
    const d = doc([
      { text: 'Re: offerte', id: 'aaa' },
      { text: 'Weekly report', id: 'bbb' },
      { text: 'Re: offerte', id: 'ccc' },
    ]);
    expect(matchThreadsBySubject(d, 'Re: offerte')).toEqual(['aaa', 'ccc']);
  });

  it('counts a thread once when Gmail repeats its id on the row and on a span inside it', () => {
    const d = doc([
      { text: 'Re: offerte', id: 'aaa' },
      { text: 'Re: offerte', id: 'aaa' },
    ]);
    expect(matchThreadsBySubject(d, 'Re: offerte')).toEqual(['aaa']);
  });

  it('is empty when the row is not in the DOM at all', () => {
    expect(matchThreadsBySubject(doc([{ text: 'Something', id: 'z1' }]), 'Other')).toEqual([]);
  });

  it('still ignores rows without a usable id', () => {
    const d = {
      querySelectorAll: () => [
        { textContent: 'Hit', getAttribute: () => null },
        { textContent: 'Hit', getAttribute: (n: string) => (n === 'data-legacy-thread-id' ? 'ok1' : null) },
      ],
    };
    expect(matchThreadsBySubject(d, 'Hit')).toEqual(['ok1']);
  });
});
