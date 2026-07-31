import type { Session } from 'electron';

export interface DropPayload {
  threadId: string;
  authuser: string;
  ik: string;
}

export interface FetchedMessage {
  raw?: Buffer;
  error?: string;
}

const BASE = 'https://mail.google.com/mail/u';

export function omUrl(p: DropPayload & { permMsgId?: string }): string {
  const perm = p.permMsgId ? `&permmsgid=${encodeURIComponent(p.permMsgId)}` : '';
  return `${BASE}/${p.authuser}/?ik=${p.ik}&view=om&th=${p.threadId}${perm}`;
}

const unescapeHtml = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

// De "Origineel downloaden"-link op de om-pagina: view=att met disp=comp. Een
// inline bijlage (disp=inline / disp=safe) is een plaatje, geen bericht.
export function parseOriginalLinks(html: string, authuser: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/href\s*=\s*"([^"]+)"/gi)) {
    const href = unescapeHtml(m[1]);
    if (!/[?&]view=att\b/.test(href) || !/[?&]disp=comp\b/.test(href)) continue;
    const abs = href.startsWith('http') ? href : `${BASE}/${authuser}/${href.replace(/^\.?\//, '')}`;
    if (!out.includes(abs)) out.push(abs);
  }
  return out;
}

export function parsePermMsgIds(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/permmsgid=(msg-[a-z]-?(?:%3A|:)[0-9]+)/gi)) {
    const id = decodeURIComponent(m[1]);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

async function get(ses: Session, url: string): Promise<{ body: Buffer; status: number }> {
  // Lui geladen: dit bestand moet ook onder Vitest (zonder Electron) te
  // importeren zijn voor de pure functies hierboven.
  const { net } = require('electron') as typeof import('electron');
  return await new Promise<{ body: Buffer; status: number }>((resolve, reject) => {
    const req = net.request({ url, session: ses, useSessionCookies: true });
    req.on('response', (res) => {
      const status = res.statusCode;
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        if (status < 200 || status >= 300) reject(new Error(`HTTP ${status}`));
        else resolve({ body: Buffer.concat(chunks), status });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

// Wat de om-pagina opleverde. Alleen nodig als er geen enkele link uit kwam:
// dan is dit het enige bewijsmateriaal over waarom niet.
export interface OmPage {
  url: string;
  status: number;
  html: string;
}

// Haalt de originelen van alle berichten in de conversatie op. Levert per
// bericht óf `raw`, óf `error` — één mislukt bericht laat de rest doorgaan.
export async function fetchThreadEmls(
  ses: Session,
  p: DropPayload,
): Promise<{ messages: FetchedMessage[]; page: OmPage }> {
  const url = omUrl(p);
  const res = await get(ses, url);
  const page = res.body.toString('utf8');
  const om: OmPage = { url, status: res.status, html: page };
  const links = parseOriginalLinks(page, p.authuser);
  // Berichten waarvan de threadpagina alleen een verwijzing bevat: hun eigen
  // om-pagina heeft de download-link wel.
  for (const permMsgId of parsePermMsgIds(page)) {
    if (links.some((l) => l.includes(encodeURIComponent(permMsgId)) || l.includes(permMsgId))) continue;
    try {
      const sub = (await get(ses, omUrl({ ...p, permMsgId }))).body.toString('utf8');
      for (const l of parseOriginalLinks(sub, p.authuser)) if (!links.includes(l)) links.push(l);
    } catch {
      // Eén onbereikbaar deelbericht mag de rest niet blokkeren.
    }
  }
  const messages: FetchedMessage[] = [];
  for (const link of links) {
    try {
      messages.push({ raw: (await get(ses, link)).body });
    } catch (e) {
      messages.push({ error: (e as Error).message });
    }
  }
  return { messages, page: om };
}
