// De dropzone leeft in de Gmail-pagina zelf: drag & drop werkt niet tussen twee
// Electron-views, dus een aparte overlay-view zou nooit een sleep uit de
// berichtenlijst kunnen ontvangen. Dit bestand bevat alleen de pure delen; het
// ophangen aan de DOM staat in preload.ts.
//
// Het slepen wordt met muis-events gevolgd, niet met dragstart/drop. Reden:
// Gmail markeert geen enkel element als draggable (gemeten in de echte pagina:
// 0 van de 39 conversatierijen) en bouwt het slepen zelf na. Native HTML5 drag
// & drop-events vuren daar dus nooit. Loslaten wordt bepaald op coördinaten,
// niet op het element onder de cursor — Gmail tekent daar zijn eigen sleepbeeld.

export const DROPZONE_ID = 'gmd-dropzone';

// Op true staat de strip altijd in beeld, ook zonder sleep. Alleen nuttig om
// te controleren of de injectie werkt; normaal verschijnt hij pas bij een sleep.
export const ALWAYS_VISIBLE = false;

// De strip staat één laag ónder het maximum. Die ene laag is gereserveerd voor
// wat Gmail tijdens het slepen zelf bijtekent — het kaartje "Een gesprek
// verplaatsen" dat de cursor volgt. Stond de strip op het maximum, dan schoof
// dat kaartje eronder zodra je erboven kwam en zag je niet meer wát je
// versleept. Zie liftDragChrome in preload.ts.
export const DROPZONE_Z = 2147483646;
export const DRAG_CHROME_Z = 2147483647;

// Alle regels zijn op #gmd-dropzone gescoped zodat Gmail's eigen stylesheet er
// niet bij kan en wij niets van Gmail raken.
export const DROPZONE_CSS = `
#${DROPZONE_ID} {
  position: fixed; top: 0; left: 0; right: 0; height: 56px;
  display: ${ALWAYS_VISIBLE ? 'flex' : 'none'}; align-items: center; justify-content: center;
  box-sizing: border-box; margin: 8px;
  font: 500 14px/1.2 Roboto, Arial, sans-serif; color: #1a73e8;
  background: rgba(232, 240, 254, 0.97);
  border: 2px dashed #1a73e8; border-radius: 12px;
  z-index: ${DROPZONE_Z}; pointer-events: none;
}
#${DROPZONE_ID}[data-state="armed"] { display: flex; }
#${DROPZONE_ID}[data-state="over"] { display: flex; background: #d2e3fc; border-style: solid; }
#${DROPZONE_ID}[data-state="done"] { display: flex; color: #188038; border-color: #188038; background: rgba(230, 244, 234, 0.97); }
#${DROPZONE_ID}[data-state="failed"] { display: flex; color: #c5221f; border-color: #c5221f; background: rgba(252, 232, 230, 0.97); }
`;

export const DROPZONE_LABEL = 'Sleep hier om de mail op te slaan';

export interface DragNode {
  getAttribute(name: string): string | null;
  textContent?: string | null;
  querySelectorAll?(sel: string): ArrayLike<{ getAttribute(name: string): string | null }>;
  parentElement: DragNode | null;
}

// Gmail zet data-legacy-thread-id niet op de rij maar op de onderwerp-span
// diep daarbinnen (zie findThreadIdBySubject in preload.ts, dat op diezelfde
// span de onderwerptekst leest). `dragstart` vuurt op het element met
// draggable="true" — de rij — dus het id zit altijd ONDER het sleep-doel, nooit
// erboven. Daarom bij elke voorouder ook omlaag kijken.
//
// Omlaag kijken kan te ver gaan: de <table> of <body> bevat élke rij van de
// inbox. Daarom telt een treffer alleen als de voorouder precies één thread-id
// bevat — dan is het zeker de gesleepte rij. Geen Element.closest: de tests
// draaien zonder DOM.
export function threadIdFromDragTarget(el: DragNode | null): string | null {
  let cur = el;
  for (let depth = 0; cur && depth < 30; depth++) {
    const own = cur.getAttribute('data-legacy-thread-id');
    if (own) return own;
    const inside = cur.querySelectorAll?.('[data-legacy-thread-id]');
    if (inside && inside.length > 0) {
      const ids = new Set<string>();
      for (let i = 0; i < inside.length; i++) {
        const id = inside[i].getAttribute('data-legacy-thread-id');
        if (id) ids.add(id);
      }
      if (ids.size === 1) return [...ids][0];
      // Meer dan één: we zijn boven de rij uitgekomen. Verder omhoog levert
      // alleen nog méér rijen op, dus stoppen.
      if (ids.size > 1) return null;
    }
    const next: DragNode | null = cur.parentElement;
    if (next === cur) break;
    cur = next;
  }
  return null;
}

// Een gesleept label of systeemmap uit Gmail's linkernavigatie.
export interface LabelRef {
  hash: string; // route zonder '#', bijv. "label/Klanten" of "inbox"
  name: string; // leesbare naam voor mapnaam en modaltitel
}

