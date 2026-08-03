// Gmail API, alleen wat we nodig hebben. De pure delen (url's, antwoorden lezen)
// staan hier zodat ze te testen zijn; `electron` wordt lui geladen in de functies
// die het netwerk op gaan.

import { randomBytes } from 'node:crypto';

export const LABELS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/labels';

// messages.insert zet een bestaand bericht in een postvak zonder het te
// versturen — precies wat kopiëren naar een ander account is. Via het
// upload-endpoint met een multipart-body, want dan mogen de labels mee in de
// metadata én is de bovengrens 50 MB in plaats van de paar MB die een
// base64-in-json-verzoek aankan.
//
// internalDateSource=dateHeader: zonder dat staat de kopie in het andere
// postvak op vandaag in plaats van op de oorspronkelijke datum.
export const INSERT_URL =
  'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages' +
  '?uploadType=multipart&internalDateSource=dateHeader';

export interface GmailLabel {
  id: string;
  name: string;
}

// Systeemlabels waar je een bericht zinnig in kunt zetten. De rest van Gmail's
// systeemlabels is geen doel om naartoe te kopiëren: CATEGORY_* zijn de tabbladen
// van het postvak, en DRAFT/SENT/SPAM/TRASH/UNREAD zijn statussen.
const SYSTEM_TARGETS = new Set(['INBOX', 'STARRED', 'IMPORTANT']);

// Netter dan Gmail's schreeuwletters voor de labels die we wél tonen.
const SYSTEM_NAMES: Record<string, string> = {
  INBOX: 'Postvak IN',
  STARRED: 'Met sterren',
  IMPORTANT: 'Belangrijk',
};

export interface RawLabel extends GmailLabel {
  type: string;
}

// Alles wat het antwoord bevat, ongefilterd. parseLabels hieronder houdt er de
// labels uit over waar je iets naartoe kunt kopiëren; voor het opzoeken van een
// gesleept label heb je juist de hele lijst nodig.
export function parseAllLabels(json: unknown): RawLabel[] {
  const raw = (json as { labels?: unknown })?.labels;
  if (!Array.isArray(raw)) return [];
  const out: RawLabel[] = [];
  for (const l of raw) {
    const id = typeof l?.id === 'string' ? l.id : '';
    const name = typeof l?.name === 'string' ? l.name : '';
    if (!id || !name) continue;
    out.push({ id, name, type: typeof l?.type === 'string' ? l.type : '' });
  }
  return out;
}

// Gmail's url schrijft het label zoals het heet, inclusief het pad van een
// genesteld label ("Klanten/2026"). Eerst letterlijk zoeken; pas als dat niets
// oplevert hoofdletterongevoelig, want twee labels die alleen in hoofdletters
// verschillen mogen niet door elkaar lopen.
export function findLabelId(labels: RawLabel[], name: string): string | null {
  const want = (name ?? '').trim();
  if (!want) return null;
  const exact = labels.find((l) => l.name === want);
  if (exact) return exact.id;
  const lower = want.toLowerCase();
  return labels.find((l) => l.name.toLowerCase() === lower)?.id ?? null;
}

export function parseLabels(json: unknown): GmailLabel[] {
  const out: GmailLabel[] = [];
  for (const l of parseAllLabels(json)) {
    const isUser = l.type === 'user';
    if (!isUser && !SYSTEM_TARGETS.has(l.id)) continue;
    out.push({ id: l.id, name: isUser ? l.name : SYSTEM_NAMES[l.id] ?? l.name });
  }
  // Systeemlabels bovenaan in een vaste orde, daarna de eigen labels op naam.
  const rank = (l: GmailLabel) => {
    const i = [...SYSTEM_TARGETS].indexOf(l.id);
    return i === -1 ? SYSTEM_TARGETS.size : i;
  };
  return out.sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' }),
  );
}

// Per gekoppeld account de labels, of waarom ze er niet zijn.
export interface AccountLabels {
  email: string;
  labels: GmailLabel[];
  error?: string;
}

