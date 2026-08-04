import { describe, it, expect } from 'vitest';
import { WarmupTracker, WARMUP_CAP_MS, WARMUP_SETTLE_MS } from '../electron/view-warmup';

const LOADED = 'Inbox (2) - user@example.com - Gmail';
const BARE = 'Gmail';

describe('WarmupTracker', () => {
  it('keeps a fresh warm-up waiting', () => {
    const t = new WarmupTracker();
    t.begin('u0', 1000);
    expect(t.verdict('u0', BARE, 1000)).toBe('wait');
    expect(t.pending()).toEqual(['u0']);
  });

  it('waits out the settle margin after the title lands, then cools', () => {
    const t = new WarmupTracker();
    t.begin('u0', 1000);
    // De titel slaat om terwijl de lijst nog kan tekenen: nog niet koelen.
    expect(t.verdict('u0', LOADED, 2000)).toBe('wait');
    expect(t.verdict('u0', LOADED, 2000 + WARMUP_SETTLE_MS - 1)).toBe('wait');
    expect(t.verdict('u0', LOADED, 2000 + WARMUP_SETTLE_MS)).toBe('cool');
  });

  it('remembers the ready moment even if the title changes back', () => {
    const t = new WarmupTracker();
    t.begin('u0', 1000);
    t.verdict('u0', LOADED, 2000); // klaar gemeld
    // Gmail zet de titel tijdens een navigatie soms kort terug; de nazak-marge
    // loopt vanaf het eerste klaar-signaal en niet opnieuw.
    expect(t.verdict('u0', BARE, 2000 + WARMUP_SETTLE_MS)).toBe('cool');
  });

  it('cools on the cap when the mailbox never loads', () => {
    const t = new WarmupTracker();
    t.begin('u0', 1000);
    expect(t.verdict('u0', BARE, 1000 + WARMUP_CAP_MS - 1)).toBe('wait');
    expect(t.verdict('u0', BARE, 1000 + WARMUP_CAP_MS)).toBe('cool');
  });

  it('tolerates a missing title (view torn down mid-warm-up)', () => {
    const t = new WarmupTracker();
    t.begin('u0', 1000);
    expect(t.verdict('u0', null, 2000)).toBe('wait');
  });

  it('never warms the same key twice', () => {
    const t = new WarmupTracker();
    expect(t.begin('u0', 1000)).toBe(true);
    expect(t.begin('u0', 5000)).toBe(false);
    // De bovengrens loopt vanaf de eerste keer, dus de tweede poging schuift niets op.
    expect(t.verdict('u0', BARE, 1000 + WARMUP_CAP_MS)).toBe('cool');
  });

  it('does not warm a key again after it finished', () => {
    const t = new WarmupTracker();
    t.begin('u0', 1000);
    t.finish('u0');
    expect(t.pending()).toEqual([]);
    expect(t.begin('u0', 9000)).toBe(false);
  });

  it('reports unknown for a key it never saw', () => {
    const t = new WarmupTracker();
    expect(t.verdict('u3', LOADED, 1000)).toBe('unknown');
  });

  it('tracks several accounts independently', () => {
    const t = new WarmupTracker();
    t.begin('u0', 1000);
    t.begin('d:shared@example.com', 3000);
    expect(t.pending()).toEqual(['u0', 'd:shared@example.com']);
    t.verdict('u0', LOADED, 3000);
    expect(t.verdict('u0', LOADED, 3000 + WARMUP_SETTLE_MS)).toBe('cool');
    t.finish('u0');
    expect(t.pending()).toEqual(['d:shared@example.com']);
    expect(t.verdict('d:shared@example.com', BARE, 3000 + WARMUP_SETTLE_MS)).toBe('wait');
  });
});
