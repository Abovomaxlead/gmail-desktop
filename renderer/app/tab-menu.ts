import { APP_SURFACES, SURFACE_CONFIG, type Surface } from '../lib/surfaces';
import type { NativeMenuItem } from '../lib/native-menu';

// Wat er in het rechtsklikmenu op een tabblad komt. Puur, zodat het te testen is
// zonder de balk te tekenen; main maakt er een echt OS-menu van. Waar het menu
// opengaat staat hier niet meer: een OS-menu komt zelf op de cursor te staan en
// houdt zichzelf binnen het scherm.
//
// In de zijbalk stonden deze knoppen zichtbaar naast elk account; in de balk zou
// dat te vol worden.
//
// De renderer kent de AccountRef niet — main stuurt alleen `kind` en
// `hasCalendar` mee — dus dit werkt op die twee velden. De regels zijn dezelfde
// die de zijbalk inline gebruikte.
export interface TabMenuAccount {
  kind: 'authuser' | 'delegated';
  hasCalendar: boolean;
}

export function tabMenuSurfaces(p: TabMenuAccount): Surface[] {
  const out: Surface[] = [];
  // Agenda alleen als er een is: bij een gedelegeerd postvak hangt dat af van
  // wat Google's accountwisselaar heeft prijsgegeven.
  if (p.hasCalendar) out.push('calendar');
  // Drive, Docs en de rest bestaan alleen voor je eigen accounts; voor een
  // gedelegeerd postvak gooit het bouwen van die url's een fout.
  if (p.kind === 'authuser') out.push(...APP_SURFACES);
  // `mail` staat er bewust niet in: daarvoor klik je het tabblad zelf aan.
  return out;
}

// Het menu zelf: de naam van het account als kop, daarna zijn surfaces. Het id
// van een item ís de surface, dus hoeft er niets vertaald te worden als de keuze
// terugkomt.
//
// Geen items betekent geen menu: een gedelegeerd postvak waarvan Google nooit een
// agenda-URL prijsgaf heeft niets te kiezen, en een menu met alleen een kop is
// een lege bak. Daarom valt hier ook de kop weg — de aanroeper hoeft maar één
// ding te controleren.
export function planTabMenu(
  label: string,
  surfaces: readonly Surface[],
  activeSurface: Surface | null,
): NativeMenuItem[] {
  if (surfaces.length === 0) return [];
  return [
    { kind: 'text', label },
    ...surfaces.map((s): NativeMenuItem => ({
      kind: 'item',
      id: s,
      label: SURFACE_CONFIG[s].label,
      // Waar dit account nu staat. In het uitklapmenu was dat een gevulde
      // achtergrond; een OS-menu zet er een vinkje bij.
      ...(s === activeSurface ? { checked: true } : {}),
    })),
  ];
}