// Zodat de aanroeper 401 ("token afgekeurd") kan onderscheiden van de rest. Een
// token kan door Google ingetrokken zijn terwijl onze eigen klok zegt dat het nog
// geldig is; dan is verversen de juiste reactie, niet de fout doorgeven.
export class GmailHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function requestJson(
  url: string,
  accessToken: string,
  init?: { method: string; contentType: string; body: Buffer },
): Promise<unknown> {
  const { net } = require('electron') as typeof import('electron');
  return await new Promise((resolve, reject) => {
    const req = net.request({ url, method: init?.method ?? 'GET' });
    req.setHeader('Authorization', `Bearer ${accessToken}`);
    if (init) req.setHeader('Content-Type', init.contentType);
    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          reject(new Error(`onleesbaar antwoord (HTTP ${res.statusCode})`));
          return;
        }
        if (res.statusCode >= 400) {
          const msg = (json as { error?: { message?: string } })?.error?.message;
          reject(new GmailHttpError(msg ?? `HTTP ${res.statusCode}`, res.statusCode));
          return;
        }
        resolve(json);
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (init) req.write(init.body);
    req.end();
  });
}

export async function fetchLabels(accessToken: string): Promise<GmailLabel[]> {
  return parseLabels(await requestJson(LABELS_URL, accessToken));
}

export async function fetchLabelId(accessToken: string, name: string): Promise<string | null> {
  return findLabelId(parseAllLabels(await requestJson(LABELS_URL, accessToken)), name);
}

// Een gesleept label leegruimen ging tot nu toe door Gmail's lijstweergave in
// een verborgen view te bladeren en de onderwerp-spans uit te lezen. Met een
// token kan het rechtstreeks: één lijstverzoek per honderd gesprekken en één
// verzoek per gesprek voor de originelen, in plaats van seconden wachten per
// pagina tot de lijst is omgeklapt.
export const THREADS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/threads';

export function threadsListUrl(labelId: string, pageToken?: string): string {
  const q = new URLSearchParams({ labelIds: labelId, maxResults: '100' });
  if (pageToken) q.set('pageToken', pageToken);
  return `${THREADS_URL}?${q.toString()}`;
}

export function parseThreadList(json: unknown): { threadIds: string[]; nextPageToken?: string } {
  const raw = (json as { threads?: unknown })?.threads;
  const threadIds: string[] = [];
  if (Array.isArray(raw)) {
    for (const t of raw) if (typeof t?.id === 'string' && t.id) threadIds.push(t.id);
  }
  const next = (json as { nextPageToken?: unknown })?.nextPageToken;
  return typeof next === 'string' && next ? { threadIds, nextPageToken: next } : { threadIds };
}

// Alleen `messages.get` kent format=raw; `threads.get` niet — die accepteert
// enkel full/metadata/minimal en antwoordt op "raw" met een 400. Een gesprek
// kost daarom twee stappen: eerst welke berichten erin zitten, dan per bericht
// de bron. `minimal` omdat we van de thread niets anders nodig hebben dan die
// id's.
export function threadMessagesUrl(threadId: string): string {
  return `${THREADS_URL}/${encodeURIComponent(threadId)}?format=minimal`;
}

// De berichten in het gesprek, in de volgorde die Gmail geeft (oudste eerst).
export function parseThreadMessageIds(json: unknown): string[] {
  const raw = (json as { messages?: unknown })?.messages;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const m of raw) if (typeof m?.id === 'string' && m.id) out.push(m.id);
  return out;
}

export const MESSAGES_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';

export function messageRawUrl(messageId: string): string {
  return `${MESSAGES_URL}/${encodeURIComponent(messageId)}?format=raw`;
}

// De RFC822-bron van één bericht. Gmail codeert `raw` als base64url.
export function parseMessageRaw(json: unknown): Buffer | null {
  const raw = (json as { raw?: unknown })?.raw;
  return typeof raw === 'string' && raw ? Buffer.from(raw, 'base64url') : null;
}

// Of een bericht al in een label staat. De Message-ID uit de header is het
// enige dat een bericht over postvakken heen identificeert: dezelfde mail heeft
// in elk account een ander Gmail-id, maar dezelfde Message-ID. Gmail kan er zelf
// op zoeken met rfc822msgid:, dus dat scheelt ons het inlezen van het andere
// postvak.
export function messageIdQuery(messageId: string): string {
  // Zonder punthaken: die horen bij de header, niet bij de zoekterm.
  return `rfc822msgid:${(messageId ?? '').trim().replace(/^<+|>+$/g, '')}`;
}

