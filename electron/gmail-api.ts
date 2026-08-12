// Gmail API, only what we need. The pure parts (URLs, reading responses) live here so
// they are testable and `electron` is loaded lazily inside the functions that go on
// the network. This is the one file that knows what a request to Gmail looks like,
// which is why `requestJson` stays private.
//
// Traps worth knowing. `messages.insert` uses the upload endpoint with a multipart body,
// so labels ride along in the metadata and the ceiling is 50 MB instead of a few;
// `internalDateSource=dateHeader` is required or the copy lands under today's date, and
// the boundary is randomised then checked against the message. Only `messages.get`
// understands `format=raw` — `threads.get` answers 400 — so a thread costs two steps,
// and Gmail encodes `raw` as base64url. Trashing uses `/trash`, never `DELETE`, to stay
// reversible for thirty days. Duplicate detection matches the RFC822 Message-ID via
// `rfc822msgid:`, the only id stable across mailboxes.

import { randomBytes } from 'node:crypto';

export const LABELS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/labels';

export const INSERT_URL =
  'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages' +
  '?uploadType=multipart&internalDateSource=dateHeader';

export interface GmailLabel {
  id: string;
  name: string;
}

const SYSTEM_TARGETS = new Set(['INBOX', 'STARRED', 'IMPORTANT']);

const SYSTEM_NAMES: Record<string, string> = {
  INBOX: 'Postvak IN',
  STARRED: 'Met sterren',
  IMPORTANT: 'Belangrijk',
};

export interface RawLabel extends GmailLabel {
  type: string;
}

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
  const rank = (l: GmailLabel) => {
    const i = [...SYSTEM_TARGETS].indexOf(l.id);
    return i === -1 ? SYSTEM_TARGETS.size : i;
  };
  return out.sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' }),
  );
}

export interface AccountLabels {
  email: string;
  labels: GmailLabel[];
  error?: string;
}

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

export function threadMessagesUrl(threadId: string): string {
  return `${THREADS_URL}/${encodeURIComponent(threadId)}?format=minimal`;
}

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

export function parseMessageRaw(json: unknown): Buffer | null {
  const raw = (json as { raw?: unknown })?.raw;
  return typeof raw === 'string' && raw ? Buffer.from(raw, 'base64url') : null;
}

export async function fetchMessageRaw(
  accessToken: string,
  messageId: string,
): Promise<Buffer | null> {
  return parseMessageRaw(await requestJson(messageRawUrl(messageId), accessToken));
}

export function messageModifyUrl(messageId: string): string {
  return `${MESSAGES_URL}/${encodeURIComponent(messageId)}/modify`;
}
export function messageTrashUrl(messageId: string): string {
  return `${MESSAGES_URL}/${encodeURIComponent(messageId)}/trash`;
}

export async function markMessageRead(accessToken: string, messageId: string): Promise<void> {
  await requestJson(messageModifyUrl(messageId), accessToken, {
    method: 'POST',
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify({ removeLabelIds: ['UNREAD'] }), 'utf8'),
  });
}

// Archiving is removing INBOX, which is the same modify call mark-as-read uses with a
// different label. Gmail has no archive endpoint of its own.
export async function archiveMessage(accessToken: string, messageId: string): Promise<void> {
  await requestJson(messageModifyUrl(messageId), accessToken, {
    method: 'POST',
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify({ removeLabelIds: ['INBOX'] }), 'utf8'),
  });
}

export async function trashMessage(accessToken: string, messageId: string): Promise<void> {
  await requestJson(messageTrashUrl(messageId), accessToken, {
    method: 'POST',
    contentType: 'application/json',
    body: Buffer.from('{}', 'utf8'),
  });
}

/** The newest mail in the inbox, ids only.
 *
 * `max` is deliberately a handful. This exists to answer "which mail was that notification
 * about", and a notification is about mail that arrived seconds ago, so the answer is
 * among the last few or it is not worth more requests to find. */
export function recentInboxUrl(max: number): string {
  const q = new URLSearchParams({ labelIds: 'INBOX', maxResults: String(Math.max(1, max)) });
  return `${MESSAGES_URL}?${q.toString()}`;
}

export async function fetchRecentInboxIds(accessToken: string, max: number): Promise<string[]> {
  // messages.list answers in the same `{ messages: [{ id }] }` shape a thread does.
  return parseThreadMessageIds(await requestJson(recentInboxUrl(max), accessToken));
}

