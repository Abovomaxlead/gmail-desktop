// The plan for a tab's right-click menu, and the icons it names.

import { describe, it, expect } from 'vitest';
import { tabMenuSurfaces, tabMenuChoices, planTabMenu } from '../renderer/app/tab-menu';
import { hasClickableItem } from '../renderer/lib/native-menu';
import { APP_SURFACES, SURFACE_CONFIG, type Surface } from '../renderer/lib/surfaces';
import { SURFACE_ICON_DATA_URIS } from '../renderer/lib/surface-icon-data';

describe('tabMenuSurfaces', () => {
  it('offers your own account the calendar and every Google app', () => {
    const out = tabMenuSurfaces({ kind: 'authuser', hasCalendar: true });
    expect(out).toContain('calendar');
    for (const s of APP_SURFACES) expect(out).toContain(s);
  });

  it('never includes mail itself, because this is the list of other places', () => {
    expect(tabMenuSurfaces({ kind: 'authuser', hasCalendar: true })).not.toContain('mail');
  });

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

  it('offers a provisional tab nothing, so no menu opens on it', () => {
    expect(tabMenuSurfaces({ kind: 'authuser', hasCalendar: true, provisional: true })).toEqual([]);
    expect(tabMenuChoices({ kind: 'authuser', hasCalendar: true, provisional: true })).toEqual([]);
    expect(hasClickableItem(planTabMenu('a@x.nl', tabMenuChoices({ kind: 'authuser', hasCalendar: true, provisional: true })))).toBe(false);
  });
});

describe('tabMenuChoices', () => {
  it('offers mail first, so the way back is the way you came', () => {
    expect(tabMenuChoices({ kind: 'authuser', hasCalendar: true })[0]).toBe('mail');
    expect(tabMenuChoices({ kind: 'delegated', hasCalendar: true })).toEqual(['mail', 'calendar']);
  });

  it('keeps every other surface, in the same order as before', () => {
    const p = { kind: 'authuser', hasCalendar: true } as const;
    expect(tabMenuChoices(p)).toEqual(['mail', ...tabMenuSurfaces(p)]);
  });

  it('offers nothing when mail is all the account has', () => {
    expect(tabMenuChoices({ kind: 'delegated', hasCalendar: false })).toEqual([]);
  });
});

describe('planTabMenu', () => {
  const own = tabMenuChoices({ kind: 'authuser', hasCalendar: true });

  it('puts the account name on top and every surface under it', () => {
    const items = planTabMenu('Work', own);
    expect(items[0]).toEqual({ kind: 'text', label: 'Work' });
    expect(items.slice(1).map((i) => (i.kind === 'item' ? i.id : i.kind))).toEqual(own);
  });

  it('labels each surface as the app names it, with its icon', () => {
    const items = planTabMenu('Work', ['drive']);
    expect(items).toContainEqual({
      kind: 'item',
      id: 'drive',
      label: SURFACE_CONFIG.drive.label,
      icon: 'drive',
    });
  });

  it('names an icon for every surface it offers', () => {
    for (const item of planTabMenu('Work', own)) {
      if (item.kind !== 'item') continue;
      expect(item.icon).toBe(item.id);
      expect(SURFACE_ICON_DATA_URIS[item.id as Surface]).toBeTruthy();
    }
  });

  it('plans nothing at all for an account with no surfaces', () => {
    const items = planTabMenu('Shared inbox', tabMenuChoices({ kind: 'delegated', hasCalendar: false }));
    expect(items).toEqual([]);
    expect(hasClickableItem(items)).toBe(false);
  });

  it('is openable for every account that has somewhere to go', () => {
    for (const account of [
      { kind: 'authuser', hasCalendar: true },
      { kind: 'authuser', hasCalendar: false },
      { kind: 'delegated', hasCalendar: true },
    ] as const) {
      expect(hasClickableItem(planTabMenu('x', tabMenuChoices(account)))).toBe(true);
    }
  });
});

describe('SURFACE_ICON_DATA_URIS', () => {
  it('holds nothing but PNG, because a native menu icon cannot be anything else', () => {
    for (const [surface, uri] of Object.entries(SURFACE_ICON_DATA_URIS)) {
      expect(uri, surface).toMatch(/^data:image\/png;base64,/);
    }
  });

  it('covers every surface a tab menu can offer', () => {
    for (const surface of tabMenuChoices({ kind: 'authuser', hasCalendar: true })) {
      expect(SURFACE_ICON_DATA_URIS[surface], surface).toBeTruthy();
    }
  });
});
