// Gmail API, only what we need. The pure parts live here so they are testable, and this is
// the one file that knows what a request to Gmail looks like — hence the private requestJson.
//
// Traps worth knowing: `messages.insert` needs the upload endpoint and
// `internalDateSource=dateHeader`, or the copy lands under today's date; only `messages.get`
// understands `format=raw`, so a thread costs two steps; trashing uses `/trash` rather than
// DELETE to stay reversible; and duplicates match on `rfc822msgid:`, the only stable id.

import { randomBytes } from 'node:crypto';
import { mapLimit } from '../core/concurrency';
import { isRateLimit, withRetry, type RetryMethod } from './retry';
import { notifyLog } from '../notify/notify-log';
import { callForUrl, createQuotaBudget, type QuotaBudget } from './quota';
import {
  BATCH_LIMIT,
  BATCH_URL,
  RAW_BATCH_LIMIT,
  batchBody,
  batchPath,
  boundaryFrom,
  parseBatchBody,
  batchLooksBroken,
} from './batch';


//===========================
// Types
//===========================

export interface GmailLabel {
  id: string;
  name: string;
}

export interface RawLabel extends GmailLabel {
  type: string;
  /** 'labelHide' for a label hidden from Gmail's own clients, empty when the field was absent
   * or unreadable -- never confused with 'labelShow', which is a real, different value. */
  labelListVisibility: string;
}

export interface AccountLabels {
  email: string;
  labels: GmailLabel[];
  error?: string;
}

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
  /** The RFC822 Message-ID, empty when Gmail did not hand the header over */
  messageId: string;
}

/**
 * Reads the reason Gmail gave for refusing a request
 *
 * Two fields, written by two different layers, and either one identifies a refusal. The Gmail
 * API itself lists per-error `reason` strings; the quota front end in front of it answers with
 * an `error.status` instead and no `errors` array at all. The live quota failure of 2026-08-25
 * came back in the second shape.
 *
 * @param json the parsed error body, or anything at all -- a body that is not an object at
 *   least answers null rather than throwing, since the caller has already given up on it
 * @returns the reason, or null when the body carries neither
 */
export function parseErrorReason(json: unknown): string | null {
  const error = (json as { error?: { errors?: unknown; status?: unknown } } | null)?.error;
  if (!error) return null;
  if (Array.isArray(error.errors)) {
    for (const entry of error.errors) {
      const reason = (entry as { reason?: unknown })?.reason;
      if (typeof reason === 'string' && reason) return reason;
    }
  }
  return typeof error.status === 'string' && error.status ? error.status : null;
}

export class GmailHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Gmail's own Retry-After, which the retry policy prefers over its own backoff */
    readonly retryAfter: string | null = null,
    /** Why Gmail says it refused -- see parseErrorReason. Defaulted because two of the three
     * places that construct one have no body to read: an answer that would not parse, and a
     * batch refused as a whole. Neither can name a reason, and neither should pretend to. */
    readonly reason: string | null = null,
  ) {
    super(message);
  }
}

/** A request severed on purpose, by a signal this file did not fire itself. Its own class so
 * every layer above can tell a deliberate cut apart from a timeout: retry.ts must never send
 * it again, and the caller must never report it as an ordinary upload failure.
 *
 * `dispatched` says whether anything actually went out: false when the signal was already
 * aborted before this attempt opened a request at all, true when the cut came after
 * req.end() had already sent it. Only the second case is genuinely ambiguous about whether
 * Gmail applied it -- the first cannot possibly have landed, and reconciliation is what
 * reads this to skip searching for it at all. */
export class GmailCancelledError extends Error {
  constructor(message: string, readonly dispatched: boolean) {
    super(message);
  }
}


//===========================
// Constants
//===========================

export const LABELS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/labels';

export const INSERT_URL =
  'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages' +
  '?uploadType=multipart&internalDateSource=dateHeader';

export const THREADS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/threads';
export const MESSAGES_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';

export const WATCH_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/watch';
export const STOP_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/stop';
export const PROFILE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';
export const HISTORY_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/history';

// Message-ID rides along on a call the sync already makes for every new inbox mail, which is
// what fills the duplicate index without costing a request.
export const MESSAGE_META_HEADERS = ['From', 'Subject', 'Message-ID'];

// A batch is many answers in one, so it is allowed longer than a single read but nowhere near
// an upload: a group that has not answered in a minute is not going to.
const BATCH_TIMEOUT_MS = 60_000;

// Batches in flight. Each one is already fifty calls, so a handful saturates any uplink.
const BATCH_IN_FLIGHT = 3;

const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;

// How many messages of one conversation are read at once. This used to be the thing keeping
// the app inside Gmail's quota, which it could not do: how many requests a second a given
// number in flight comes to depends on the round trip and nothing else. quota.ts meters the
// rate now, so this is only about how much is in flight at once, and it is set high enough
// that the budget is what holds a drag back rather than this.
export const MESSAGE_FETCH_LIMIT = 8;

// How many messages one Message-ID may turn up in a mailbox. More than one means the mail
// both arrived and was copied in; beyond a handful it is the same mail over and over and the
// labels stop telling us anything new.
export const SEARCH_MATCH_LIMIT = 10;

// How many Message-IDs go into one `OR` query. Gmail stops answering such a query somewhere
// around sixteen terms and answers with nothing rather than with an error, which is
// indistinguishable from "this mailbox does not have them" -- so this stays well below the
// cliff, and a canary term proves the query was understood before an empty answer is believed.
export const BATCH_QUERY_LIMIT = 10;

// Every label a copy run creates to mark its own inserts starts with this, and nothing else
// in this app names a label this way. parseLabels reads it to keep a marker out of the
// mail-drop picker -- on the name alone, not on labelListVisibility, so a label some user
// hid for their own bookkeeping stays exactly as visible to them as it always was.
export const MARKER_LABEL_PREFIX = '_gmd-copy-';

// Gmail's own ceiling on users.messages.batchModify: at most this many ids in one call.
export const BATCH_MODIFY_LIMIT = 1000;

