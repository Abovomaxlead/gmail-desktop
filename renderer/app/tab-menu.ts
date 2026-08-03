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
  // Een tab uit de onthouden balk, waarvan de identiteit nog niet vaststaat.
  provisional?: boolean;
}

// Waar dit account nog naartoe kan, buiten de post om.
export function tabMenuSurfaces(p: TabMenuAccount): Surface[] {
  const out: Surface[] = [];
  // Een voorlopige tab heeft nergens een url voor: main kent het sessieslot niet en
  // opent dus niets — ook niet zijn post. Een menu vol keuzes die allemaal niets
  // doen is erger dan geen menu, dus valt het hier weg (de aanroeper laat een leeg
  // menu al dicht).
  if (p.provisional) return out;
  // Agenda alleen als er een is: bij een gedelegeerd postvak hangt dat af van
  // wat Google's accountwisselaar heeft prijsgegeven.
  if (p.hasCalendar) out.push('calendar');
  // Drive, Docs en de rest bestaan alleen voor je eigen accounts; voor een
  // gedelegeerd postvak gooit het bouwen van die url's een fout.
  if (p.kind === 'authuser') out.push(...APP_SURFACES);
  return out;
}

// Wat er werkelijk in het menu komt, in volgorde. Eén lijst voor het menu én voor
// het nakijken van de keuze die terugkomt, zodat die twee niet uiteen kunnen lopen.
//
// De post staat vooraan. Dat was eerst niet zo — "daarvoor klik je het tabblad zelf
// aan" — maar wie via dit menu naar de agenda gaat, zoekt de weg terug ook hier, en
// aan een tabblad dat al opgelicht staat is niet te zien dat je erop moet klikken.
// De weg heen en de weg terug horen dezelfde te zijn.
//
// Heeft een account niets anders dan post, dan blijft het menu dicht: er is dan
// nergens naartoe te gaan, en "Mail" aanbieden terwijl je er al bent is een menu
// dat niets doet.
export function tabMenuChoices(p: TabMenuAccount): Surface[] {
  const others = tabMenuSurfaces(p);
  return others.length === 0 ? [] : ['mail', ...others];
}

// Het menu zelf: de naam van het account als kop, daarna de keuzes met hun
// product-icoon. Het id van een item ís de surface, dus hoeft er niets vertaald te
// worden als de keuze terugkomt.
//
// Geen keuzes betekent geen menu: een gedelegeerd postvak waarvan Google nooit een
// agenda-URL prijsgaf heeft niets te kiezen, en een menu met alleen een kop is
// een lege bak. Daarom valt hier ook de kop weg — de aanroeper hoeft maar één
// ding te controleren.
export function planTabMenu(label: string, surfaces: readonly Surface[]): NativeMenuItem[] {
  if (surfaces.length === 0) return [];
  return [
    { kind: 'text', label },
    ...surfaces.map((s): NativeMenuItem => ({
      kind: 'item',
      id: s,
      label: SURFACE_CONFIG[s].label,
      // Het product-icoon, net als in het uitklapmenu. Alleen de naam: main heeft
      // de bitmaps. Die naam is de surface zelf, dus valt er niets te vertalen.
      icon: s,
    })),
  ];
}