export function searchInLabelUrl(messageId: string, labelId: string): string {
  const q = new URLSearchParams({
    q: messageIdQuery(messageId),
    labelIds: labelId,
    maxResults: '1',
  });
  return `${MESSAGES_URL}?${q.toString()}`;
}

export function parseHasMessage(json: unknown): boolean {
  const raw = (json as { messages?: unknown })?.messages;
  return Array.isArray(raw) && raw.length > 0;
}

// False bij een bericht zonder Message-ID: dan valt er niets te vergelijken en
// is "waarschijnlijk een duplicaat" een slechtere gok dan gewoon kopiëren.
export async function messageExistsInLabel(
  accessToken: string,
  messageId: string,
  labelId: string,
): Promise<boolean> {
  if (!(messageId ?? '').trim()) return false;
  return parseHasMessage(await requestJson(searchInLabelUrl(messageId, labelId), accessToken));
}

// De gesprekken in een label, tot `max`. `capped` zegt of Gmail er nog meer
// had — stil afkappen leest als "alles opgehaald".
export async function listLabelThreadIds(
  accessToken: string,
  labelId: string,
  max: number,
): Promise<{ threadIds: string[]; capped: boolean }> {
  const threadIds: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = parseThreadList(await requestJson(threadsListUrl(labelId, pageToken), accessToken));
    for (const id of page.threadIds) {
      if (threadIds.length >= max) return { threadIds, capped: true };
      if (!threadIds.includes(id)) threadIds.push(id);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return { threadIds, capped: false };
}

// De bron van elk bericht in het gesprek. Binnen één gesprek achter elkaar: dat
// zijn er een paar, en de aanroeper draait al meerdere gesprekken tegelijk.
export async function fetchThreadRaw(accessToken: string, threadId: string): Promise<Buffer[]> {
  const ids = parseThreadMessageIds(await requestJson(threadMessagesUrl(threadId), accessToken));
  const out: Buffer[] = [];
  for (const id of ids) {
    const raw = parseMessageRaw(await requestJson(messageRawUrl(id), accessToken));
    if (raw) out.push(raw);
  }
  return out;
}

// De scheidingsreeks mag nergens in het bericht voorkomen; anders leest Google
// midden in een bijlage een nieuw onderdeel. Willekeurig én gecontroleerd, want
// een .eml kan van alles bevatten — ook iets dat op onze boundary lijkt.
export function pickBoundary(
  raw: Buffer,
  rand: () => string = () => randomBytes(16).toString('hex'),
): string {
  for (let i = 0; i < 8; i++) {
    const candidate = `gmd-${rand()}`;
    if (!raw.includes(candidate)) return candidate;
  }
  // Acht keer achter elkaar een botsing kan alleen als `rand` niet willekeurig
  // is. Dan liever een lange, vaste reeks dan een stuk bericht opofferen.
  return `gmd-boundary-${raw.length}-fallback`;
}

// multipart/related zoals Google's upload-endpoint het wil: eerst de metadata
// als json, dan het bericht ruw. Ruw en niet base64: message/rfc822 is een
// binair onderdeel, dus de bytes gaan er ongemoeid in.
export function multipartBody(raw: Buffer, labelIds: string[], boundary: string): Buffer {
  const head = Buffer.from(
    `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      `${JSON.stringify({ labelIds })}\r\n` +
      `--${boundary}\r\n` +
      'Content-Type: message/rfc822\r\n\r\n',
    'utf8',
  );
  return Buffer.concat([head, raw, Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')]);
}

export function parseInsertedId(json: unknown): string | null {
  const id = (json as { id?: unknown })?.id;
  return typeof id === 'string' && id ? id : null;
}

// Zet één bericht in het postvak van `accessToken`, onder de gegeven labels.
// Geeft het id in dat postvak terug — handig in het log om een kopie terug te
// vinden. Gooit GmailHttpError bij een afgekeurd token, zodat de aanroeper kan
// verversen en het nog eens kan proberen.
export async function insertMessage(
  accessToken: string,
  raw: Buffer,
  labelIds: string[],
): Promise<string | null> {
  const boundary = pickBoundary(raw);
  const json = await requestJson(INSERT_URL, accessToken, {
    method: 'POST',
    contentType: `multipart/related; boundary=${boundary}`,
    body: multipartBody(raw, labelIds, boundary),
  });
  return parseInsertedId(json);
}
