// De naad tussen de balk en het main-proces voor uitklapmenu's. De balk is een
// pagina ónder de native Gmail-view, dus een menu dat de pagina zelf tekent valt
// erachter. Main opent daarom een echt OS-menu, dat boven alles staat. De
// renderer bezit de teksten (getStrings) en de accountgegevens, main bezit het
// menu — dus stuurt de renderer wát er moet staan en meldt main wát er gekozen is.
//
// Dit bestand staat onder renderer/ omdat Next.js niets van buiten zijn eigen map
// compileert, terwijl esbuild (main-bundel) en vitest overal vandaan importeren;
// zelfde reden als lib/surfaces.ts. Houd het pure data: geen electron, geen DOM.

// Meer dan deze drie hebben de twee menu's van de balk niet nodig, dus staat er
// ook niet meer in:
// - `item`: aanklikbaar; het id komt terug als de gebruiker het kiest.
// - `separator`: de streep boven de gevonden postbussen.
// - `text`: een regel die alleen iets vertelt — de kop van een menu, "even
//   kijken…", "niets gevonden". Uitgeschakeld, want er is niets te kiezen.
//
// `icon` is de náám van een plaatje, niet het plaatje zelf: main houdt de bitmaps
// (menu-icons.ts) en kent ze onder dezelfde naam. Anders zou er bij elke rechtsklik
// tienduizenden tekens aan base64 door de IPC gaan, en main moet ze toch al één
// keer omzetten en bewaren. Een naam die main niet kent levert simpelweg geen
// icoontje op.
//
// Er is geen "hier sta je nu"-vinkje. In een OS-menu delen een vinkje en een icoon
// dezelfde plek links van het label, en van die twee zegt het product-icoon meer;
// waar het account op staat is bovendien aan het tabblad zelf te zien, dat het
// icoon van zijn actieve surface draagt.
export type NativeMenuItem =
  | { kind: 'item'; id: string; label: string; icon?: string }
  | { kind: 'separator' }
  | { kind: 'text'; label: string };

// Een menu zonder één aanklikbaar item is een lege bak. Beide kanten van de naad
// stellen deze vraag: de balk opent er geen menu voor, en main weigert het ook.
// Dat is niet overdreven — precies dit geval (een gedelegeerd postvak zonder
// agenda-URL, dus niets te kiezen) liet eerder een leeg venster achter.
export function hasClickableItem(items: readonly NativeMenuItem[]): boolean {
  return items.some((i) => i.kind === 'item');
}
