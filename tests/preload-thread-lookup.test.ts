// Gmail's new-mail notification carries no thread id, so the thread to open is found
// by matching the notification body against the inbox rows' subject spans, newest first.

import { describe, expect, it } from 'vitest';
import { matchThreadsBySubject, rowMessageIdFor } from '../electron/preload';

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

  it('keeps the rows in DOM order, so the newest match comes first', () => {
    const d = doc([
      { text: 'Weekly report', id: 'aaa' },
      { text: 'Notificatieklik test', id: 'bbb' },
      { text: 'Notificatieklik test', id: 'ccc' },
    ]);
    expect(matchThreadsBySubject(d, 'Notificatieklik test')).toEqual(['bbb', 'ccc']);
  });

  it('trims whitespace on both sides of the comparison', () => {
    const d = doc([{ text: '  Hello  ', id: 'x1' }]);
    expect(matchThreadsBySubject(d, 'Hello ')).toEqual(['x1']);
  });

  it('falls back to prefix match when the notification body is ellipsized', () => {
    const d = doc([{ text: 'A very long subject line that Gmail cut off somewhere', id: 'y1' }]);
    expect(matchThreadsBySubject(d, 'A very long subject line that…')).toEqual(['y1']);
    expect(matchThreadsBySubject(d, 'A very long subject line that...')).toEqual(['y1']);
  });

  it('is empty when the row is not in the DOM at all, or the subject is empty', () => {
    expect(matchThreadsBySubject(doc([{ text: 'Something', id: 'z1' }]), 'Other')).toEqual([]);
    expect(matchThreadsBySubject(doc([{ text: 'Something', id: 'z1' }]), '')).toEqual([]);
    expect(matchThreadsBySubject(doc([]), 'Something')).toEqual([]);
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

// The row names the thread and, beside it, the thread's last message. Only the thread id
// was ever read, and a thread id is the id of the conversation's *first* message — so the
// click handed Gmail the oldest mail in the conversation and Gmail unfolded it. The row
// knew the newest one all along.
describe('rowMessageIdFor', () => {
  type Row = { id: string; last?: string; inner?: string[] };

  function rows(list: Row[]) {
    return {
      querySelectorAll: () =>
        list.map((r) => ({
          textContent: '',
          getAttribute: (name: string) =>
            name === 'data-legacy-thread-id'
              ? r.id
              : name === 'data-legacy-last-message-id'
                ? (r.last ?? null)
                : null,
          querySelectorAll: (sel: string) =>
            sel === '[data-legacy-last-message-id]'
              ? (r.inner ?? []).map((id) => ({ getAttribute: () => id }))
              : [],
        })),
    };
  }

  it('reads the last message off the row itself', () => {
    const d = rows([
      { id: '1a01e60531e25cc1', last: '1a01e8095ef2b95a' },
      { id: '19ff5f3f6b06c044', last: '19ff5f5e04c9c0b5' },
    ]);
    expect(rowMessageIdFor(d, '1a01e60531e25cc1')).toBe('1a01e8095ef2b95a');
    expect(rowMessageIdFor(d, '19ff5f3f6b06c044')).toBe('19ff5f5e04c9c0b5');
  });

  it('reads it off the span inside the row, where Gmail usually writes it', () => {
    const d = rows([{ id: '1a01e60531e25cc1', inner: ['1a01e8095ef2b95a'] }]);
    expect(rowMessageIdFor(d, '1a01e60531e25cc1')).toBe('1a01e8095ef2b95a');
  });

  // Two ids under one row is a layout this code does not understand, and guessing between
  // them is how you land on an older mail — the failure being fixed. It answers nothing,
  // and the conversation opens the way it always did.
  it('answers nothing rather than guessing between two', () => {
    const d = rows([{ id: '1a01e60531e25cc1', inner: ['1a01e8095ef2b95a', '1a01e9199d59543d'] }]);
    expect(rowMessageIdFor(d, '1a01e60531e25cc1')).toBeUndefined();
  });

  it('answers nothing for a row Gmail wrote no message id on', () => {
    expect(rowMessageIdFor(rows([{ id: '1a01e60531e25cc1' }]), '1a01e60531e25cc1')).toBeUndefined();
  });

  it('answers nothing for a thread that is not on screen, or no thread at all', () => {
    const d = rows([{ id: '1a01e60531e25cc1', last: '1a01e8095ef2b95a' }]);
    expect(rowMessageIdFor(d, '19ff5f3f6b06c044')).toBeUndefined();
    expect(rowMessageIdFor(d, '')).toBeUndefined();
  });
});