export function messageIdQuery(messageId: string): string {
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

export async function messageExistsInLabel(
  accessToken: string,
  messageId: string,
  labelId: string,
): Promise<boolean> {
  if (!(messageId ?? '').trim()) return false;
  return parseHasMessage(await requestJson(searchInLabelUrl(messageId, labelId), accessToken));
}

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

/** One entry per message the thread actually holds, whether or not its source came back.
 *
 * The count is the point. Gmail's own conversation page renders what it feels like
 * rendering — a long thread arrives with its older messages collapsed and their download
 * links absent — so a copy taken from that page can be short without anything reporting a
 * failure. `threads.get` is asked instead, and it answers with every message id in the
 * thread regardless of how any page would draw it. A message whose source then fails to
 * arrive is kept here as an error rather than dropped, because a caller counting what it
 * saved must be able to see that one is missing. */
export interface ThreadMessage {
  id: string;
  raw?: Buffer;
  error?: string;
}

/** The loop, with the network as a dependency so it can be tested without one — the same
 * arrangement push-sync uses, and for the same reason: what is worth checking here is not
 * that a request was made but that the list keeps its shape. One entry per id, in the
 * thread's own order, and a message that could not be read stays in as an error. It is the
 * dropping of those that made a short copy look like a complete one. */
export async function collectThreadMessages(
  ids: string[],
  read: (id: string) => Promise<Buffer | null>,
): Promise<ThreadMessage[]> {
  const out: ThreadMessage[] = [];
  for (const id of ids) {
    try {
      const raw = await read(id);
      out.push(raw ? { id, raw } : { id, error: 'Gmail gaf geen bron voor dit bericht' });
    } catch (e) {
      out.push({ id, error: `Ophalen mislukt (${(e as Error).message})` });
    }
  }
  return out;
}

export async function fetchThreadMessages(
  accessToken: string,
  threadId: string,
): Promise<ThreadMessage[]> {
  const ids = parseThreadMessageIds(await requestJson(threadMessagesUrl(threadId), accessToken));
  return collectThreadMessages(ids, async (id) =>
    parseMessageRaw(await requestJson(messageRawUrl(id), accessToken)),
  );
}

export async function fetchThreadRaw(accessToken: string, threadId: string): Promise<Buffer[]> {
  const messages = await fetchThreadMessages(accessToken, threadId);
  return messages.flatMap((m) => (m.raw ? [m.raw] : []));
}

export const WATCH_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/watch';
export const STOP_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/stop';
export const PROFILE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';
export const HISTORY_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/history';

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
  internalDate: number;
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
  return `${LABELS_URL}/${encodeURIComponent(labelId)}`;
}

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

export function pickBoundary(
  raw: Buffer,
  rand: () => string = () => randomBytes(16).toString('hex'),
): string {
  for (let i = 0; i < 8; i++) {
    const candidate = `gmd-${rand()}`;
    if (!raw.includes(candidate)) return candidate;
  }
  return `gmd-boundary-${raw.length}-fallback`;
}

/** `threadId` is what keeps a copied conversation a conversation.
 *
 * Gmail does not thread an inserted message on its headers alone: insert says the thread it
 * belongs to, or it becomes a thread of its own. Six replies copied to another mailbox then
 * arrive as six separate mails, which is what this is here to prevent. Google's own
 * conditions still apply beside it — References and In-Reply-To per RFC 2822, and a matching
 * Subject — and they hold, because what is inserted is the original message. */
export function multipartBody(
  raw: Buffer,
  labelIds: string[],
  boundary: string,
  threadId?: string,
): Buffer {
  const metadata = threadId ? { labelIds, threadId } : { labelIds };
  const head = Buffer.from(
    `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      `${JSON.stringify(metadata)}\r\n` +
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

/** The thread the message landed in, which the next message of the same conversation has to
 * be told. Read apart from the id because the caller needs both and for different reasons:
 * the id proves the insert happened, the thread is what the rest of the copy is filed under. */
export function parseInsertedThreadId(json: unknown): string | null {
  const threadId = (json as { threadId?: unknown })?.threadId;
  return typeof threadId === 'string' && threadId ? threadId : null;
}

export async function insertMessage(
  accessToken: string,
  raw: Buffer,
  labelIds: string[],
  threadId?: string,
): Promise<{ id: string | null; threadId: string | null }> {
  const boundary = pickBoundary(raw);
  const json = await requestJson(INSERT_URL, accessToken, {
    method: 'POST',
    contentType: `multipart/related; boundary=${boundary}`,
    body: multipartBody(raw, labelIds, boundary, threadId),
  });
  return { id: parseInsertedId(json), threadId: parseInsertedThreadId(json) };
}
