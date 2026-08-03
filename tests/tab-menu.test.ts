import { describe, it, expect } from 'vitest';
import { tabMenuSurfaces, planTabMenu } from '../renderer/app/tab-menu';
import { hasClickableItem } from '../renderer/lib/native-menu';
import { APP_SURFACES, SURFACE_CONFIG } from '../renderer/lib/surfaces';

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

describe('planTabMenu', () => {
  const own = tabMenuSurfaces({ kind: 'authuser', hasCalendar: true });

  it('puts the account name on top and every surface under it', () => {
    const items = planTabMenu('Work', own, null);
    expect(items[0]).toEqual({ kind: 'text', label: 'Work' });
    expect(items.slice(1).map((i) => (i.kind === 'item' ? i.id : i.kind))).toEqual(own);
  });

  // Het id ís de surface, zodat de balk de keuze niet hoeft te vertalen; het
  // label komt uit dezelfde bron als het uitklapmenu gebruikte.
  it('labels each surface as the app names it', () => {
    const items = planTabMenu('Work', ['drive'], null);
    expect(items).toContainEqual({ kind: 'item', id: 'drive', label: SURFACE_CONFIG.drive.label });
  });

  // Waar het account nu staat: in het uitklapmenu een gevulde achtergrond, in een
  // OS-menu een vinkje. Alleen op dat ene item, anders krijgt elke regel een hokje.
  it('ticks only the surface the account is currently on', () => {
    const items = planTabMenu('Work', own, 'drive');
    const ticked = items.filter((i) => i.kind === 'item' && i.checked);
    expect(ticked).toEqual([{ kind: 'item', id: 'drive', label: SURFACE_CONFIG.drive.label, checked: true }]);
  });

  it('ticks nothing when the account is showing a surface that is not in the menu', () => {
    const items = planTabMenu('Work', own, 'mail');
    expect(items.some((i) => i.kind === 'item' && i.checked)).toBe(false);
  });

  // Critical 1 in een nieuwe jas: een gedelegeerd postvak zonder agenda-URL heeft
  // niets te kiezen. Zonder deze regel bleef de kop over en opende er een leeg
  // menu — precies het geval dat eerder een leeg venster achterliet.
  it('plans nothing at all for an account with no surfaces', () => {
    const items = planTabMenu('Shared inbox', tabMenuSurfaces({ kind: 'delegated', hasCalendar: false }), null);
    expect(items).toEqual([]);
    expect(hasClickableItem(items)).toBe(false);
  });

  it('is openable for every account that does have a surface', () => {
    for (const account of [
      { kind: 'authuser', hasCalendar: true },
      { kind: 'authuser', hasCalendar: false },
      { kind: 'delegated', hasCalendar: true },
    ] as const) {
      expect(hasClickableItem(planTabMenu('x', tabMenuSurfaces(account), null))).toBe(true);
    }
  });
});
