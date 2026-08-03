import { describe, it, expect } from 'vitest';
import { tabMenuSurfaces } from '../renderer/app/tab-menu';
import { APP_SURFACES } from '../renderer/lib/surfaces';

describe('tabMenuSurfaces', () => {
  it('offers your own account the calendar and every Google app', () => {
    const out = tabMenuSurfaces({ kind: 'authuser', hasCalendar: true });
    expect(out).toContain('calendar');
    for (const s of APP_SURFACES) expect(out).toContain(s);
  });

  // Mail is het tabblad zelf; dat hoort niet ook nog in zijn eigen menu.
  it('never offers mail, because clicking the tab already does that', () => {
    expect(tabMenuSurfaces({ kind: 'authuser', hasCalendar: true })).not.toContain('mail');
  });

  // Een gedelegeerd postvak is iemand anders' inbox: Drive en de rest horen
  // daar niet bij, en de agenda alleen als Google's switcher er een gaf.
  it('offers a delegated mailbox only its calendar', () => {
    expect(tabMenuSurfaces({ kind: 'delegated', hasCalendar: true })).toEqual(['calendar']);
  });

  it('offers a delegated mailbox without a captured calendar nothing at all', () => {
    expect(tabMenuSurfaces({ kind: 'delegated', hasCalendar: false })).toEqual([]);
  });

  it('leaves out the calendar for an own account that has none', () => {
    expect(tabMenuSurfaces({ kind: 'authuser', hasCalendar: false })).not.toContain('calendar');
  });

  it('puts the calendar first, where the sidebar had it', () => {
    expect(tabMenuSurfaces({ kind: 'authuser', hasCalendar: true })[0]).toBe('calendar');
  });
});