/**
 * The headers every call in this file carries
 *
 * Out here so a test can hold it; inside a net.request callback nothing could, and a call
 * that silently lost its Authorization reads as a withdrawn client id.
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
    out.push({
      id,
      name,
      type: typeof l?.type === 'string' ? l.type : '',
      labelListVisibility: typeof l?.labelListVisibility === 'string' ? l.labelListVisibility : '',
    });
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
 * Whether a label name is one of this app's own markers
 *
 * @param name
 * @returns true for a name this app itself would have minted, never for a label a user made
 */
export function isMarkerLabelName(name: string): boolean {
  return name.startsWith(MARKER_LABEL_PREFIX);
}

/**
 * The name a run's own marker label gets, deterministic in the run id
 *
 * Deterministic so that a create retried after an ambiguous answer -- the connection cut
 * before the response came back, not before the label existed -- lands on the same name, and
 * createHiddenLabel can recover the same id from Gmail's own 409 rather than minting a
 * duplicate.
 *
 * @param runId
 * @returns the name
 */
export function markerLabelName(runId: string): string {
  return `${MARKER_LABEL_PREFIX}${runId}`;
}

/**
 * The labels a mail can be copied into
 *
 * A marker label is `type: 'user'` like any label the mailbox owner made, so it is excluded
 * on its name rather than on labelListVisibility -- see MARKER_LABEL_PREFIX for why that
 * narrower test is the deliberate choice, not the broader one.
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
    if (isUser && isMarkerLabelName(l.name)) continue;
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

/**
 * The body that creates a label hidden from Gmail's own clients
 *
 * @param name
 * @returns the JSON body to POST
 */
export function labelCreateBody(name: string): string {
  return JSON.stringify({ name, labelListVisibility: 'labelHide', messageListVisibility: 'hide' });
}

/**
 * The body that creates a label the user can see
 *
 * The mirror image of labelCreateBody: a marker is bookkeeping and stays out of every client,
 * while a label a copied tree lands in is the whole point of the copy and has to show up.
 *
 * @param name the full nested name, `Archief/Klanten/Acme`
 * @returns the JSON body to POST
 */
export function visibleLabelCreateBody(name: string): string {
  return JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' });
}

/**
 * Reads the label a create call answered with
 *
 * @param json
 * @returns {null} without both an id and a name, which every label carries
 */
export function parseCreatedLabel(json: unknown): { id: string; name: string } | null {
  const raw = json as { id?: unknown; name?: unknown };
  const id = stringFrom(raw?.id);
  const name = stringFrom(raw?.name);
  return id && name ? { id, name } : null;
}

/**
 * One label, by its exact name
 *
 * Exact match only, unlike findLabelId's case-insensitive fallback: a marker's name is
 * generated by this app itself, never typed by a user, so there is nothing here to be lenient
 * about -- and leniency is exactly the kind of slack a name collision could exploit.
 *
 * @param labels
 * @param name
 * @returns the label, or null when nothing matches exactly
 */
export function findLabelByExactName(labels: RawLabel[], name: string): RawLabel | null {
  return labels.find((l) => l.name === name) ?? null;
}

/**
 * Whether a label recovered after a 409 is safe to trust as this run's own marker
 *
 * A 409 only proves a label of this name exists, not that this app is the one that made it.
 * The name alone carries a fresh random run id, which makes a genuine collision with a label
 * someone else made close to impossible -- but "close to impossible" is not proof, and proof
 * is what is needed before a later sweep is let loose on whatever this id points to. So every
 * property createHiddenLabel itself would have set is checked: a real user label, hidden from
 * every Gmail client, named with this app's own marker prefix. Anything less is treated as the
 * conflict it actually is, not smoothed over.
 *
 * @param label
 * @returns true only when every one of those holds
 */
export function looksLikeOwnMarker(label: RawLabel): boolean {
  return (
    label.type === 'user' &&
    label.labelListVisibility === 'labelHide' &&
    isMarkerLabelName(label.name)
  );
}

/**
 * What a 409 on a marker create resolves to
 *
 * Split out from createHiddenLabel so the validation above is checkable without the network:
 * given whatever a name lookup found, this decides whether it may be trusted or must be
 * refused. Throwing on the 409 itself -- the "safer"-looking alternative -- is not actually
 * safer: a 409 here means the create reached Gmail but its own answer did not, which is a
 * recoverable hiccup and an expected one, not a reason to make a mailbox permanently
 * uncopyable. What must not happen instead is trusting the recovered id blindly.
 *
 * @param name the marker name the create was for
 * @param recovered whatever findLabelByExactName found under that name, or null
 * @returns the id to use, or the reason to refuse it
 */
export function resolveConflictedMarker(
  name: string,
  recovered: RawLabel | null,
): { ok: true; id: string } | { ok: false; reason: string } {
  if (!recovered) {
    return { ok: false, reason: `label '${name}' kon niet worden hersteld na een conflict` };
  }
  if (!looksLikeOwnMarker(recovered)) {
    return { ok: false, reason: `label '${name}' bestaat al, maar is niet van deze app` };
  }
  return { ok: true, id: recovered.id };
}

/**
 * One label, by its exact name, read straight from the mailbox
 *
 * @param accessToken
 * @param name
 * @returns the label, or null when nothing matches
 */
export async function fetchLabel(accessToken: string, name: string): Promise<RawLabel | null> {
  return findLabelByExactName(parseAllLabels(await requestJson(LABELS_URL, accessToken)), name);
}

/**
 * The user's own labels, name to id
 *
 * Markers are left out: they are this app's bookkeeping, and a tree must never be planned to
 * land in one. Unlike parseLabels this keeps the nesting untouched and adds no system label,
 * because a name is what a tree is calculated from.
 *
 * @param raw from parseAllLabels
 * @returns name to id
 */
export function userLabelMap(raw: RawLabel[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of raw) {
    if (l.type !== 'user' || isMarkerLabelName(l.name)) continue;
    out.set(l.name, l.id);
  }
  return out;
}

