import { describe, it, expect } from 'vitest';
import {
  threadIdFromDragTarget,
  authuserFromPath,
  ikFromPage,
  resultText,
  DROPZONE_ID,
  DROPZONE_CSS,
  ALWAYS_VISIBLE,
  selectedThreadIds,
  threadIdsForDrag,
  threadSubjects,
  itemsForDrag,
  NO_SUBJECT,
  isOverZone,
  movedEnough,
} from '../electron/dropzone';

// Minimale namaak-DOM: de functie mag alleen getAttribute, querySelectorAll en
// parentElement gebruiken, want de tests draaien zonder jsdom.
function node(attrs: Record<string, string>, parent: any = null, descendants: any[] = []): any {
  return {
    getAttribute: (n: string) => attrs[n] ?? null,
    parentElement: parent,
    querySelectorAll: () => descendants,
  };
}

// Zoals Gmail het echt doet: het thread-id staat op de onderwerp-span diep in
// de rij, en `dragstart` vuurt op de rij (het element met draggable="true").
// Vanaf de rij omhoog lopen vindt de span dus nooit — die zit eronder.
function gmailRow(threadId: string) {
  const subject = node({ 'data-legacy-thread-id': threadId });
  return node({ draggable: 'true', role: 'row' }, null, [subject]);
}

describe('threadIdFromDragTarget', () => {
  it('finds the id on the element itself', () => {
    expect(threadIdFromDragTarget(node({ 'data-legacy-thread-id': '18f2a' }))).toBe('18f2a');
  });
  it('walks up to an ancestor that carries the id', () => {
    const row = node({ 'data-legacy-thread-id': '18f2a' });
    const span = node({}, node({}, row));
    expect(threadIdFromDragTarget(span)).toBe('18f2a');
  });
  it('finds the id on the subject span inside the dragged row', () => {
    expect(threadIdFromDragTarget(gmailRow('18f2a'))).toBe('18f2a');
  });
  it('finds it from a cell inside that row too', () => {
    const row = gmailRow('18f2a');
    const cell = node({}, row);
    expect(threadIdFromDragTarget(cell)).toBe('18f2a');
  });
  it('refuses to guess when an ancestor holds several different ids', () => {
    // Zoals de <table> of <body>: die bevat elke rij van de inbox. Daar een id
    // uit pakken zou de verkeerde mail opslaan.
    const list = node({}, null, [
      node({ 'data-legacy-thread-id': 'a' }),
      node({ 'data-legacy-thread-id': 'b' }),
    ]);
    expect(threadIdFromDragTarget(list)).toBeNull();
  });
  it('returns null when no ancestor has one', () => {
    expect(threadIdFromDragTarget(node({}, node({})))).toBeNull();
    expect(threadIdFromDragTarget(null)).toBeNull();
  });
  it('ignores an empty attribute value', () => {
    expect(threadIdFromDragTarget(node({ 'data-legacy-thread-id': '' }))).toBeNull();
  });
  it('stops after a sane number of levels instead of looping forever', () => {
    const self: any = { getAttribute: () => null, parentElement: null };
    self.parentElement = self; // cyclus
    expect(threadIdFromDragTarget(self)).toBeNull();
  });
});

