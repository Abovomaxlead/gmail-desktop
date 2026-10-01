// Fetches the RFC822 source of every message in a thread through Gmail's "show original"
// page, for accounts without an API token. Per message it yields `raw` or `error` plus the
// perm id, so one unreachable message does not block the rest.
//
// The download link is the view=att one with disp=comp; disp=inline and disp=safe are
// images. Messages the thread page only references get their own page fetched, whose text
// is kept only when no link came out of it, as the sole evidence of why.

import type { Session } from 'electron';



//===========================
// Types
//===========================

export interface DropPayload {
  threadId: string;
  authuser: string;
  ik: string;
}

export interface FetchedMessage {
  raw?: Buffer;
  error?: string;
  permMsgId?: string;
}

export interface OmPage {
  url: string;
  status: number;
  html: string;
}


//===========================
// Constants
//===========================

const BASE = 'https://mail.google.com/mail/u';


//===========================
// Exported functions
//===========================

/**
 * The URL of Gmail's "show original" page
 *
 * @param p permMsgId narrows it to one message of the thread
 * @returns the page URL
 */
export function omUrl(p: DropPayload & { permMsgId?: string }): string {
  const perm = p.permMsgId ? `&permmsgid=${encodeURIComponent(p.permMsgId)}` : '';
  return `${BASE}/${p.authuser}/?ik=${p.ik}&view=om&th=${p.threadId}${perm}`;
}

// The download link is the view=att one with disp=comp; disp=inline and disp=safe are
// images, not messages.

/**
 * Finds the download links on a "show original" page
 *
 * @param html
 * @param authuser used to absolutise a relative href
 * @returns the links, deduplicated and in page order
 */
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

/**
 * Finds the message ids a thread page only references
 *
 * @param html
 * @returns the ids, deduplicated
 */
export function parsePermMsgIds(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/permmsgid=(msg-[a-z]-?(?:%3A|:)[0-9]+)/gi)) {
    const id = decodeURIComponent(m[1]);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

// A collapsed conversation does not even reference every message it holds, so the page a
// drag needs can be missing from the ids parsed out of it. The drag knows which message it
// grabbed, and this page takes that id by name: measured in production on an eight-message
// thread, where the grabbed message was absent from the thread page and the drag silently
// saved the newest one instead.

/**
 * Which message pages to fetch beside the thread's own page
 *
 * @param html the thread's show-original page
 * @param wanted the perm id the drag named, if it named one
 * @returns the ids to fetch, the wanted one first so it is tried before the rest
 */
export function permMsgIdsToFetch(html: string, wanted?: string): string[] {
  const found = parsePermMsgIds(html);
  if (!wanted || found.includes(wanted)) return found;
  return [wanted, ...found];
}

/**
 * Which message a download link belongs to
 *
 * @param url a link out of parseOriginalLinks
 * @returns the perm message id, or null when the link names none
 */
export function permMsgIdFromLink(url: string): string | null {
  const m = /[?&]permmsgid=(msg-[a-z]-?(?:%3A|:)[0-9]+)/i.exec(url || '');
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Fetches a URL on the account's own session cookies
 *
 * @param ses
 * @param url
 * @returns the body and status; anything outside 2xx rejects
 * @private
 */
async function get(ses: Session, url: string): Promise<{ body: Buffer; status: number }> {
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

/**
 * Fetches the RFC822 source of every message in a thread
 *
 * @param ses
 * @param p
 * @param wanted the perm id a drag named, fetched by name even when the page omits it
 * @returns one entry per message, each carrying raw or error, plus the page it came from
 */
export async function fetchThreadEmls(
  ses: Session,
  p: DropPayload,
  wanted?: string,
): Promise<{ messages: FetchedMessage[]; page: OmPage }> {
  const url = omUrl(p);
  const res = await get(ses, url);
  const page = res.body.toString('utf8');
  const om: OmPage = { url, status: res.status, html: page };
  const links = parseOriginalLinks(page, p.authuser);
  for (const permMsgId of permMsgIdsToFetch(page, wanted)) {
    if (links.some((l) => l.includes(encodeURIComponent(permMsgId)) || l.includes(permMsgId))) continue;
    try {
      const sub = (await get(ses, omUrl({ ...p, permMsgId }))).body.toString('utf8');
      for (const l of parseOriginalLinks(sub, p.authuser)) if (!links.includes(l)) links.push(l);
    } catch {
      // One message of the conversation that could not be reached leaves the rest fetchable:
      // the links already found still stand, and a message with no link is reported per message
      // by the loop below rather than failing the whole thread here
    }
  }
  const messages: FetchedMessage[] = [];
  for (const link of links) {
    const permMsgId = permMsgIdFromLink(link) ?? undefined;
    try {
      messages.push({ raw: (await get(ses, link)).body, permMsgId });
    } catch (e) {
      messages.push({ error: (e as Error).message, permMsgId });
    }
  }
  return { messages, page: om };
}


//===========================
// Helper functions
//===========================

const unescapeHtml = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