/**
 * Every label a mailbox has, in one request
 *
 * One listing per mailbox rather than one lookup per label: a tree of forty would otherwise be
 * forty round trips to learn what forty names already are.
 *
 * @param accessToken
 * @returns name to id
 */
export async function fetchUserLabelMap(accessToken: string): Promise<Map<string, string>> {
  return userLabelMap(parseAllLabels(await requestJson(LABELS_URL, accessToken)));
}

/**
 * Creates one run's marker label, hidden from every Gmail client including this app's own
 * picker
 *
 * A create cut off before its answer came back is genuinely ambiguous -- it may have landed --
 * so a retry after that must not risk a duplicate. `name` is deterministic in the run id for
 * exactly that reason: a 409 on retry means the earlier attempt did land, and the label's id
 * is recovered by looking its own name up rather than minting a second one. See
 * resolveConflictedMarker for why that recovered label is checked before it is trusted, rather
 * than being handed back as soon as a name match is found.
 *
 * @param accessToken
 * @param name from markerLabelName, so a retry names the same label
 * @returns the label's id and name
 * @throws whatever the create failed with, or the conflict's own reason when a 409's recovery
 *   does not check out
 */
export async function createHiddenLabel(
  accessToken: string,
  name: string,
): Promise<{ id: string; name: string }> {
  try {
    const json = await requestJson(LABELS_URL, accessToken, {
      method: 'POST',
      contentType: 'application/json',
      body: Buffer.from(labelCreateBody(name), 'utf8'),
    });
    const created = parseCreatedLabel(json);
    if (!created) throw new Error('Gmail gaf geen label terug');
    return created;
  } catch (e) {
    if (!(e instanceof GmailHttpError) || e.status !== 409) throw e;
    const resolved = resolveConflictedMarker(name, await fetchLabel(accessToken, name));
    if (!resolved.ok) throw new Error(resolved.reason);
    return { id: resolved.id, name };
  }
}

/**
 * Creates one label the user can see, or finds the one already carrying the name
 *
 * Unlike a marker, a real label with the wanted name is precisely what was wanted, so a 409 is
 * resolved by using it -- there is nothing here to distrust and resolveConflictedMarker does
 * not apply.
 *
 * @param accessToken
 * @param name the full nested name, `Archief/Klanten/Acme`
 * @returns the label's id and name
 * @throws whatever the create failed with, or a reason of its own when a 409 cannot be
 *   resolved either
 */
export async function createVisibleLabel(
  accessToken: string,
  name: string,
): Promise<{ id: string; name: string }> {
  try {
    const json = await requestJson(LABELS_URL, accessToken, {
      method: 'POST',
      contentType: 'application/json',
      body: Buffer.from(visibleLabelCreateBody(name), 'utf8'),
    });
    const created = parseCreatedLabel(json);
    if (!created) throw new Error('Gmail gaf geen label terug');
    return created;
  } catch (e) {
    if (!(e instanceof GmailHttpError) || e.status !== 409) throw e;
    const existing = await fetchLabel(accessToken, name);
    if (!existing) throw new Error(`label '${name}' bestaat al, maar kon niet worden opgezocht`);
    return { id: existing.id, name: existing.name };
  }
}

/**
 * Deletes a label, once nothing needs it any more
 *
 * Best-effort by every call site: a marker label left behind after its messages are already
 * stripped or trashed costs the user nothing they can see, so this is cleanup, not correctness.
 * A label already gone (a repeat of this same call) is treated as success rather than an error.
 *
 * @param accessToken
 * @param labelId
 * @returns {Promise<void>}
 */
export async function deleteLabel(accessToken: string, labelId: string): Promise<void> {
  try {
    await requestJson(labelGetUrl(labelId), accessToken, {
      method: 'DELETE',
      contentType: 'application/json',
      body: Buffer.from('', 'utf8'),
    });
  } catch (e) {
    if (e instanceof GmailHttpError && e.status === 404) return;
    throw e;
  }
}


//===========================
// Threads
//===========================

/** The largest page threads.list will answer. It costs the same ten units as a page of a
 * hundred, so asking for less only buys round trips: listing a label of twenty thousand was two
 * hundred requests waiting on each other, and the strip said "Mail zoeken…" for every one of
 * them. messages.list beside it has asked for five hundred all along. */
export const THREADS_PAGE_SIZE = 500;

