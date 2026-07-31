// Een label uit Gmail's linkernavigatie naar de dropzone slepen. Herkenning
// gaat via de href van de navigatielink (`#label/<naam>`), niet via Gmail's
// vervormde klassenamen of zichtbare tekst — dat is taalonafhankelijk en
// overleeft een verbouwing van de navigatie.
import type { DragNode } from './dropzone';

export interface LabelThread {
  threadId: string;
  subject: string;
}

// Gmail's eigen paginagrootte in de lijstweergave. Alleen gebruikt om te
// beslissen of er nog een volgende pagina kan zijn.
export const PAGE_SIZE = 50;

// Bovengrens op wat één labelsleep oplevert. Zonder grens zou een label met
// duizenden mails de app minutenlang bezig houden en de map volgooien. Wordt
// gemeld zodra hij bijt — stil afkappen leest als "alles opgeslagen".
export const MAX_THREADS = 200;
export const MAX_PAGES = Math.ceil(MAX_THREADS / PAGE_SIZE);

export function labelFromHref(href: string): string | null {
  const m = /#label\/([^/?#]+)/.exec(href || '');
  if (!m) return null;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, ' ')) || null;
  } catch {
    return m[1] || null;
  }
}

// Loopt omhoog naar de navigatielink onder de cursor. Alleen echte labels: het
// postvak, verzonden items en dergelijke hebben geen `#label/`-href.
export function labelFromDragTarget(el: DragNode | null): string | null {
  let cur = el;
  for (let depth = 0; cur && depth < 30; depth++) {
    const href = cur.getAttribute('href');
    if (href) {
      const label = labelFromHref(href);
      if (label) return label;
    }
    const next: DragNode | null = cur.parentElement;
    if (next === cur) break;
    cur = next;
  }
  return null;
}

// De lijstweergave van een label, pagina 1 heeft geen achtervoegsel.
export function labelListUrl(authuser: string, label: string, page: number): string {
  const enc = encodeURIComponent(label).replace(/%2F/gi, '/');
  const suffix = page > 1 ? `/p${page}` : '';
  return `https://mail.google.com/mail/u/${authuser}/#label/${enc}${suffix}`;
}

// Voegt een gescrapete pagina toe aan wat we al hebben. Geeft terug hoeveel er
// nieuw waren, zodat de aanroeper weet of doorbladeren nog zin heeft: Gmail
// toont bij een te hoog paginanummer gewoon de laatste pagina opnieuw.
export function mergeThreads(
  acc: LabelThread[],
  page: LabelThread[],
): { added: number; total: number } {
  const seen = new Set(acc.map((t) => t.threadId));
  let added = 0;
  for (const t of page) {
    if (!t.threadId || seen.has(t.threadId)) continue;
    if (acc.length >= MAX_THREADS) break;
    seen.add(t.threadId);
    acc.push(t);
    added += 1;
  }
  return { added, total: acc.length };
}

// Draait in de Gmail-pagina en leest de zichtbare lijst uit. Zelfde bron als de
// losse sleep: het element met data-legacy-thread-id is de onderwerp-span.
export const LABEL_SCRAPE_JS = `(() => {
  var out = [];
  var seen = {};
  var els = document.querySelectorAll('[data-legacy-thread-id]');
  for (var i = 0; i < els.length; i++) {
    var id = els[i].getAttribute('data-legacy-thread-id');
    if (!id || seen[id]) continue;
    seen[id] = 1;
    out.push({ threadId: id, subject: (els[i].textContent || '').replace(/\\s+/g, ' ').trim() });
  }
  return out;
})()`;
