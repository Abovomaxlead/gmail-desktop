// Which accounts a push watch covers, and until when.

import { describe, it, expect } from 'vitest';
import { PushCoverage } from '../electron/push-coverage';

const at = (t: { now: number }) => new PushCoverage(() => t.now);

describe('PushCoverage', () => {
  it('starts with nothing covered', () => {
    const c = new PushCoverage(() => 100);
    expect(c.has('a@x.nl')).toBe(false);
    expect(c.since('a@x.nl')).toBeNull();
  });

  it('remembers when coverage began', () => {
    const t = { now: 500 };
    const c = at(t);
    c.cover('a@x.nl');
    expect(c.has('a@x.nl')).toBe(true);
    expect(c.since('a@x.nl')).toBe(500);
  });

  it('reports whether the coverage actually changed', () => {
    const c = new PushCoverage(() => 500);
    expect(c.cover('a@x.nl')).toBe(true);
    expect(c.cover('a@x.nl')).toBe(false);
    expect(c.drop('a@x.nl')).toBe(true);
    expect(c.drop('a@x.nl')).toBe(false);
  });

  it('keeps the original moment while coverage holds', () => {
    const t = { now: 500 };
    const c = at(t);
    c.cover('a@x.nl');
    t.now = 900;
    c.cover('a@x.nl');
    expect(c.since('a@x.nl')).toBe(500);
  });

  it('moves the moment forward after coverage was lost and taken back', () => {
    const t = { now: 500 };
    const c = at(t);
    c.cover('a@x.nl');
    c.drop('a@x.nl');
    t.now = 900;
    c.cover('a@x.nl');
    expect(c.since('a@x.nl')).toBe(900);
  });

  it('keeps accounts apart and is case-insensitive on the address', () => {
    const c = new PushCoverage(() => 500);
    c.cover('A@x.nl');
    expect(c.has('a@X.nl')).toBe(true);
    expect(c.has('b@x.nl')).toBe(false);
  });

  it('forgets a removed account entirely', () => {
    const c = new PushCoverage(() => 500);
    c.cover('a@x.nl');
    c.forget('a@x.nl');
    expect(c.has('a@x.nl')).toBe(false);
    expect(c.since('a@x.nl')).toBeNull();
  });

  it('has no memory of a dropped account, so it cannot notify for the gap', () => {
    const c = new PushCoverage(() => 500);
    c.cover('a@x.nl');
    c.drop('a@x.nl');
    expect(c.since('a@x.nl')).toBeNull();
  });
});
