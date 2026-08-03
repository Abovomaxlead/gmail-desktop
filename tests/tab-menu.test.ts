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

  // Deze lijst is "waar kan dit account nog naartoe", dus zonder post. Of de post
  // in het menu komt, beslist tabMenuChoices — en dat doet hij.
  it('never includes mail itself, because this is the list of other places', () => {
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

  // Een tab uit de onthouden balk heeft nog geen sessieslot, dus is er geen url om
  // heen te gaan — ook niet naar Drive. Geen keuzes betekent geen menu.
  it('offers a provisional tab nothing, so no menu opens on it', () => {
    expect(tabMenuSurfaces({ kind: 'authuser', hasCalendar: true, provisional: true })).toEqual([]);
    expect(tabMenuChoices({ kind: 'authuser', hasCalendar: true, provisional: true })).toEqual([]);
    expect(hasClickableItem(planTabMenu('a@x.nl', tabMenuChoices({ kind: 'authuser', hasCalendar: true, provisional: true })))).toBe(false);
  });
});

describe('tabMenuChoices', () => {
  // De klacht: via het menu naar de agenda, en dan is de weg terug niet te vinden —
  // een tabblad dat al opgelicht staat ziet er niet aanklikbaar uit. Heen en terug
  // horen dezelfde weg te zijn, dus staat de post nu ook in het menu.
  it('offers mail first, so the way back is the way you came', () => {
    expect(tabMenuChoices({ kind: 'authuser', hasCalendar: true })[0]).toBe('mail');
    expect(tabMenuChoices({ kind: 'delegated', hasCalendar: true })).toEqual(['mail', 'calendar']);
  });

  it('keeps every other surface, in the same order as before', () => {
    const p = { kind: 'authuser', hasCalendar: true } as const;
    expect(tabMenuChoices(p)).toEqual(['mail', ...tabMenuSurfaces(p)]);
  });

  // Alleen post en niets anders: dan valt er niets te kiezen. "Mail" aanbieden waar
  // je al bent is een menu dat niets doet, en dat menu ging eerder juist niet open.
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

  // Het id ís de surface, zodat de balk de keuze niet hoeft te vertalen; het
  // label komt uit dezelfde bron als het uitklapmenu gebruikte, en het icoon is
  // een naam die main opzoekt (niet de bitmap zelf).
  it('labels each surface as the app names it, with its icon', () => {
    const items = planTabMenu('Work', ['drive']);
    expect(items).toContainEqual({
      kind: 'item',
      id: 'drive',
      label: SURFACE_CONFIG.drive.label,
      icon: 'drive',
    });
  });

  // Het icoon is een naam die main opzoekt, niet de bitmap: die hoeft niet bij elke
  // rechtsklik door de IPC. Elke regel hoort er een te hebben, anders staat er één
  // kale tussen de andere.
  it('names an icon for every surface it offers', () => {
    for (const item of planTabMenu('Work', own)) {
      if (item.kind !== 'item') continue;
      expect(item.icon).toBe(item.id);
      expect(SURFACE_ICON_DATA_URIS[item.id as Surface]).toBeTruthy();
    }
  });

  // Critical 1 in een nieuwe jas: een gedelegeerd postvak zonder agenda-URL heeft
  // niets te kiezen. Zonder deze regel bleef de kop over en opende er een leeg
  // menu — precies het geval dat eerder een leeg venster achterliet.
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
  // Electrons nativeImage leest alleen PNG en JPEG. Een icoon in een ander formaat
  // (het agenda-icoon was een WebP) geeft geen fout maar een leeg plaatje, en dus
  // een menu-item zonder icoontje. Daarom vragen we het hier hardop.
  it('holds nothing but PNG, because a native menu icon cannot be anything else', () => {
    for (const [surface, uri] of Object.entries(SURFACE_ICON_DATA_URIS)) {
      expect(uri, surface).toMatch(/^data:image\/png;base64,/);
    }
  });

  // Inclusief mail, sinds de weg terug in het menu staat: één regel zonder icoontje
  // tussen acht met is precies het rommeltje dat dit voorkomt.
  it('covers every surface a tab menu can offer', () => {
    for (const surface of tabMenuChoices({ kind: 'authuser', hasCalendar: true })) {
      expect(SURFACE_ICON_DATA_URIS[surface], surface).toBeTruthy();
    }
  });
});
