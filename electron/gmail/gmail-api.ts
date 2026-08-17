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


//===========================
// Types
//===========================

export interface GmailLabel {
  id: string;
  name: string;
}

export interface RawLabel extends GmailLabel {
  type: string;
}

export interface AccountLabels {
  email: string;
  labels: GmailLabel[];
  error?: string;
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

export interface HistoryMessage {
  id: string;
  labelIds: string[];
}

export interface HistoryPage {
  added: HistoryMessage[];
  historyId: string | null;
  nextPageToken?: string;
}

export interface MessageMeta {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  internalDate: number;
}

export class GmailHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}


//===========================
// Constants
//===========================

export const LABELS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/labels';

// the upload endpoint, which is the only one that takes a whole message
export const INSERT_URL =
  'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages' +
  '?uploadType=multipart&internalDateSource=dateHeader';

export const THREADS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/threads';
export const MESSAGES_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';

export const WATCH_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/watch';
export const STOP_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/stop';
export const PROFILE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';
export const HISTORY_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/history';

export const MESSAGE_META_HEADERS = ['From', 'Subject'];

// How long a call may stay unanswered before it is given up on. Long enough that a slow
// answer is still an answer, short enough that whoever is waiting on it hears something.
// The upload deadline is separate because the size of an insert is the user's attachment,
// not a sign that anything is wrong.
const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;

/**
 * The headers every call in this file carries
 *
 * A function of its own, and it earned that the hard way: these two lines sat inside
 * requestJson's callback, where an edit about something else deleted them and nothing said a
 * word. Every call then went out unauthenticated, and Google answers that with "Request is
 * missing required authentication credential" — a sentence that reads like a withdrawn client
 * id or a broken key, so it sends you looking everywhere except at the missing line. Out here
 * a test can hold it; inside a net.request callback nothing could.
 *
 * @param accessToken
 * @param contentType set only for a call with a body
 * @returns the headers, by name
 */
export function apiHeaders(accessToken: string, contentType?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...(contentType ? { 'Content-Type': contentType } : {}),
  };
}

// the system labels a mail can be copied into; the rest are Gmail's own bookkeeping
const SYSTEM_TARGETS = new Set(['INBOX', 'STARRED', 'IMPORTANT']);

const SYSTEM_NAMES: Record<string, string> = {
  INBOX: 'Postvak IN',
  STARRED: 'Met sterren',
  IMPORTANT: 'Belangrijk',
};


//===========================
// Labels
//===========================

/**
 * Reads every label the mailbox has
 *
 * @param json
 * @returns {RawLabel[]} the labels that carry both an id and a name
 */
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

/**
 * Looks a label up by name
 *
 * @param labels
 * @param name
 * @returns the id, on an exact match first and a case-insensitive one after, or null
 */
export function findLabelId(labels: RawLabel[], name: string): string | null {
  const want = (name ?? '').trim();
  if (!want) return null;
  const exact = labels.find((l) => l.name === want);
  if (exact) return exact.id;
  const lower = want.toLowerCase();
  return labels.find((l) => l.name.toLowerCase() === lower)?.id ?? null;
}

/**
 * The labels a mail can be copied into
 *
 * @param json
 * @returns {GmailLabel[]} the system targets in their own order, then the user's own
 *   labels by name
 */
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

export function labelGetUrl(labelId: string): string {
  return `${LABELS_URL}/${encodeURIComponent(labelId)}`;
}

export function parseUnreadThreads(json: unknown): number | null {
  return numberFrom((json as { threadsUnread?: unknown })?.threadsUnread);
}

export async function fetchLabels(accessToken: string): Promise<GmailLabel[]> {
  return parseLabels(await requestJson(LABELS_URL, accessToken));
}

export async function fetchLabelId(accessToken: string, name: string): Promise<string | null> {
  return findLabelId(parseAllLabels(await requestJson(LABELS_URL, accessToken)), name);
}

export async function fetchInboxUnread(accessToken: string): Promise<number | null> {
  return parseUnreadThreads(await requestJson(labelGetUrl('INBOX'), accessToken));
}


//===========================
// Threads
//===========================

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

/**
 * Every thread under a label, one page at a time
 *
 * @param accessToken
 * @param labelId
 * @param max
 * @returns {Promise<{threadIds: string[], capped: boolean}>} capped says the label holds
 *   more than the caller asked for
 */
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

/**
 * Reads every message of a thread
 *
 * The network is a dependency so this can be tested without one — the same arrangement
 * push-sync uses, and for the same reason: what is worth checking here is not that a
 * request was made but that the list keeps its shape. It is the dropping of unreadable
 * messages that once made a short copy look like a complete one.
 *
 * @param ids
 * @param read
 * @returns {Promise<ThreadMessage[]>} one entry per id, in the thread's own order, and a
 *   message that could not be read stays in as an error
 */
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

/**
 * The sources of a thread, for a caller that only wants what came back
 *
 * @param accessToken
 * @param threadId
 * @returns {Promise<Buffer[]>} the messages that could be read, so a short answer here
 *   says nothing about how long the thread is
 */