export function threadsListUrl(labelId: string, pageToken?: string): string {
  const q = new URLSearchParams({ labelIds: labelId, maxResults: String(THREADS_PAGE_SIZE) });
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
 * Walks pages of thread ids, whatever is answering them
 *
 * The page reader is a dependency so a test can check the walk: the paging, the deduplicating,
 * the cap and being able to stop between pages are where a label of twenty thousand is won or
 * lost, and none of that needs Gmail.
 *
 * @param max
 * @param readPage answers one page, given the token the page before it handed on
 * @param onPage the running total after each page; answer false to stop paging, which is how a
 *   cancelled drag gets out of a listing that would otherwise run to the end of the label
 * @returns {Promise<{threadIds: string[], capped: boolean, stopped: boolean}>} the ids in the
 *   order the pages gave them, whether the cap bit, and whether onPage called it off
 */
export async function walkThreadPages(
  max: number,
  readPage: (pageToken?: string) => Promise<{ threadIds: string[]; nextPageToken?: string }>,
  onPage?: (soFar: number) => boolean,
): Promise<{ threadIds: string[]; capped: boolean; stopped: boolean }> {
  const threadIds: string[] = [];
  // Beside the array rather than Array.includes per id. This walk runs on the main process, and
  // a linear scan per id is quadratic in the size of the label: twenty thousand ids came to two
  // hundred million comparisons, which froze the window for the whole listing.
  const seen = new Set<string>();
  let pageToken: string | undefined;
  do {
    const page = await readPage(pageToken);
    for (const id of page.threadIds) {
      if (threadIds.length >= max) return { threadIds, capped: true, stopped: false };
      if (seen.has(id)) continue;
      seen.add(id);
      threadIds.push(id);
    }
    pageToken = page.nextPageToken;
    if (onPage && onPage(threadIds.length) === false) {
      return { threadIds, capped: false, stopped: true };
    }
  } while (pageToken);
  return { threadIds, capped: false, stopped: false };
}

/**
 * Every thread under a label, one page at a time
 *
 * @param accessToken
 * @param labelId
 * @param max
 * @param onPage the running total after each page; answer false to stop paging
 * @returns {Promise<{threadIds: string[], capped: boolean, stopped: boolean}>} capped says the
 *   label holds more than the caller asked for, stopped that onPage called the walk off
 */
export async function listLabelThreadIds(
  accessToken: string,
  labelId: string,
  max: number,
  onPage?: (soFar: number) => boolean,
): Promise<{ threadIds: string[]; capped: boolean; stopped: boolean }> {
  return await walkThreadPages(
    max,
    async (pageToken) =>
      parseThreadList(await requestJson(threadsListUrl(labelId, pageToken), accessToken)),
    onPage,
  );
}

/**
 * Reads every message of a thread
 *
 * The network is a dependency so a test can check the list keeps its shape: dropping an
 * unreadable message is what once made a short copy look like a complete one. The order is
 * mapLimit's, which is the order of the ids and not the order the answers arrive in.
 *
 * @param ids
 * @param read
 * @param limit how many messages to read at once
 * @returns {Promise<ThreadMessage[]>} one entry per id, in the thread's own order, and a
 *   message that could not be read stays in as an error
 */
export async function collectThreadMessages(
  ids: string[],
  read: (id: string) => Promise<Buffer | null>,
  limit = MESSAGE_FETCH_LIMIT,
): Promise<ThreadMessage[]> {
  return await mapLimit(ids, limit, async (id) => {
    try {
      const raw = await read(id);
      return raw ? { id, raw } : { id, error: 'Gmail gaf geen bron voor dit bericht' };
    } catch (e) {
      return { id, error: `Ophalen mislukt (${(e as Error).message})` };
    }
  });
}

export async function fetchThreadMessages(
  accessToken: string,
  threadId: string,
): Promise<ThreadMessage[]> {
  const ids = parseThreadMessageIds(await requestJson(threadMessagesUrl(threadId), accessToken));
  const oneByOne = () =>
    collectThreadMessages(ids, async (id) =>
      parseMessageRaw(await requestJson(messageRawUrl(id), accessToken)),
    );

  // The sources of a conversation are the bulk of a drag: one batch instead of one request per
  // message is where the waiting goes. Small groups, because a part here is a whole mail.
  let answers: Array<unknown | null>;
  try {
    answers = await requestBatch(ids.map(messageRawUrl), accessToken, RAW_BATCH_LIMIT);
  } catch (e) {
    notifyLog(`[gmail] batch mislukt, bericht voor bericht: ${(e as Error).message}`);
    return await oneByOne();
  }
  if (batchLooksBroken(answers)) {
    notifyLog('[gmail] batch gaf niets bruikbaars, bericht voor bericht');
    return await oneByOne();
  }
  return ids.map((id, i) => {
    const raw = parseMessageRaw(answers[i]);
    return raw ? { id, raw } : { id, error: 'Gmail gaf geen bron voor dit bericht' };
  });
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
    messageId: header('message-id'),
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

/**
 * Puts a message in the trash
 *
 * Opts into 'POST_IDEMPOTENT' retries, unlike every other write in this file: trashing an
 * already-trashed message is a no-op, so a trash that timed out is safe to send again. An
 * insert is never given this treatment -- see retry.ts for why.
 *
 * @param accessToken
 * @param messageId
 * @returns {Promise<void>}
 */
export async function trashMessage(accessToken: string, messageId: string): Promise<void> {
  await requestJson(
    messageTrashUrl(messageId),
    accessToken,
    {
      method: 'POST',
      contentType: 'application/json',
      body: Buffer.from('{}', 'utf8'),
    },
    'POST_IDEMPOTENT',
  );
}

/**
 * The newest mail in the inbox, ids only
 *
 * `max` is a handful: this answers "which mail was that notification about", and that mail
 * arrived seconds ago or is not worth more requests to find.
 *
 * @param max
 * @returns the URL
 */
export function recentInboxUrl(max: number): string {
  const q = new URLSearchParams({ labelIds: 'INBOX', maxResults: String(Math.max(1, max)) });
  return `${MESSAGES_URL}?${q.toString()}`;
}

export async function fetchRecentInboxIds(accessToken: string, max: number): Promise<string[]> {
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

/**
 * The query that asks after several Message-IDs at once
 *
 * @param messageIds the RFC822 Message-IDs
 * @returns the query, empty when none of them was usable
 */
export function batchedMessageIdQuery(messageIds: string[]): string {
  return messageIds
    .map((id) => (id ?? '').trim().replace(/^<+|>+$/g, ''))
    .filter((id) => id.length > 0)
    .map((id) => `rfc822msgid:${id}`)
    .join(' OR ');
}

/**
 * Splits Message-IDs into chunks one query can carry
 *
 * @param messageIds
 * @param size
 * @returns the chunks, in the order the ids came in
 */
export function messageIdChunks(messageIds: string[], size = BATCH_QUERY_LIMIT): string[][] {
  const out: string[][] = [];
  for (let at = 0; at < messageIds.length; at += size) {
    out.push(messageIds.slice(at, at + size));
  }
  return out;
}

/**
 * The one search that asks a mailbox about a whole chunk of Message-IDs
 *
 * @param messageIds the chunk
 * @param canary a Message-ID the mailbox is known to hold, which proves the query parsed
 * @returns the URL
 */
export function searchManyUrl(messageIds: string[], canary: string): string {
  const q = batchedMessageIdQuery([...messageIds, canary]);
  // Every asked id can match more than once, and the canary needs a slot of its own
  const maxResults = Math.min(500, (messageIds.length + 1) * SEARCH_MATCH_LIMIT);
  return `${MESSAGES_URL}?${new URLSearchParams({ q, maxResults: String(maxResults) })}`;
}

/** The metadata call that answers both halves of the duplicate question at once: which mail
 * this is, and what it is filed under. */
export function messageIdAndLabelsUrl(messageId: string): string {
  const q = new URLSearchParams({ format: 'metadata' });
  q.append('metadataHeaders', 'Message-ID');
  return `${MESSAGES_URL}/${encodeURIComponent(messageId)}?${q.toString()}`;
}

/**
 * Reads which mail a search hit is, and what holds it
 *
 * @param json one message in metadata form
 * @returns {null} when there is no Message-ID, since then it cannot be matched to what was
 *   asked and counting it would be guessing
 */
export function parseMessageIdAndLabels(
  json: unknown,
): { messageId: string; labelIds: string[] } | null {
  const headers = (json as { payload?: { headers?: unknown } })?.payload?.headers;
  const list = Array.isArray(headers) ? (headers as Array<{ name?: unknown; value?: unknown }>) : [];
  for (const h of list) {
    if (typeof h?.name === 'string' && h.name.toLowerCase() === 'message-id') {
      const messageId = stringFrom(h.value) ?? '';
      if (messageId) return { messageId, labelIds: parseMessageLabelIds(json) };
    }
  }
  return null;
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
 * Nothing calls this since the check at Kopieer started asking labelsHoldingMany the wider
 * question a mailbox at a time. Kept while the batched query has not been proven against real
 * Gmail: this is the path that worked, one request per label per message, and it is what to come
 * back to if that turns out not to hold.
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

// two calls per mailbox rather than one per label: find the message, then read what it is
// filed under, since "already there under another label" is exactly what a second copy is
//
// spam and trash stay out: a mail someone threw away is not a copy standing in the way

/**
 * The search that finds one message anywhere in a mailbox
 *
 * @param messageId the RFC822 Message-ID
 * @returns the URL
 */
export function searchAnywhereUrl(messageId: string, maxResults = SEARCH_MATCH_LIMIT): string {
  const q = new URLSearchParams({ q: messageIdQuery(messageId), maxResults: String(maxResults) });
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
 * Reads the messages a search turned up
 *
 * @param json
 * @returns the ids, empty when the search found nothing
 */
export function parseMessageIds(json: unknown): string[] {
  const raw = (json as { messages?: unknown })?.messages;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const m of raw) {
    const id = stringFrom((m as { id?: unknown })?.id);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
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
 * Every match, not the first one: a mailbox can hold one Message-ID as two messages -- one
 * that arrived and one that was copied in -- and then the labels of the first say nothing
 * about the second. Asking whether a given label holds the mail has to come out the same
 * either way, and only the union does that.
 *
 * @param accessToken
 * @param messageId the RFC822 Message-ID
 * @returns {Promise<string[]>} empty when the mailbox does not have it at all
 */
/**
 * A Message-ID this mailbox is certainly findable by, to prove a batched query parsed
 *
 * Taken from the inbox on purpose: a default Gmail search leaves spam and trash out, so a
 * canary from either would be missing for a reason that has nothing to do with the query.
 *
 * @param accessToken
 * @returns the Message-ID, or an empty string when the mailbox has no inbox mail to point at,
 *   in which case there is nothing to prove a batched query with
 */
export async function mailboxCanary(accessToken: string): Promise<string> {
  const [newest] = await fetchRecentInboxIds(accessToken, 1);
  if (!newest) return '';
  const meta = parseMessageIdAndLabels(
    await requestJson(messageIdAndLabelsUrl(newest), accessToken),
  );
  return meta?.messageId ?? '';
}

/**
 * Reads the answer to a query that asked after several Message-IDs at once
 *
 * Gmail answers a query it did not parse the way we meant with an empty result, and empty is
 * also the common real answer, so the two cannot be told apart. The query therefore carries
 * one Message-ID the mailbox is known to hold: if that one does not come back, the answer says
 * nothing about the others and the caller has to ask one at a time.
 *
 * @param asked the Message-IDs the query was about, brackets or not
 * @param hits what came back, each already resolved to its own Message-ID
 * @param canary a Message-ID this mailbox is known to hold
 * @returns whether the answer may be believed, and per asked id the labels holding it
 */
export function scanFromBatch(
  asked: string[],
  hits: Array<{ messageId: string; labelIds: string[] }>,
  canary: string,
): { trusted: boolean; found: Array<{ messageId: string; labelIds: string[] }> } {
  const bare = (id: string) => (id ?? '').trim().replace(/^<+|>+$/g, '');
  const byId = new Map<string, string[]>();
  for (const h of hits) {
    const key = bare(h.messageId);
    const known = byId.get(key) ?? [];
    for (const labelId of h.labelIds) if (!known.includes(labelId)) known.push(labelId);
    byId.set(key, known);
  }

  const proof = bare(canary);
  if (!proof || !byId.has(proof)) return { trusted: false, found: [] };

  return {
    trusted: true,
    found: asked.map((id) => ({ messageId: id, labelIds: byId.get(bare(id)) ?? [] })),
  };
}

/**
 * Which labels hold each of these messages, asked a chunk at a time
 *
 * One search per chunk instead of one per message, which is where the requests go on a drag of
 * a hundred. An answer is only read when the canary proves the query was understood; a chunk
 * that cannot be proved falls back to asking after its messages one by one, which is what this
 * function replaces and always gives the same answer.
 *
 * @param accessToken
 * @param messageIds the RFC822 Message-IDs
 * @param canary from mailboxCanary, empty when the mailbox could not supply one
 * @returns one entry per asked id, in order, with the labels holding it
 */
export async function labelsHoldingMany(
  accessToken: string,
  messageIds: string[],
  canary: string,
): Promise<Array<{ messageId: string; labelIds: string[] }>> {
  const perChunk = await mapLimit(
    messageIdChunks(messageIds),
    MESSAGE_FETCH_LIMIT,
    async (chunk) => {
      if (canary) {
        const hits = parseMessageIds(await requestJson(searchManyUrl(chunk, canary), accessToken));
        const resolved = await batchedOrOneByOne(
          hits.map(messageIdAndLabelsUrl),
          accessToken,
          BATCH_LIMIT,
        ).then((answers) => answers.map(parseMessageIdAndLabels));
        const batch = scanFromBatch(
          chunk,
          resolved.filter((r): r is { messageId: string; labelIds: string[] } => r !== null),
          canary,
        );
        if (batch.trusted) return batch.found;
      }
      return await mapLimit(chunk, MESSAGE_FETCH_LIMIT, async (messageId) => ({
        messageId,
        labelIds: await labelsHoldingMessage(accessToken, messageId),
      }));
    },
  );
  return perChunk.flat();
}

export async function labelsHoldingMessage(
  accessToken: string,
  messageId: string,
): Promise<string[]> {
  if (!(messageId ?? '').trim()) return [];
  const found = parseMessageIds(await requestJson(searchAnywhereUrl(messageId), accessToken));
  if (found.length === 0) return [];
  const perMatch = (
    await batchedOrOneByOne(found.map(messageLabelsUrl), accessToken)
  ).map(parseMessageLabelIds);
  const out: string[] = [];
  for (const labelIds of perMatch) {
    for (const labelId of labelIds) if (!out.includes(labelId)) out.push(labelId);
  }
  return out;
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
 * `threadId` is what keeps a copied conversation a conversation: Gmail does not thread an
 * inserted message on its headers alone, so six replies would arrive as six mails.
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
 * Apart from the id: that proves the insert happened, this is what the rest is filed under.
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
 * @param signal aborted when a running copy is told to stop, so this upload is severed
 *   rather than left to finish -- see GmailCancelledError
 * @returns {Promise<{id: string|null, threadId: string|null}>} what Gmail filed it as
 */
export async function insertMessage(
  accessToken: string,
  raw: Buffer,
  labelIds: string[],
  threadId?: string,
  signal?: AbortSignal,
): Promise<{ id: string | null; threadId: string | null }> {
  const boundary = pickBoundary(raw);
  const json = await requestJson(
    INSERT_URL,
    accessToken,
    {
      method: 'POST',
      contentType: `multipart/related; boundary=${boundary}`,
      body: multipartBody(raw, labelIds, boundary, threadId),
    },
    undefined,
    signal,
  );
  return { id: parseInsertedId(json), threadId: parseInsertedThreadId(json) };
}

/**
 * Every Gmail id currently matching this RFC822 Message-ID in a mailbox
 *
 * What reconciling a severed insert starts from: searchAnywhereUrl and parseMessageIds,
 * already used for the duplicate check, answered directly rather than folded into a wider
 * question the way labelsHoldingMessage does.
 *
 * @param accessToken
 * @param messageId the RFC822 Message-ID
 * @returns the ids, empty when the mailbox holds none
 */
export async function searchAnywhere(accessToken: string, messageId: string): Promise<string[]> {
  if (!(messageId ?? '').trim()) return [];
  return parseMessageIds(await requestJson(searchAnywhereUrl(messageId), accessToken));
}

/**
 * The labels one found message carries
 *
 * @param accessToken
 * @param gmailId Gmail's own id, not the RFC822 one
 * @returns the label ids
 */
export async function fetchMessageLabelIds(accessToken: string, gmailId: string): Promise<string[]> {
  return parseMessageLabelIds(await requestJson(messageLabelsUrl(gmailId), accessToken));
}


//===========================
// Marker sweep
//===========================

/**
 * One page of every message currently under a label
 *
 * The same `labelIds=` filter recentInboxUrl and threadsListUrl already use, paged like
 * threadsListUrl rather than capped like recentInboxUrl: a sweep must account for every
 * message under the marker, not just the newest handful.
 *
 * @param labelId
 * @param pageToken
 * @returns the URL
 */
export function messagesUnderLabelUrl(labelId: string, pageToken?: string): string {
  const q = new URLSearchParams({ labelIds: labelId, maxResults: '500' });
  if (pageToken) q.set('pageToken', pageToken);
  return `${MESSAGES_URL}?${q.toString()}`;
}

/**
 * Reads one page of a message listing
 *
 * @param json
 * @returns the ids on this page, and where to carry on from
 */
export function parseMessageListPage(json: unknown): { ids: string[]; nextPageToken?: string } {
  const ids = parseThreadMessageIds(json);
  const next = stringFrom((json as { nextPageToken?: unknown })?.nextPageToken);
  return next ? { ids, nextPageToken: next } : { ids };
}

/**
 * One page of whatever currently carries a label
 *
 * @param accessToken
 * @param labelId
 * @param pageToken
 * @returns the page, for copy-marker-sweep.ts's own paging loop to drive to exhaustion
 */
export async function fetchMessageListPage(
  accessToken: string,
  labelId: string,
  pageToken?: string,
): Promise<{ ids: string[]; nextPageToken?: string }> {
  return parseMessageListPage(await requestJson(messagesUnderLabelUrl(labelId, pageToken), accessToken));
}

export function messagesBatchModifyUrl(): string {
  return `${MESSAGES_URL}/batchModify`;
}

/**
 * The body that adds or removes labels from many messages at once
 *
 * @param ids at most BATCH_MODIFY_LIMIT
 * @param action
 * @returns the JSON body to POST
 */
export function batchModifyBody(
  ids: string[],
  action: { addLabelIds?: string[]; removeLabelIds?: string[] },
): string {
  return JSON.stringify({ ids, ...action });
}

/**
 * Adds or removes labels from up to BATCH_MODIFY_LIMIT messages in one call
 *
 * Answers with an empty body on success -- see attemptJson's empty-body handling -- so success
 * here is the call not throwing, not anything read out of the response.
 *
 * @param accessToken
 * @param ids at most BATCH_MODIFY_LIMIT; a caller with more must chunk before calling this --
 *   see copy-marker-sweep.ts
 * @param action
 * @returns {Promise<void>}
 */
export async function batchModifyMessages(
  accessToken: string,
  ids: string[],
  action: { addLabelIds?: string[]; removeLabelIds?: string[] },
): Promise<void> {
  await requestJson(messagesBatchModifyUrl(), accessToken, {
    method: 'POST',
    contentType: 'application/json',
    body: Buffer.from(batchModifyBody(ids, action), 'utf8'),
  });
}


//===========================
// Helper functions
//===========================

/** The quota is per user, so the budget is too. A refreshed token starts a fresh window,
 * which at worst lets one window through twice; the map is trimmed because a long session
 * refreshes many times. */
const budgets = new Map<string, QuotaBudget>();

const MAX_BUDGETS = 16;

function budgetFor(accessToken: string): QuotaBudget {
  const known = budgets.get(accessToken);
  if (known) return known;
  const made = createQuotaBudget(
    {
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    },
    // Through the log the app keeps, not console.warn: a ceiling that moved is the one signal
    // that this project has been put on the tighter price list, and a line nobody can find
    // afterwards is no signal at all.
    notifyLog,
  );
  budgets.set(accessToken, made);
  for (const key of [...budgets.keys()].slice(0, Math.max(0, budgets.size - MAX_BUDGETS))) {
    budgets.delete(key);
  }
  return made;
}

/** A request that never got an answer, apart from one that got a bad one: only the second
 * kind is safe to send again after an insert. */
class GmailTimeoutError extends Error {}

/**
 * The one request every call in this file goes through
 *
 * Refused requests are sent again on the statuses that mean "not now" — see retry.ts for
 * why an insert is treated differently from a read.
 *
 * @param url
 * @param accessToken
 * @param init a body turns the call into a POST of that content type
 * @param retryMethod overrides the retry policy's method, for the one write that is safe to
 *   repeat blindly. Defaults to the plain `init ? 'POST' : 'GET'` reading, so every existing
 *   call site -- insert included -- keeps today's exact behaviour untouched.
 * @param signal aborted to sever this request outright -- see GmailCancelledError. Every
 *   existing call site leaves this undefined, which is never aborted, so nothing about their
 *   behaviour changes either.
 * @returns {Promise<unknown>} the parsed answer
 * @throws {GmailHttpError} on any status from 400, carrying Gmail's own message
 * @private
 */
async function requestJson(
  url: string,
  accessToken: string,
  init?: { method: string; contentType: string; body: Buffer },
  retryMethod?: RetryMethod,
  signal?: AbortSignal,
): Promise<unknown> {
  const call = callForUrl(url, init?.method ?? 'GET');
  return await withRetry(
    async () => {
      const budget = budgetFor(accessToken);
      // Per attempt rather than per request: a retry after a 429 is another request as far as
      // Gmail is concerned, and going straight back out is what earned the 429.
      await budget.take(call);
      try {
        return await attemptJson(url, accessToken, init, signal);
      } catch (e) {
        // A refusal while the budget still believed there was room means the budget is reading
        // the wrong price list -- which is exactly what happens when Google moves this project
        // to the table it published in May 2026, and nobody is told when that is.
        if (e instanceof GmailHttpError && isRateLimit(e.status, e.reason)) budget.refused();
        throw e;
      }
    },
    (e) => ({
      method: retryMethod ?? (init ? 'POST' : 'GET'),
      status: e instanceof GmailHttpError ? e.status : null,
      timedOut: e instanceof GmailTimeoutError,
      rateLimited: e instanceof GmailHttpError && isRateLimit(e.status, e.reason),
      // A cut request is not a timeout: retry.ts refuses both, but only this one is a
      // deliberate choice worth telling apart from an ambiguous one when something later
      // reads the log back.
      cancelled: e instanceof GmailCancelledError,
      retryAfter: e instanceof GmailHttpError ? e.retryAfter : null,
    }),
  );
}

/**
 * One attempt at a request
 *
 * @param url
 * @param accessToken
 * @param init a body turns the call into a POST of that content type
 * @returns {Promise<unknown>} the parsed answer
 * @private
 */
/**
 * Sends a set of reads as one request and hands back the answers
 *
 * The quota is booked per inner call, because that is how Gmail counts a batch. So this saves
 * round trips and not units, which is the whole point: the drag was never short of budget.
 *
 * @param urls the calls to make, full URLs or paths
 * @param accessToken
 * @param limit how many go in one request
 * @returns per input url, in order, the parsed answer, or null for a call that failed on its
 *   own — the caller decides what to do about that one rather than losing the whole group
 */
export async function requestBatch(
  urls: string[],
  accessToken: string,
  limit = BATCH_LIMIT,
): Promise<Array<unknown | null>> {
  const out = new Array<unknown | null>(urls.length).fill(null);
  const groups: Array<{ at: number; urls: string[] }> = [];
  for (let at = 0; at < urls.length; at += limit) {
    groups.push({ at, urls: urls.slice(at, at + limit) });
  }

  await mapLimit(groups, BATCH_IN_FLIGHT, async (group) => {
    const boundary = `gmd_batch_${randomBytes(12).toString('hex')}`;
    const body = Buffer.from(batchBody(group.urls.map(batchPath), boundary), 'utf8');
    const answer = await withRetry(
      async () => {
        const budget = budgetFor(accessToken);
        for (const url of group.urls) await budget.take(callForUrl(url));
        try {
          return await attemptMultipart(BATCH_URL, accessToken, boundary, body);
        } catch (e) {
          if (e instanceof GmailHttpError && isRateLimit(e.status, e.reason)) budget.refused();
          throw e;
        }
      },
      (e) => ({
        method: 'GET',
        status: e instanceof GmailHttpError ? e.status : null,
        timedOut: e instanceof GmailTimeoutError,
        rateLimited: e instanceof GmailHttpError && isRateLimit(e.status, e.reason),
        retryAfter: e instanceof GmailHttpError ? e.retryAfter : null,
      }),
    );

    for (const part of parseBatchBody(answer.body, boundaryFrom(answer.contentType))) {
      const at = Number(part.id);
      if (Number.isInteger(at) && at >= 0 && at < group.urls.length) {
        out[group.at + at] = part.json;
      }
    }
  });
  return out;
}

/**
 * Reads a set of URLs in one batch, or one by one when the batch cannot be trusted
 *
 * @param urls
 * @param accessToken
 * @param limit how many go in one batch
 * @returns per url, in order, the parsed answer or null
 */
export async function batchedOrOneByOne(
  urls: string[],
  accessToken: string,
  limit = BATCH_LIMIT,
): Promise<Array<unknown | null>> {
  const oneByOne = () =>
    mapLimit(urls, MESSAGE_FETCH_LIMIT, async (url) => {
      try {
        return await requestJson(url, accessToken);
      } catch {
        return null;
      }
    });

  let answers: Array<unknown | null>;
  try {
    answers = await requestBatch(urls, accessToken, limit);
  } catch (e) {
    notifyLog(`[gmail] batch mislukt, één voor één: ${(e as Error).message}`);
    return await oneByOne();
  }
  if (batchLooksBroken(answers)) {
    notifyLog('[gmail] batch gaf niets bruikbaars, één voor één');
    return await oneByOne();
  }
  return answers;
}

/**
 * One attempt at a multipart request, answered raw
 *
 * Apart from attemptJson because a batch answer is not JSON: it has to come back as text with
 * its content type, since the boundary to split it on is in that header.
 *
 * @param url
 * @param accessToken
 * @param boundary
 * @param body
 * @returns the body and the content type it came with
 * @private
 */
async function attemptMultipart(
  url: string,
  accessToken: string,
  boundary: string,
  body: Buffer,
): Promise<{ body: string; contentType: string }> {
  const { net } = require('electron') as typeof import('electron');
  return await new Promise((resolve, reject) => {
    const req = net.request({ url, method: 'POST' });
    for (const [name, value] of Object.entries(
      apiHeaders(accessToken, `multipart/mixed; boundary=${boundary}`),
    )) {
      req.setHeader(name, value);
    }

    const timer = setTimeout(() => {
      req.abort();
      reject(new GmailTimeoutError('geen antwoord van Google (time-out)'));
    }, BATCH_TIMEOUT_MS);
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
        // A batch refused as a whole answers with a status of its own, and the parts never
        // arrive. That is the one case the caller cannot recover from part by part.
        if (res.statusCode >= 400) {
          fail(
            new GmailHttpError(
              `batch geweigerd (HTTP ${res.statusCode})`,
              res.statusCode,
              headerValue(res.headers, 'retry-after'),
            ),
          );
          return;
        }
        ok({ body: text, contentType: headerValue(res.headers, 'content-type') ?? '' });
      });
      res.on('error', fail);
    });
    req.on('error', fail);
    req.write(body);
    req.end();
  });
}

async function attemptJson(
  url: string,
  accessToken: string,
  init?: { method: string; contentType: string; body: Buffer },
  signal?: AbortSignal,
): Promise<unknown> {
  // Already told to stop before this attempt even started: nothing is opened, so this
  // cannot possibly have landed -- dispatched: false, unlike a mid-flight cut below.
  if (signal?.aborted) {
    throw new GmailCancelledError('geannuleerd door de gebruiker', false);
  }

  const { net } = require('electron') as typeof import('electron');
  return await new Promise((resolve, reject) => {
    const req = net.request({ url, method: init?.method ?? 'GET' });
    for (const [name, value] of Object.entries(apiHeaders(accessToken, init?.contentType))) {
      req.setHeader(name, value);
    }

    const timer = setTimeout(() => {
      req.abort();
      reject(new GmailTimeoutError('geen antwoord van Google (time-out)'));
    }, init ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
    const settle = <T>(fn: (v: T) => void) => (v: T) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onCancel);
      fn(v);
    };
    const ok = settle(resolve);
    const fail = settle(reject);
    // Severs a request already on the wire. Routed through `fail` rather than a raw reject,
    // so the timeout timer this same attempt started is cleared too -- otherwise it would
    // still fire on an already-settled promise up to UPLOAD_TIMEOUT_MS later, for nothing.
    const onCancel = () => {
      req.abort();
      // req.end() below always runs synchronously, with nothing awaited in between, so by
      // the time this can fire the request has already gone out -- dispatched: true.
      fail(new GmailCancelledError('geannuleerd door de gebruiker', true));
    };
    signal?.addEventListener('abort', onCancel);
    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        // The status before the body: a rate limit sometimes arrives as an HTML page from
        // Google's front end, and reading that as "unreadable" would hide the one answer
        // that is worth waiting out.
        const after = headerValue(res.headers, 'retry-after');
        let json: unknown;
        // batchModify and a label delete both answer success with an empty body -- there is
        // nothing to parse, and that is not the same thing as an unreadable answer.
        if (res.statusCode < 400 && text.trim() === '') {
          ok({});
          return;
        }
        try {
          json = JSON.parse(text);
        } catch {
          const unreadable = `onleesbaar antwoord (HTTP ${res.statusCode})`;
          fail(
            res.statusCode >= 400
              ? new GmailHttpError(unreadable, res.statusCode, after)
              : new Error(unreadable),
          );
          return;
        }
        if (res.statusCode >= 400) {
          const msg = (json as { error?: { message?: string } })?.error?.message;
          fail(
            new GmailHttpError(
              msg ?? `HTTP ${res.statusCode}`,
              res.statusCode,
              after,
              parseErrorReason(json),
            ),
          );
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

// Electron hands a header back as a string or as a list of them, depending on the header
const headerValue = (headers: Record<string, string | string[]>, name: string): string | null => {
  const v = headers?.[name] ?? headers?.[name.toLowerCase()];
  const first = Array.isArray(v) ? v[0] : v;
  return typeof first === 'string' && first ? first : null;
};

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
