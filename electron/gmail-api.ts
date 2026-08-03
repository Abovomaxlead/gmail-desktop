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

// --- Push: watch, history, metadata, teller -------------------------------
//
// Gmail meldt zelf wanneer er iets verandert, via Pub/Sub. De melding bevat geen
// mail: alleen een historyId. Wat er veranderd is komt daarna uit history.list.

export const WATCH_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/watch';
export const STOP_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/stop';
export const PROFILE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';
export const HISTORY_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/history';

const LABELS_BASE = LABELS_URL;

// Alleen INBOX: wat daarbuiten gebeurt hoeft geen melding en geen teller. Staat
// het ooit toch nodig te zijn (zie het openstaande punt in de spec over gelezen
// markeren), dan is dit de enige plek die verandert.
export function watchBody(topicName: string): string {
  return JSON.stringify({
    topicName,
    labelIds: ['INBOX'],
    labelFilterBehavior: 'include',
  });
}

const numberFrom = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const stringFrom = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function parseWatch(json: unknown): { historyId: string; expiration: number } | null {
  const raw = json as { historyId?: unknown; expiration?: unknown };
  const historyId = stringFrom(raw?.historyId);
  if (!historyId) return null;
  return { historyId, expiration: numberFrom(raw?.expiration) ?? 0 };
}

export function parseProfileHistoryId(json: unknown): string | null {
  return stringFrom((json as { historyId?: unknown })?.historyId);
}

export function historyListUrl(startHistoryId: string, pageToken?: string): string {
  const q = new URLSearchParams({
    startHistoryId,
    labelId: 'INBOX',
    maxResults: '500',
  });
  // Alleen toegevoegde berichten: label-verschuivingen zijn voor de teller, en
  // die halen we los op bij het INBOX-label zelf.
  q.append('historyTypes', 'messageAdded');
  if (pageToken) q.set('pageToken', pageToken);
  return `${HISTORY_URL}?${q.toString()}`;
}

export interface HistoryMessage {
  id: string;
  labelIds: string[];
}

export interface HistoryPage {
  added: HistoryMessage[];
  historyId: string | null;
  nextPageToken?: string;
}

export function parseHistoryPage(json: unknown): HistoryPage {
  const raw = json as { history?: unknown; historyId?: unknown; nextPageToken?: unknown };
  const added: HistoryMessage[] = [];
  if (Array.isArray(raw?.history)) {
    for (const record of raw.history) {
      const list = (record as { messagesAdded?: unknown })?.messagesAdded;
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        const message = (entry as { message?: { id?: unknown; labelIds?: unknown } })?.message;
        const id = stringFrom(message?.id);
        if (!id) continue;
        const labelIds = Array.isArray(message?.labelIds)
          ? message!.labelIds.filter((l): l is string => typeof l === 'string')
          : [];
        added.push({ id, labelIds });
      }
    }
  }
  const page: HistoryPage = { added, historyId: stringFrom(raw?.historyId) };
  const next = stringFrom(raw?.nextPageToken);
  if (next) page.nextPageToken = next;
  return page;
}

export const MESSAGE_META_HEADERS = ['From', 'Subject'];

export function messageMetaUrl(messageId: string): string {
  const q = new URLSearchParams({ format: 'metadata' });
  for (const h of MESSAGE_META_HEADERS) q.append('metadataHeaders', h);
  return `${MESSAGES_URL}/${encodeURIComponent(messageId)}?${q.toString()}`;
}

export interface MessageMeta {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  internalDate: number; // epoch ms; bepaalt of dit bericht nog meldingswaardig is
}

export function parseMessageMeta(json: unknown): MessageMeta | null {
  const raw = json as {
    id?: unknown;
    threadId?: unknown;
    internalDate?: unknown;
    payload?: { headers?: unknown };
  };
  const id = stringFrom(raw?.id);
  const internalDate = numberFrom(raw?.internalDate);
  // Zonder id valt er niets te openen en zonder aankomsttijd kunnen we niet
  // beslissen of het een melding waard is. De rest mag ontbreken.
  if (!id || internalDate === null) return null;
  const headers = Array.isArray(raw?.payload?.headers) ? raw!.payload!.headers : [];
  const header = (name: string): string => {
    for (const h of headers as Array<{ name?: unknown; value?: unknown }>) {
      if (typeof h?.name === 'string' && h.name.toLowerCase() === name) {
        return stringFrom(h.value) ?? '';
      }
    }
    return '';
  };
  return {
    id,
    threadId: stringFrom(raw?.threadId) ?? '',
    from: header('from'),
    subject: header('subject'),
    internalDate,
  };
}

export function labelGetUrl(labelId: string): string {
  return `${LABELS_BASE}/${encodeURIComponent(labelId)}`;
}

// threadsUnread en niet messagesUnread: de paginatitel van de webview telt ook
// gesprekken, dus zo verspringt het getal niet zodra de dekking van bron wisselt.
export function parseUnreadThreads(json: unknown): number | null {
  return numberFrom((json as { threadsUnread?: unknown })?.threadsUnread);
}

export async function watchMailbox(
  accessToken: string,
  topicName: string,
): Promise<{ historyId: string; expiration: number } | null> {
  return parseWatch(
    await requestJson(WATCH_URL, accessToken, {
      method: 'POST',
      contentType: 'application/json',
      body: Buffer.from(watchBody(topicName), 'utf8'),
    }),
  );
}

// Netjes afmelden als een account weggaat, anders blijft Gmail nog tot een week
// naar het topic publiceren voor een client die er niet meer is.
export async function stopWatch(accessToken: string): Promise<void> {
  await requestJson(STOP_URL, accessToken, {
    method: 'POST',
    contentType: 'application/json',
    body: Buffer.from('{}', 'utf8'),
  });
}

export async function fetchProfileHistoryId(accessToken: string): Promise<string | null> {
  return parseProfileHistoryId(await requestJson(PROFILE_URL, accessToken));
}

export async function fetchHistoryPage(
  accessToken: string,
  startHistoryId: string,
  pageToken?: string,
): Promise<HistoryPage> {
  return parseHistoryPage(await requestJson(historyListUrl(startHistoryId, pageToken), accessToken));
}

export async function fetchMessageMeta(
  accessToken: string,
  messageId: string,
): Promise<MessageMeta | null> {
  return parseMessageMeta(await requestJson(messageMetaUrl(messageId), accessToken));
}

export async function fetchInboxUnread(accessToken: string): Promise<number | null> {
  return parseUnreadThreads(await requestJson(labelGetUrl('INBOX'), accessToken));
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