export async function fetchThreadRaw(accessToken: string, threadId: string): Promise<Buffer[]> {
  const messages = await fetchThreadMessages(accessToken, threadId);
  return messages.flatMap((m) => (m.raw ? [m.raw] : []));
}


//===========================
// Messages
//===========================

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

export function messageMetaUrl(messageId: string): string {
  const q = new URLSearchParams({ format: 'metadata' });
  for (const h of MESSAGE_META_HEADERS) q.append('metadataHeaders', h);
  return `${MESSAGES_URL}/${encodeURIComponent(messageId)}?${q.toString()}`;
}

/**
 * Reads the headers a notification is built from
 *
 * @param json
 * @returns {MessageMeta|null} null without an id and a date, which every message has
 */
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

export async function markMessageRead(accessToken: string, messageId: string): Promise<void> {
  await requestJson(messageModifyUrl(messageId), accessToken, {
    method: 'POST',
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify({ removeLabelIds: ['UNREAD'] }), 'utf8'),
  });
}

/**
 * Takes a mail out of the inbox
 *
 * Archiving is removing INBOX, which is the same modify call mark-as-read uses with a
 * different label. Gmail has no archive endpoint of its own.
 *
 * @param accessToken
 * @param messageId
 * @returns {Promise<void>}
 */
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

/**
 * The newest mail in the inbox, ids only
 *
 * `max` is deliberately a handful. This exists to answer "which mail was that notification
 * about", and a notification is about mail that arrived seconds ago, so the answer is
 * among the last few or it is not worth more requests to find.
 *
 * @param max
 * @returns the URL
 */
export function recentInboxUrl(max: number): string {
  const q = new URLSearchParams({ labelIds: 'INBOX', maxResults: String(Math.max(1, max)) });
  return `${MESSAGES_URL}?${q.toString()}`;
}

export async function fetchRecentInboxIds(accessToken: string, max: number): Promise<string[]> {
  // messages.list answers in the same `{ messages: [{ id }] }` shape a thread does.
  return parseThreadMessageIds(await requestJson(recentInboxUrl(max), accessToken));
}

export async function fetchMessageMeta(
  accessToken: string,
  messageId: string,
): Promise<MessageMeta | null> {
  return parseMessageMeta(await requestJson(messageMetaUrl(messageId), accessToken));
}

/**
 * The search that finds one message across mailboxes
 *
 * @param messageId the RFC822 Message-ID, the only id stable across mailboxes
 * @returns the query
 */
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

/**
 * Whether a label already holds this message
 *
 * @param accessToken
 * @param messageId the RFC822 Message-ID
 * @param labelId
 * @returns {Promise<boolean>} false without a Message-ID, since nothing can be matched
 */
export async function messageExistsInLabel(
  accessToken: string,
  messageId: string,
  labelId: string,
): Promise<boolean> {
  if (!(messageId ?? '').trim()) return false;
  return parseHasMessage(await requestJson(searchInLabelUrl(messageId, labelId), accessToken));
}

// Asking the mailbox once instead of once per label. The per-label search answers "is it
// under this one label", which costs a call for every label anyone ticked and stays silent
// about the label they did not tick — and "it is already in that mailbox, under something
// else" is exactly what a second copy is. Two calls per mailbox answer that whatever the
// mailbox's label count is: find the message, then read what it is filed under.
//
// Spam and trash stay out, as they do in the per-label search: a mail someone threw away is
// not a copy standing in the way of this one.

/**
 * The search that finds one message anywhere in a mailbox
 *
 * @param messageId the RFC822 Message-ID
 * @returns the URL
 */
export function searchAnywhereUrl(messageId: string): string {
  const q = new URLSearchParams({ q: messageIdQuery(messageId), maxResults: '1' });
  return `${MESSAGES_URL}?${q.toString()}`;
}

/**
 * The smallest form of a message, which carries its labels
 *
 * @param messageId Gmail's own id, not the RFC822 one
 * @returns the URL
 */
export function messageLabelsUrl(messageId: string): string {
  return `${MESSAGES_URL}/${encodeURIComponent(messageId)}?format=minimal`;
}

/**
 * Reads the message a search turned up
 *
 * @param json
 * @returns {string|null} null when the search found nothing
 */
export function parseFirstMessageId(json: unknown): string | null {
  const raw = (json as { messages?: unknown })?.messages;
  if (!Array.isArray(raw)) return null;
  return stringFrom((raw[0] as { id?: unknown })?.id);
}

/**
 * Reads the labels a mailbox has a message under
 *
 * @param json
 * @returns the label ids, Gmail's own bookkeeping ones included
 */
export function parseMessageLabelIds(json: unknown): string[] {
  const raw = (json as { labelIds?: unknown })?.labelIds;
  if (!Array.isArray(raw)) return [];
  return raw.map((id) => stringFrom(id)).filter((id): id is string => !!id);
}

