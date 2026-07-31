import { describe, expect, it } from 'vitest';
import { notificationOptionsFor } from '../electron/preload';

// The gate pushed from main (NotifyState) styles the notifications Gmail and
// Calendar fire from the page. `silent` drops the sound; `persist` maps to the
// web API's requireInteraction, which Electron turns into timeoutType 'never'
// (a scenario="reminder" toast on Windows) so the toast waits to be dismissed.
describe('notificationOptionsFor', () => {
  const base: NotificationOptions = { body: 'New mail from Ada' };

  it('passes the page options through untouched when nothing is set', () => {
    expect(notificationOptionsFor({ show: true, silent: false, persist: false }, base)).toEqual(base);
  });

  it('adds requireInteraction when persist is on', () => {
    const out = notificationOptionsFor({ show: true, silent: false, persist: true }, base);
    expect(out).toEqual({ body: 'New mail from Ada', requireInteraction: true });
  });

  it('leaves requireInteraction off when persist is off', () => {
    const out = notificationOptionsFor({ show: true, silent: false, persist: false }, base);
    expect(out).not.toHaveProperty('requireInteraction');
  });

  it('combines silent and persist', () => {
    const out = notificationOptionsFor({ show: true, silent: true, persist: true }, base);
    expect(out).toEqual({ body: 'New mail from Ada', silent: true, requireInteraction: true });
  });

  it('still adds requireInteraction when the page passed no options at all', () => {
    expect(notificationOptionsFor({ show: true, silent: false, persist: true }, undefined)).toEqual({
      requireInteraction: true,
    });
  });

  it('overrides a page-set requireInteraction:false', () => {
    const out = notificationOptionsFor({ show: true, silent: false, persist: true }, {
      ...base,
      requireInteraction: false,
    });
    expect(out).toMatchObject({ requireInteraction: true });
  });
});