// Gmail's systeemmappen. Hun route is geen "label/..."-pad maar een eigen woord.
const SYSTEM_VIEWS: Record<string, string> = {
  inbox: 'Postvak IN',
  starred: 'Met ster',
  snoozed: 'Snoozed',
  sent: 'Verzonden',
  drafts: 'Concepten',
  imp: 'Belangrijk',
  scheduled: 'Gepland',
  all: 'Alle berichten',
  spam: 'Spam',
  trash: 'Prullenbak',
};

// Zoekt vanaf het aangeklikte element omhoog naar de navigatielink eronder.
// Op de href, niet op de zichtbare tekst: die is vertaald en verandert mee met
// de taal van het account.
export function labelFromDragTarget(el: DragNode | null): LabelRef | null {
  let cur = el;
  for (let depth = 0; cur && depth < 30; depth++) {
    const href = cur.getAttribute('href');
    const hash = href && href.includes('#') ? href.slice(href.indexOf('#') + 1) : '';
    if (hash) {
      // Paginasuffix hoort niet bij de identiteit van het label.
      const route = hash.replace(/\/p\d+$/, '');
      if (/^label\//i.test(route)) {
        const raw = route.slice('label/'.length);
        let name = raw;
        try {
          name = decodeURIComponent(raw);
        } catch {
          // Kapotte percent-codering: dan de ruwe vorm, beter dan niets.
        }
        // Gmail schrijft genestelde labels als "Klanten/2026"; de laatste stap
        // is de naam die de gebruiker ziet.
        if (name) return { hash: route, name: name.split('/').filter(Boolean).pop() || name };
      }
      const system = SYSTEM_VIEWS[route.toLowerCase()];
      if (system) return { hash: route.toLowerCase(), name: system };
    }
    const next: DragNode | null = cur.parentElement;
    if (next === cur) break;
    cur = next;
  }
  return null;
}

export interface DocLike {
  querySelectorAll(sel: string): ArrayLike<DragNode>;
}

// Gmail sleept de hele selectie mee, niet alleen de rij onder je cursor. De
// aangevinkte rijen zijn te vinden via hun checkbox — op rol en aria-status,
// niet op Gmail's vervormde klassenamen, en taalonafhankelijk.
export function selectedThreadIds(doc: DocLike): string[] {
  const boxes = doc.querySelectorAll('[role="checkbox"][aria-checked="true"]');
  const ids: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    const id = threadIdFromDragTarget(boxes[i]);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

// Welke conversaties horen bij deze sleep: de hele selectie als de ingedrukte
// rij daarin zit, anders alleen die ene rij — net als Gmail zelf doet.
export function threadIdsForDrag(pressed: string, selected: string[]): string[] {
  return selected.includes(pressed) ? selected : [pressed];
}

// Het element dat het thread-id draagt is Gmail's onderwerp-span, dus de
// onderwerptekst staat er al in. Daardoor weet de modal meteen wélke mails je
// versleept, zonder te wachten op het ophalen van de originelen.
export function threadSubjects(doc: DocLike): Record<string, string> {
  const els = doc.querySelectorAll('[data-legacy-thread-id]');
  const out: Record<string, string> = {};
  for (let i = 0; i < els.length; i++) {
    const id = els[i].getAttribute('data-legacy-thread-id');
    if (!id || out[id]) continue;
    const text = (els[i].textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text) out[id] = text;
  }
  return out;
}

export const NO_SUBJECT = '(geen onderwerp)';

export function itemsForDrag(
  ids: string[],
  subjects: Record<string, string>,
): Array<{ threadId: string; subject: string }> {
  return ids.map((threadId) => ({ threadId, subject: subjects[threadId] || NO_SUBJECT }));
}

export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function isOverZone(p: Point, r: Rect): boolean {
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

// Een sleep telt pas als de muis een eind heeft afgelegd; anders zou een gewone
// klik op een rij al als sleep gelden.
export const DRAG_THRESHOLD = 15;
export function movedEnough(from: Point, to: Point, min = DRAG_THRESHOLD): boolean {
  return Math.abs(to.x - from.x) >= min || Math.abs(to.y - from.y) >= min;
}

export function authuserFromPath(pathname: string): string {
  return (/\/mail\/u\/(\d+)/.exec(pathname || '') ?? [])[1] ?? '0';
}

// `ik` is Gmail's per-sessie requesttoken; zonder dat token weigert de
// origineel-weergeven-URL. Gmail zet 'm in GLOBALS[9]; als dat verandert
// blijft de token nog te vinden in een willekeurige Gmail-URL op de pagina.
export function ikFromPage(win: { GLOBALS?: unknown }, html: string): string | null {
  const g = win.GLOBALS;
  if (Array.isArray(g) && typeof g[9] === 'string' && /^[0-9a-f]{4,}$/i.test(g[9])) return g[9];
  const m = /[?&]ik=([0-9a-f]{4,})/i.exec(html || '');
  return m ? m[1] : null;
}

export function resultText(r: { ok: boolean; count: number; total: number; error?: string }): string {
  if (!r.ok) return `Mislukt: ${r.error ?? 'onbekende fout'}`;
  if (r.count < r.total) return `${r.count} van ${r.total} opgeslagen`;
  return `${r.count} bericht${r.count === 1 ? '' : 'en'} opgeslagen`;
}