/**
 * Which labels of a mailbox already hold this message
 *
 * @param accessToken
 * @param messageId the RFC822 Message-ID
 * @returns {Promise<string[]>} empty when the mailbox does not have it at all
 */
export async function labelsHoldingMessage(
  accessToken: string,
  messageId: string,
): Promise<string[]> {
  if (!(messageId ?? '').trim()) return [];
  const found = parseFirstMessageId(await requestJson(searchAnywhereUrl(messageId), accessToken));
  if (!found) return [];
  return parseMessageLabelIds(await requestJson(messageLabelsUrl(found), accessToken));
}


//===========================
// Watch and history
//===========================

export function watchBody(topicName: string): string {
  return JSON.stringify({
    topicName,
    labelIds: ['INBOX'],
    labelFilterBehavior: 'include',
  });
}

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

/**
 * Reads one page of what happened since a history id
 *
 * @param json
 * @returns {HistoryPage} the added messages, and where to carry on from
 */
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

/**
 * Asks Gmail to push what arrives in the inbox to a Pub/Sub topic
 *
 * @param accessToken
 * @param topicName
 * @returns {Promise<{historyId: string, expiration: number}|null>} where to start reading
 *   history from, and when the watch has to be renewed
 */
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


//===========================
// Insert
//===========================

/**
 * A multipart boundary the message itself does not contain
 *
 * @param raw
 * @param rand
 * @returns a boundary; the fallback after eight tries is still checked against nothing,
 *   which is why it carries the message length
 */
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

/**
 * The upload body: the labels in JSON, then the message itself
 *
 * `threadId` is what keeps a copied conversation a conversation. Gmail does not thread an
 * inserted message on its headers alone: insert says the thread it belongs to, or it
 * becomes a thread of its own. Six replies copied to another mailbox then arrive as six
 * separate mails, which is what this is here to prevent. Google's own conditions still
 * apply beside it — References and In-Reply-To per RFC 2822, and a matching Subject — and
 * they hold, because what is inserted is the original message.
 *
 * @param raw
 * @param labelIds
 * @param boundary
 * @param threadId the thread the earlier messages of this copy landed in
 * @returns {Buffer}
 */
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

/**
 * The thread the message landed in
 *
 * Read apart from the id because the caller needs both and for different reasons: the id
 * proves the insert happened, the thread is what the rest of the copy is filed under.
 *
 * @param json
 * @returns the thread id, or null when the answer carries none
 */
export function parseInsertedThreadId(json: unknown): string | null {
  const threadId = (json as { threadId?: unknown })?.threadId;
  return typeof threadId === 'string' && threadId ? threadId : null;
}

/**
 * Puts a whole message into a mailbox
 *
 * @param accessToken
 * @param raw
 * @param labelIds
 * @param threadId the thread the earlier messages of this copy landed in
 * @returns {Promise<{id: string|null, threadId: string|null}>} what Gmail filed it as
 */
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


//===========================
// Helper functions
//===========================

/**
 * The one request every call in this file goes through
 *
 * @param url
 * @param accessToken
 * @param init a body turns the call into a POST of that content type
 * @returns {Promise<unknown>} the parsed answer
 * @throws {GmailHttpError} on any status from 400, carrying Gmail's own message
 * @private
 */
async function requestJson(
  url: string,
  accessToken: string,
  init?: { method: string; contentType: string; body: Buffer },
): Promise<unknown> {
  const { net } = require('electron') as typeof import('electron');
  return await new Promise((resolve, reject) => {
    const req = net.request({ url, method: init?.method ?? 'GET' });
    for (const [name, value] of Object.entries(apiHeaders(accessToken, init?.contentType))) {
      req.setHeader(name, value);
    }
    // A request that is never answered used to leave its promise unsettled for the life of
    // the process, and every caller waiting on it with it: the label list of a drop window
    // asks one account after another, so one stalled connection left "Labels ophalen…" on
    // screen for good. An upload gets the longer deadline because it is the request whose
    // length is the user's attachment rather than the network being ill.
    const timer = setTimeout(() => {
      req.abort();
      reject(new Error('geen antwoord van Google (time-out)'));
    }, init ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
    const settle = <T>(fn: (v: T) => void) => (v: T) => {
      clearTimeout(timer);
      fn(v);
    };
    const ok = settle(resolve);
    const fail = settle(reject);
    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          fail(new Error(`onleesbaar antwoord (HTTP ${res.statusCode})`));
          return;
        }
        if (res.statusCode >= 400) {
          const msg = (json as { error?: { message?: string } })?.error?.message;
          fail(new GmailHttpError(msg ?? `HTTP ${res.statusCode}`, res.statusCode));
          return;
        }
        ok(json);
      });
      res.on('error', fail);
    });
    req.on('error', fail);
    if (init) req.write(init.body);
    req.end();
  });
}

// Gmail answers with numbers as strings in some places and as numbers in others
const numberFrom = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const stringFrom = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
