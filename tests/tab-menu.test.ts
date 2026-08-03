import { describe, it, expect } from 'vitest';
import { tabMenuSurfaces, tabMenuLeft, TAB_MENU_WIDTH } from '../renderer/app/tab-menu';
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

describe('tabMenuLeft', () => {
  it('opens at the cursor when there is room to the right', () => {
    expect(tabMenuLeft(100, 1200)).toBe(100);
  });

  // Een tabblad bij de rechterrand is de normale plek bij een paar accounts, en
  // daar viel het menu half buiten het venster.
  it('flips leftwards when the menu would run past the right edge', () => {
    expect(tabMenuLeft(1100, 1200)).toBe(1100 - TAB_MENU_WIDTH);
  });

  it('keeps the whole menu inside the window either way', () => {
    for (const x of [0, 4, 200, 599, 800, 995, 1000]) {
      const left = tabMenuLeft(x, 1000);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + TAB_MENU_WIDTH).toBeLessThanOrEqual(1000);
    }
  });

  // Precies passen mag aan de cursor blijven staan; één pixel te veel niet.
  it('flips exactly at the point where the margin no longer fits', () => {
    const viewport = 1000;
    const lastFitting = viewport - TAB_MENU_WIDTH - 4;
    expect(tabMenuLeft(lastFitting, viewport)).toBe(lastFitting);
    expect(tabMenuLeft(lastFitting + 1, viewport)).toBe(lastFitting + 1 - TAB_MENU_WIDTH);
  });

  it('falls back to the left edge in a window narrower than the menu', () => {
    expect(tabMenuLeft(80, 150)).toBe(4);
  });
});