describe('selectedThreadIds / threadIdsForDrag', () => {
  // Een aangevinkte rij: de checkbox zit ín de rij, net als de onderwerp-span.
  const checkedRow = (threadId: string) => {
    const row = node({}, null, [node({ 'data-legacy-thread-id': threadId })]);
    return node({ role: 'checkbox', 'aria-checked': 'true' }, row);
  };
  const doc = (boxes: any[]) => ({ querySelectorAll: () => boxes });

  it('collects the thread id of every checked row', () => {
    expect(selectedThreadIds(doc([checkedRow('a'), checkedRow('b')]))).toEqual(['a', 'b']);
  });
  it('deduplicates and skips rows without an id', () => {
    expect(selectedThreadIds(doc([checkedRow('a'), checkedRow('a'), node({}, node({}))]))).toEqual(['a']);
  });
  it('returns nothing when the selection is empty', () => {
    expect(selectedThreadIds(doc([]))).toEqual([]);
  });

  it('drags the whole selection when the pressed row is part of it', () => {
    expect(threadIdsForDrag('b', ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });
  it('drags only the pressed row when it is outside the selection', () => {
    expect(threadIdsForDrag('z', ['a', 'b'])).toEqual(['z']);
  });
  it('drags only the pressed row when nothing is selected', () => {
    expect(threadIdsForDrag('z', [])).toEqual(['z']);
  });
});

describe('threadSubjects / itemsForDrag', () => {
  // Het element dat het thread-id draagt is Gmail's onderwerp-span, dus de
  // onderwerptekst staat er al in.
  const subjectSpan = (id: string, text: string) => ({
    getAttribute: (n: string) => (n === 'data-legacy-thread-id' ? id : null),
    textContent: text,
    parentElement: null,
  });
  const doc = (els: any[]) => ({ querySelectorAll: () => els });

  it('maps every thread id to its subject', () => {
    expect(threadSubjects(doc([subjectSpan('a', 'Offerte week 31'), subjectSpan('b', 'Factuur')]))).toEqual({
      a: 'Offerte week 31',
      b: 'Factuur',
    });
  });
  it('collapses the whitespace Gmail leaves in the subject', () => {
    expect(threadSubjects(doc([subjectSpan('a', '  Offerte\n   week 31 ')]))).toEqual({
      a: 'Offerte week 31',
    });
  });
  it('keeps the first occurrence when an id appears twice', () => {
    expect(threadSubjects(doc([subjectSpan('a', 'Eerste'), subjectSpan('a', 'Tweede')]))).toEqual({
      a: 'Eerste',
    });
  });
  it('skips entries without an id or without text', () => {
    expect(threadSubjects(doc([subjectSpan('', 'x'), subjectSpan('b', '   ')]))).toEqual({});
  });

  it('pairs the dragged ids with their subjects, in order', () => {
    expect(itemsForDrag(['b', 'a'], { a: 'Offerte', b: 'Factuur' })).toEqual([
      { threadId: 'b', subject: 'Factuur' },
      { threadId: 'a', subject: 'Offerte' },
    ]);
  });
  it('falls back to a placeholder when the subject is unknown', () => {
    expect(itemsForDrag(['z'], {})).toEqual([{ threadId: 'z', subject: NO_SUBJECT }]);
  });
});

describe('authuserFromPath', () => {
  it('reads the authuser slot from the path', () => {
    expect(authuserFromPath('/mail/u/2/')).toBe('2');
    expect(authuserFromPath('/mail/u/0/#inbox')).toBe('0');
  });
  it('defaults to 0 when the path has no slot', () => {
    expect(authuserFromPath('/mail/')).toBe('0');
    expect(authuserFromPath('')).toBe('0');
  });
});

describe('ikFromPage', () => {
  it('prefers GLOBALS[9]', () => {
    const globals = new Array(12).fill(null);
    globals[9] = 'a1b2c3';
    expect(ikFromPage({ GLOBALS: globals }, '')).toBe('a1b2c3');
  });
  it('falls back to an ik parameter in the page html', () => {
    expect(ikFromPage({}, '<a href="/mail/u/0/?ik=deadbeef&view=om">x</a>')).toBe('deadbeef');
  });
  it('ignores a GLOBALS entry that is not a token', () => {
    const globals = new Array(12).fill(null);
    globals[9] = { not: 'a token' };
    expect(ikFromPage({ GLOBALS: globals }, '?ik=cafe01&')).toBe('cafe01');
  });
  it('returns null when neither is available', () => {
    expect(ikFromPage({}, '<html></html>')).toBeNull();
  });
});

describe('resultText', () => {
  it('reports a full success', () => {
    expect(resultText({ ok: true, count: 3, total: 3 })).toBe('3 berichten opgeslagen');
  });
  it('uses the singular for one message', () => {
    expect(resultText({ ok: true, count: 1, total: 1 })).toBe('1 bericht opgeslagen');
  });
  it('reports a partial success', () => {
    expect(resultText({ ok: true, count: 2, total: 3 })).toBe('2 van 3 opgeslagen');
  });
  it('reports the error', () => {
    expect(resultText({ ok: false, count: 0, total: 0, error: 'HTTP 404' })).toBe('Mislukt: HTTP 404');
  });
});

describe('constants', () => {
  it('keeps the strip hidden until a drag arms it', () => {
    expect(ALWAYS_VISIBLE).toBe(false);
    expect(DROPZONE_CSS).toContain('display: none');
    expect(DROPZONE_CSS).toContain('[data-state="armed"] { display: flex');
  });
  it('never lets the strip swallow clicks meant for Gmail', () => {
    // Het loslaten gaat op coördinaten, dus de strip hoeft nooit muis-events te
    // vangen — en mag Gmail dus ook nergens in de weg zitten.
    expect(DROPZONE_CSS).toContain('pointer-events: none');
    expect(DROPZONE_CSS).not.toContain('pointer-events: auto');
  });

  it('scopes every css rule to the dropzone id', () => {
    const selectors = DROPZONE_CSS.split('}')
      .map((b) => b.split('{')[0].trim())
      .filter(Boolean);
    expect(selectors.length).toBeGreaterThan(0);
    for (const s of selectors) expect(s).toContain(`#${DROPZONE_ID}`);
  });
});

// Het loslaten wordt op coördinaten bepaald, niet op het element onder de
// cursor: Gmail tekent daar tijdens het slepen zijn eigen sleepbeeld overheen.
describe('isOverZone', () => {
  const rect = { left: 8, top: 8, right: 900, bottom: 64 };
  it('accepts a point inside the strip', () => {
    expect(isOverZone({ x: 400, y: 30 }, rect)).toBe(true);
  });
  it('accepts the exact edge', () => {
    expect(isOverZone({ x: 8, y: 8 }, rect)).toBe(true);
    expect(isOverZone({ x: 900, y: 64 }, rect)).toBe(true);
  });
  it('rejects a point below or beside the strip', () => {
    expect(isOverZone({ x: 400, y: 200 }, rect)).toBe(false);
    expect(isOverZone({ x: 950, y: 30 }, rect)).toBe(false);
  });
});

describe('movedEnough', () => {
  it('rejects a plain click that barely moves', () => {
    expect(movedEnough({ x: 100, y: 100 }, { x: 103, y: 98 })).toBe(false);
  });
  it('accepts a clear horizontal or vertical move', () => {
    expect(movedEnough({ x: 100, y: 100 }, { x: 120, y: 100 })).toBe(true);
    expect(movedEnough({ x: 100, y: 100 }, { x: 100, y: 60 })).toBe(true);
  });
  it('honours a custom threshold', () => {
    expect(movedEnough({ x: 0, y: 0 }, { x: 5, y: 0 }, 4)).toBe(true);
  });
});
