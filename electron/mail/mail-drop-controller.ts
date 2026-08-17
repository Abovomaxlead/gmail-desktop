// Dragging mail out of Gmail and onto the desktop, and copying what that saved into another
// mailbox.
//
// Two routes reach the same list and they do not find the same messages. The API lists every
// message in a thread; the page route reads Gmail's "show original" page and can only save
// what that page links to, and a long conversation arrives there with its older messages
// collapsed and their links gone -- so a thread of twelve became a copy of three reporting
// itself as three of three. The API goes first for that reason, and the page is what is left
// when a mailbox has no token.
//
// A mailbox reached by delegation has no second route at all. Its page needs the
// /d/<token>/ part of the URL a drag does not carry, and Gmail answers without it with a 403
// -- or with a page saying the message cannot be found, which is a sentence about the user's
// mailbox for a problem that was never in it. So for those, an API failure is the answer.
//
// One mail leaves per drag, not the conversation in pieces: the last message quotes the ones
// before it, which is the whole reason a thread gets dragged. Fetching them all is still not
// wasted -- it is how the newest is known to be the newest.

import { app, session } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC } from '../core/ipc';
import type {
  MailDropCopyAccountResult,
  MailDropCopyResult,
  MailDropCopyTarget,
  MailDropPayload,
  MailDropPreviewItem,
} from '../core/ipc';
import { DEV_URL, SIDEBAR_PRELOAD_PATH } from '../core/paths';
import {
  SESSION_PARTITION,
  dropOverlay,
  keyOf,
  mainWindow,
  manager,
  oauthTokens,
  prefs,
  profiles,
  setDropOverlay,
} from '../core/runtime';
import { mapLimit } from '../core/concurrency';
import { OverlayView } from '../windows/overlay-view';
import { forceRefresh } from '../auth/oauth-flow';
import { oauthConfig } from '../auth/oauth-config';
import { copyTargetEmails, isAllowedAccount } from '../auth/account-domain';
import {
  clearRefreshFailure,
  markRefreshFailed,
} from '../auth/oauth-health-check';
import {
  delegatedTokenFor,
  forgetDelegatedToken,
  isDelegatedMailbox,
  mailboxRefusedText,
  mailboxToken,
  withMailboxToken,
} from '../auth/mailbox-token';
import { notifyLog } from '../notify/notify-log';
import { extractPlainText, htmlToText, parseHeaders } from './eml';
import {
  appendLog,
  draggedMessage,
  newestMessage,
  writeLabel,
  writeThread,
  type LogRecord,
  type SavedMessage,
} from './mail-archive';
import {
  copyTotal,
  copyableLabelIds,
  countExisting,
  duplicateIndex,
  groupDuplicates,
  labelsStillNeeded,
  newMessageCount,
  normalizeTargets,
  type CopyMode,
  type DuplicateHit,
  type ExistingInMailbox,
  type ExistingResult,
} from './mail-copy';
import {
  LABEL_SCRAPE_JS,
  MAX_PAGES,
  MAX_THREADS,
  PAGE_SIZE,
  labelListUrl,
  mergeThreads,
  type LabelThread,
} from './label-drop';
import { fetchThreadEmls } from './mail-fetch';
import { NO_SUBJECT, type MessageRef } from './dropzone';
import {
  GmailHttpError,
  fetchLabelId,
  fetchLabels,
  fetchThreadMessages,
  fetchThreadRaw,
  insertMessage,
  labelsHoldingMessage,
  listLabelThreadIds,
  messageExistsInLabel,
  type AccountLabels,
  type ThreadMessage,
} from '../gmail/gmail-api';
import type { AccountRef } from '../accounts/account-ref';

//===========================
// Types
//===========================

interface SavedRef {
  file: string;
  messageId: string;
  subject: string;
  /** The thread this message came out of, so a copy can put its conversation back
   * together in the target mailbox. Empty when the source is not known per message. */
  threadId: string;
}


//===========================
// Module state
//===========================

/** What the preview window is showing, kept so it can ask again once it has loaded. */
let lastDropPreview: MailDropPreviewItem[] = [];

/** The files the last drag wrote, which are what a copy copies. */
let lastDropSaved: SavedRef[] = [];

/** The mailbox the last drag came out of, left out of the copy targets: filing a mail back
 * into the mailbox it was just dragged from is never what was meant. */
let lastDropSource = '';

/** The duplicate scan for one set of targets, reused when the same drag is copied twice --
* once to be told about duplicates and again to go ahead. Keyed by the drag as well as the
* targets, so a new drag never reuses the previous one's answer. */
let lastScan: { key: string; hits: DuplicateHit[] } | null = null;
let dropSerial = 0;


//===========================
// Exported functions
//===========================

export function mailDropFolder(): string {
  return prefs?.getAll().mailDrop.folder || join(app.getPath('documents'), 'Gmail Desktop', 'Mail');
}

/** What the API route has to say about a thread: the messages, the reason it could not get
 * them, or that this mailbox has no API route at all.
 *
 * Three answers where there were two, and the missing one cost a drag its mail. "No token for
 * this mailbox" and "the API refused" both used to come back as null, on the reasoning that
 * neither was worth reporting because the page route still worked. The paragraph below says
 * why that reasoning does not hold, and the two are told apart here so the caller can act on
 * the difference instead of walking into a route that cannot answer and repeating what it
 * says.
 *
 * The token comes from withMailboxToken rather than the OAuth store, so a mailbox reached by
 * delegation gets the relay's token instead of nothing. For such a mailbox this is not the
 * better of two routes but the only one: the page route needs the /d/<token>/ part of the URL,
 * which a drag does not carry, and Gmail answers the URL without it with a 403 — or, when it
 * feels like phrasing it differently, with a page saying the message cannot be found. Falling
 * back there turned an API hiccup into "Het gevraagde bericht kan niet worden gevonden", which
 * is a sentence about the user's mailbox for a problem that was never in it. */
type ApiThreadResult =
  | { kind: 'messages'; messages: ThreadMessage[] }
  | { kind: 'failed'; error: string }
  | { kind: 'no-route' };

async function threadMessagesViaApi(email: string, threadId: string): Promise<ApiThreadResult> {
  if (!email) return { kind: 'no-route' };
  const withToken = await withMailboxToken(email);
  if (!withToken) return { kind: 'no-route' };
  try {
    return { kind: 'messages', messages: await withToken((token) => fetchThreadMessages(token, threadId)) };
  } catch (e) {
    const error = (e as Error).message || 'onbekende fout';
    console.warn(`[maildrop] API-ophalen mislukte voor ${email} ${threadId}:`, e);
    return { kind: 'failed', error };
  }
}

async function saveOneThread(
  ts: string,
  account: string,
  root: string,
  threadId: string,
  authuser: string,
  ik: string,
  message: MessageRef | null = null,
): Promise<{ count: number; total: number; error?: string; saved: SavedRef[] }> {
  const failed = (error: string, total = 0) => {
    try {
      appendLog(root, [{ ts, account, threadId, error }]);
    } catch {
    }
    return { count: 0, total, error, saved: [] };
  };

  // The API first, and the page only when there is no token for this account.
  //
  // Both routes end in the same list, but they do not find the same messages. The page
  // route reads Gmail's "show original" page and can only save what that page links to,
  // and a long conversation arrives there with its older messages collapsed and their
  // links gone — so a thread of twelve becomes a copy of three that reports itself as
  // three of three, since it counts what it found rather than what exists. threads.get
  // has no opinion about rendering: it lists every message in the thread, so what is
  // missing is missing loudly.
  const viaApi = await threadMessagesViaApi(account, threadId);
  // A mailbox reached by delegation has no second route, so its API failure is the answer.
  // Trying the page anyway is what turned "de API weigerde" into Gmail's own sentence about
  // a message that cannot be found.
  if (viaApi.kind === 'failed' && isDelegatedMailbox(account)) {
    return failed(`Ophalen via de API mislukt (${viaApi.error})`);
  }
  let fetched: { raw?: Buffer; error?: string; id?: string; permMsgId?: string }[];
  let pageHtml: { html: string; status: number } | null = null;
  if (viaApi.kind === 'messages') {
    fetched = viaApi.messages.map((m) => ({ raw: m.raw, error: m.error, id: m.id }));
  } else {
    let result;
    try {
      result = await fetchThreadEmls(session.fromPartition('persist:google'), { threadId, authuser, ik });
    } catch (e) {
      return failed(`Ophalen mislukt (${(e as Error).message})`);
    }
    fetched = result.messages;
    pageHtml = result.page;
  }
  if (fetched.length === 0 && pageHtml) {
    // An own account may still be saved by the page, so it is allowed to try. When that comes
    // back empty too, the API's reason is the one to report: it is what actually went wrong,
    // and the page's explanation is about a route this mail was never going to arrive by.
    if (viaApi.kind === 'failed') {
      return failed(`Ophalen via de API mislukt (${viaApi.error})`);
    }
    const result = { page: pageHtml };
    const uitleg = htmlToText(result.page.html).replace(/\s+/g, ' ').trim();
    const kortEnDuidelijk = uitleg.length > 0 && uitleg.length <= 300;
    if (!kortEnDuidelijk) {
      const dump = join(root, `diagnose-om-${threadId}.html`);
      try {
        mkdirSync(root, { recursive: true });
        writeFileSync(dump, result.page.html, 'utf8');
      } catch {
      }
      return failed(
        `Geen origineel gevonden (HTTP ${result.page.status}, ${result.page.html.length} tekens — pagina bewaard als ${dump})`,
      );
    }
    return failed(`Gmail: ${uitleg}`);
  }

  const all: SavedMessage[] = [];
  const failedRecords: LogRecord[] = [];
  for (const f of fetched) {
    if (f.raw) {
      all.push({
        raw: f.raw,
        headers: parseHeaders(f.raw.toString('utf8')),
        id: f.id,
        permMsgId: f.permMsgId,
      });
    } else {
      failedRecords.push({ ts, account, threadId, error: f.error ?? 'onbekende fout' });
    }
  }
  if (all.length === 0) return failed(fetched[0]?.error ?? 'Geen bericht opgehaald', fetched.length);

  // One mail out of the conversation, not the conversation in pieces. The last message
  // quotes the ones before it, which is the whole reason a thread gets dragged: something
  // to read the exchange in. Fetching all of them was still not wasted — it is how the
  // newest one is known to be the newest, and how it is complete rather than whatever a
  // collapsed page happened to link to.
  //
  // Which message that is does depend on the drag. A row that stands for one message names
  // it, and then it is that one: the replies that came after it are what the drag is meant
  // to leave behind, and the older ones are inside it as quoted text either way.
  const dragged = draggedMessage(all, message);
  const chosen = dragged ?? newestMessage(all);
  const ok = chosen ? [chosen] : [];
  if (message && !dragged) {
    notifyLog(`[maildrop] ${threadId}: gesleept bericht niet in de conversatie gevonden`);
  }
  if (all.length > 1) {
    notifyLog(
      `[maildrop] ${threadId}: ${all.length} berichten, alleen ${dragged ? 'het gesleepte' : 'het laatste'} bewaard`,
    );
  }

  let files: string[];
  try {
    files = writeThread(root, ts, ok);
  } catch {
    return failed(`Kan niet schrijven naar ${root}`, fetched.length);
  }

  const records: LogRecord[] = ok.map((m, i) => ({
    ts,
    account,
    threadId,
    messageId: m.headers.messageId,
    from: m.headers.from,
    to: m.headers.to,
    cc: m.headers.cc,
    subject: m.headers.subject,
    date: m.headers.date,
    file: files[i],
    bytes: m.raw.length,
    body: extractPlainText(m.raw.toString('utf8')),
  }));
  try {
    appendLog(root, [...records, ...failedRecords]);
  } catch {
  }
  return {
    count: ok.length,
    // One mail per drag now, so this counts what was dragged rather than messages.
    total: 1,
    saved: savedRefs(root, files, ok, threadId),
  };
}

function savedRefs(
  root: string,
  files: string[],
  messages: SavedMessage[],
  threadId: string,
): SavedRef[] {
  return messages.map((m, i) => ({
    file: join(root, files[i]),
    messageId: m.headers.messageId,
    subject: m.headers.subject || NO_SUBJECT,
    threadId,
  }));
}

const DUPLICATE_CHECK_LIMIT = 8;

// The token comes from mailboxToken, not from the OAuth store. A delegated mailbox has no
// token of its own, so accessTokenFor answered null for one and it was dropped from the
// checks below without a word — the scan then found nothing, every label counted as still
// needed, and a shared mailbox quietly got a second copy of a mail it already held. The rest
// of this file has gone through mailboxToken for exactly that reason; this was the one place
// left behind.
async function findDuplicates(
  targets: MailDropCopyTarget[],
  saved: SavedRef[],
  onProgress: (done: number, total: number, email: string) => void,
): Promise<DuplicateHit[]> {
  const tokens = new Map<string, string>();
  for (const t of targets) {
    const got = await mailboxToken(t.email);
    if (got.ok) tokens.set(t.email, got.token);
  }

  const checks: Array<{ email: string; labelId: string; ref: SavedRef }> = [];
  for (const t of targets) {
    if (!tokens.has(t.email)) continue;
    for (const labelId of t.labelIds) {
      for (const ref of saved) if (ref.messageId.trim()) checks.push({ email: t.email, labelId, ref });
    }
  }

  let done = 0;
  const hits = await mapLimit(checks, DUPLICATE_CHECK_LIMIT, async (c) => {
    let exists = false;
    try {
      exists = await messageExistsInLabel(tokens.get(c.email)!, c.ref.messageId, c.labelId);
    } catch {
    }
    onProgress((done += 1), checks.length, c.email);
    return exists
      ? {
          email: c.email,
          labelId: c.labelId,
          messageId: c.ref.messageId,
          subject: c.ref.subject,
        }
      : null;
  });
  return hits.filter((h) => h !== null);
}

function scanKey(targets: MailDropCopyTarget[]): string {
  return `${dropSerial}|${JSON.stringify(targets)}`;
}

function openDropPreview(items: MailDropPreviewItem[]): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const overlay =
    dropOverlay ??
    new OverlayView(
      mainWindow,
      SIDEBAR_PRELOAD_PATH,
      DEV_URL ? `${DEV_URL}/maildrop` : 'app://bundle/maildrop.html',
      IPC.MAIL_DROP_PREVIEW,
    );
  setDropOverlay(overlay);
  lastDropPreview = items;
  overlay.open({ items });
}


const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function collectLabelThreads(
  ref: AccountRef,
  authuser: string,
  label: string,
): Promise<{ threads: LabelThread[]; capped: boolean }> {
  const threads: LabelThread[] = [];
  let capped = false;
  if (!manager) return { threads, capped };

  await manager.withHiddenView(labelListUrl(authuser, label, 1), async (wc) => {
    let firstOfPrevious = '';
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (page > 1) {
        const hash = new URL(labelListUrl(authuser, label, page)).hash;
        await wc.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`).catch(() => null);
      }
      let pageThreads: LabelThread[] = [];
      for (let tries = 0; tries < 25; tries++) {
        await delay(400);
        pageThreads = (await wc.executeJavaScript(LABEL_SCRAPE_JS).catch(() => [])) as LabelThread[];
        if (pageThreads.length > 0 && pageThreads[0].threadId !== firstOfPrevious) break;
      }
      if (pageThreads.length === 0) break;
      firstOfPrevious = pageThreads[0].threadId;

      const { added, total } = mergeThreads(threads, pageThreads);
      if (total >= MAX_THREADS) {
        capped = pageThreads.length >= PAGE_SIZE;
        break;
      }
      if (added === 0) break;
    }
  });
  return { threads, capped };
}

interface CollectedThread {
  thread: LabelThread;
  messages: SavedMessage[];
  error?: string;
}

const THREAD_FETCH_LIMIT = 5;

/** Every conversation in a label through the Gmail API, or null when this mailbox has no API
 * route to it. The token goes through withMailboxToken for the reason threadMessagesViaApi
 * carries: a mailbox reached by delegation has no OAuth token of its own, and the page route
 * this falls back to cannot reach one at all. */
async function collectLabelViaApi(
  account: string,
  label: string,
): Promise<{ collected: CollectedThread[]; capped: boolean } | null> {
  if (!account) return null;
  const withToken = await withMailboxToken(account);
  if (!withToken) return null;

  let list: { threadIds: string[]; capped: boolean };
  try {
    const labelId = await withToken((token) => fetchLabelId(token, label));
    if (!labelId) return null;
    list = await withToken((token) => listLabelThreadIds(token, labelId, MAX_THREADS));
  } catch {
    return null;
  }

  const collected = await mapLimit(list.threadIds, THREAD_FETCH_LIMIT, async (threadId) => {
    try {
      const raws = await withToken((token) => fetchThreadRaw(token, threadId));
      const messages: SavedMessage[] = raws.map((raw) => ({
        raw,
        headers: parseHeaders(raw.toString('utf8')),
      }));
      return {
        thread: { threadId, subject: messages[0]?.headers.subject || NO_SUBJECT },
        messages,
        error: messages.length === 0 ? 'Geen bericht in dit gesprek' : undefined,
      };
    } catch (e) {
      return {
        thread: { threadId, subject: '' },
        messages: [],
        error: `Ophalen mislukt (${(e as Error).message})`,
      };
    }
  });
  return { collected, capped: list.capped };
}

async function saveLabel(
  ts: string,
  account: string,
  root: string,
  ref: AccountRef,
  label: string,
  authuser: string,
  ik: string,
): Promise<{ items: MailDropPreviewItem[]; saved: SavedRef[] }> {
  const empty = () => {
    const error = `Geen mail gevonden in label "${label}"`;
    try {
      appendLog(root, [{ ts, account, threadId: '', label, error }]);
    } catch {
    }
    return { items: [{ threadId: '', subject: label, saved: 0, error }], saved: [] };
  };

  const viaApi = await collectLabelViaApi(account, label);
  let collected: CollectedThread[];
  let capped: boolean;

  if (viaApi) {
    if (viaApi.collected.length === 0) return empty();
    collected = viaApi.collected;
    capped = viaApi.capped;
  } else {
    const scraped = await collectLabelThreads(ref, authuser, label);
    if (scraped.threads.length === 0) return empty();
    capped = scraped.capped;

    collected = [];
    for (const thread of scraped.threads) {
      try {
        const result = await fetchThreadEmls(session.fromPartition(SESSION_PARTITION), {
          threadId: thread.threadId,
          authuser,
          ik,
        });
        const messages: SavedMessage[] = [];
        for (const f of result.messages) {
          if (f.raw) messages.push({ raw: f.raw, headers: parseHeaders(f.raw.toString('utf8')) });
        }
        if (messages.length === 0) {
          const uitleg = htmlToText(result.page.html).replace(/\s+/g, ' ').trim();
          collected.push({
            thread,
            messages: [],
            error: uitleg && uitleg.length <= 300 ? `Gmail: ${uitleg}` : 'Geen origineel gevonden',
          });
        } else {
          collected.push({ thread, messages });
        }
      } catch (e) {
        collected.push({ thread, messages: [], error: `Ophalen mislukt (${(e as Error).message})` });
      }
    }
  }

  // Per conversation the last message, for the reason newestMessage carries: what is wanted
  // is one mail to read the exchange in. A label of forty threads becomes forty mails, not
  // four hundred.
  for (const c of collected) {
    const newest = newestMessage(c.messages);
    c.messages = newest ? [newest] : [];
  }
  const flat = collected.flatMap((c) => c.messages);
  let files: string[] = [];
  try {
    files = writeLabel(root, ts, label, flat);
  } catch {
    const error = `Kan niet schrijven naar ${root}`;
    return {
      items: collected.map((c) => ({
        threadId: c.thread.threadId,
        subject: c.thread.subject,
        saved: 0,
        error,
      })),
      saved: [],
    };
  }

  const records: LogRecord[] = [];
  let fileIndex = 0;
  for (const c of collected) {
    if (c.messages.length === 0) {
      records.push({ ts, account, threadId: c.thread.threadId, label, error: c.error });
      continue;
    }
    for (const m of c.messages) {
      records.push({
        ts,
        account,
        threadId: c.thread.threadId,
        label,
        messageId: m.headers.messageId,
        from: m.headers.from,
        to: m.headers.to,
        cc: m.headers.cc,
        subject: m.headers.subject,
        date: m.headers.date,
        file: files[fileIndex++],
        bytes: m.raw.length,
        body: extractPlainText(m.raw.toString('utf8')),
      });
    }
  }
  if (capped) {
    records.push({
      ts,
      account,
      threadId: '',
      label,
      error: `Afgekapt op ${MAX_THREADS} gesprekken; het label bevat er meer`,
    });
  }
  try {
    appendLog(root, records);
  } catch {
  }

  const items = collected.map((c) => ({
    threadId: c.thread.threadId,
    subject: c.thread.subject,
    saved: c.messages.length,
    error: c.error,
  }));
  if (capped) {
    items.push({
      threadId: '',
      subject: `Afgekapt op ${MAX_THREADS} gesprekken`,
      saved: 0,
      error: 'Het label bevat meer mail dan in één sleep wordt opgehaald',
    });
  }
  // Per thread rather than over the flat list: files runs across every conversation in the
  // label, and a copy has to know which messages belong together or it files each one as its
  // own thread in the target mailbox.
  const saved: SavedRef[] = [];
  let at = 0;
  for (const c of collected) {
    saved.push(...savedRefs(root, files.slice(at, at + c.messages.length), c.messages, c.thread.threadId));
    at += c.messages.length;
  }
  return { items, saved };
}

export async function handleMailDrop(acctKey: string, payload: MailDropPayload): Promise<void> {
  const ts = new Date().toISOString();
  const account = profiles.find((p) => keyOf(p) === acctKey)?.email ?? '';
  const root = mailDropFolder();
  const items = payload?.items ?? [];
  if (items.length === 0 && !payload?.label) return;
  lastDropSaved = [];
  dropSerial += 1;
  lastDropSource = account;
  if (!payload.ik) {
    const error = 'Kon Gmail-token niet lezen';
    try {
      appendLog(root, items.map(({ threadId }) => ({ ts, account, threadId, error })));
    } catch {
    }
    manager?.sendDropResult(acctKey, { ok: false, count: 0, total: 0, error });
    openDropPreview(
      items.length > 0
        ? items.map((i) => ({ ...i, saved: 0, error }))
        : [{ threadId: '', subject: payload.label ?? '', saved: 0, error }],
    );
    return;
  }

  if (payload.label) {
    const profile = profiles.find((p) => keyOf(p) === acctKey);
    if (!profile) return;
    const { items: done, saved: refs } = await saveLabel(
      ts,
      account,
      root,
      profile.ref,
      payload.label,
      payload.authuser,
      payload.ik,
    );
    lastDropSaved = refs;
    const saved = done.reduce((n, i) => n + i.saved, 0);
    manager?.sendDropResult(
      acctKey,
      saved === 0
        ? { ok: false, count: 0, total: done.length, error: done[0]?.error ?? 'Niets opgeslagen' }
        : { ok: true, count: saved, total: saved },
    );
    openDropPreview(done);
    return;
  }

  const done: MailDropPreviewItem[] = [];
  let count = 0;
  let total = 0;
  let lastError: string | undefined;
  for (const item of items) {
    const r = await saveOneThread(
      ts,
      account,
      root,
      item.threadId,
      payload.authuser,
      payload.ik,
      item.message ?? null,
    );
    count += r.count;
    total += r.total;
    if (r.error) lastError = r.error;
    lastDropSaved.push(...r.saved);
    done.push({ ...item, saved: r.count, error: r.error });
  }
  manager?.sendDropResult(
    acctKey,
    count === 0
      ? { ok: false, count: 0, total, error: lastError ?? 'Niets opgeslagen' }
      : { ok: true, count, total },
  );
  openDropPreview(done);
}

/** What the preview window should draw. It asks once it is listening rather than being
 * pushed to, because the overlay loads after the drop that filled this. */
export function dropPreviewItems(): { items: MailDropPreviewItem[] } {
  return { items: lastDropPreview };
}

export function closeDropPreview(): void {
  dropOverlay?.close();
}

/** The label lists the copy window offers, one column per mailbox that may be copied into.
 *
 * Delegated mailboxes belong in this list. They were filtered out because they have no OAuth
 * token of their own and there was no other way to read their labels, which meant a shared
 * mailbox could never be picked as a copy target -- it was simply not offered, so it read as
 * "I cannot find it" rather than as a missing feature. The relay supplies the token now. */
export async function labelsForCopyTargets(): Promise<{ accounts: AccountLabels[] }> {
  const cfg = oauthConfig();
  // Delegated mailboxes belong in this list. They were filtered out because they have no
  // OAuth token of their own and there was no other way to read their labels, which meant
  // a shared mailbox could never be picked as a copy target — it was simply not offered,
  // so it read as "I cannot find it" rather than as a missing feature. The relay supplies
  // the token now. Which mailboxes qualify is account-domain's to say.
  const targetable = copyTargetEmails(profiles, lastDropSource);
  if (!cfg || !oauthTokens) {
    return {
      accounts: targetable.map((email) => ({ email, labels: [], error: 'Niet gekoppeld' })),
    };
  }
  // One mailbox may not hold up the others. This ran in sequence, so a mailbox whose token
  // or label list was slow to arrive stopped the window at "Labels ophalen…" for every
  // account behind it — and before the deadlines in gmail-api.ts and delegated-token.ts,
  // one that never arrived stopped it for good. mapLimit keeps the answers in input order,
  // so the columns stay where the user expects them.
  const tokens = oauthTokens;
  const accounts: AccountLabels[] = await mapLimit(targetable, 4, async (email) => {
    const got = await mailboxToken(email);
    if (!got.ok) return { email, labels: [], error: got.error };
    const token = got.token;
    try {
      return { email, labels: await fetchLabels(token) };
    } catch (e) {
      // 403 counts as a refusal too. Gmail answers a token it will not let in with either
      // status — a request it reads as carrying no credential comes back as "Request is
      // missing required authentication credential", and that sentence, with its link to
      // Google's console documentation, was being printed under the mailbox name for
      // someone to read. Only 401 was recovered from, so a 403 skipped the fresh token and
      // went straight to showing Google's own English.
      const refused = e instanceof GmailHttpError && (e.status === 401 || e.status === 403);
      if (e instanceof GmailHttpError) {
        console.warn(
          `[labels] ${email} (${isDelegatedMailbox(email) ? 'gedelegeerd' : 'eigen'}) HTTP ${e.status}: ${e.message}`,
        );
      }
      // Recovering from a 401 differs per kind, and using the wrong one is silent: a
      // delegated mailbox has no refresh token to force, and an own account has no relay
      // entry to forget. A delegation can be revoked while a token from it is still inside
      // its hour, so the cached one has to go before asking again.
      let fresh: string | null = null;
      if (refused && isDelegatedMailbox(email)) {
        forgetDelegatedToken(email);
        const again = await delegatedTokenFor(email);
        fresh = again.ok ? again.token : null;
      } else if (refused) {
        fresh = await forceRefresh(cfg, tokens, email);
      }
      if (fresh) {
        try {
          const labels = await fetchLabels(fresh);
          if (!isDelegatedMailbox(email)) clearRefreshFailure(email);
          return { email, labels };
        } catch (e2) {
          // A brand-new token refused as well says the same thing as the first refusal, so
          // it gets the same sentence. This branch is how Google's English reached the
          // screen even after the rewriting below was added: it sat in front of it.
          if (e2 instanceof GmailHttpError && (e2.status === 401 || e2.status === 403)) {
            console.warn(`[labels] ${email} ook na een verse token HTTP ${e2.status}: ${e2.message}`);
            return { email, labels: [], error: mailboxRefusedText(email) };
          }
          return { email, labels: [], error: (e2 as Error).message };
        }
      }
      if (refused) {
        // Only an own account can have a link that expired; a delegated mailbox has none,
        // so it must not be flagged as needing a reconnect.
        if (!isDelegatedMailbox(email)) markRefreshFailed(email);
        return { email, labels: [], error: mailboxRefusedText(email) };
      }
      return { email, labels: [], error: (e as Error).message };
    }
  });
  return { accounts };
}

// How many saved messages are still worth looking up before the picker is drawn. A drag off
// a row is one mail, a ticked selection a handful; a label drag is hundreds, and there the
// scan would cost more requests than the copy it is warning about. Past this the picker says
// nothing and the check at Kopieer does the work, as it always did.
const EXISTING_SCAN_LIMIT = 10;

const EXISTING_SCAN_CONCURRENCY = 4;

/** Where the last drag's mail already sits, asked the moment the picker opens.
 *
 * This is the warning before the choice rather than after it. The check at Kopieer only ever
 * looked at the labels someone had already ticked, so "this mail is in that mailbox already,
 * under a different label" was something you found out by filing a second copy of it.
 *
 * One search per mailbox per message rather than one per label: the message is looked up by
 * its Message-ID and Gmail says what it is filed under, which is the same two requests
 * whether the mailbox has four labels or four hundred. */
export async function existingForCopyTargets(): Promise<ExistingResult> {
  const files = lastDropSaved.filter((f) => f.messageId.trim());
  const targetable = copyTargetEmails(profiles, lastDropSource);
  if (files.length === 0 || files.length > EXISTING_SCAN_LIMIT || targetable.length === 0) {
    return { accounts: [], scanned: 0 };
  }

  const scans = await mapLimit(targetable, EXISTING_SCAN_CONCURRENCY, async (email) => {
    const got = await mailboxToken(email);
    // A mailbox with no token at all is passed over without a word, and that is not the
    // silence this feature is against: its column carries the refusal and offers no labels,
    // so nothing can be copied there and there is nothing to warn about. A scan that failed
    // with a working token is the opposite -- the labels are pickable and nothing else on
    // screen says the check never ran.
    if (!got.ok) return { email, labelIds: [] as string[] };
    try {
      const perMessage = await mapLimit(files, 2, (ref) =>
        labelsHoldingMessage(got.token, ref.messageId),
      );
      return { email, labelIds: perMessage.flatMap(copyableLabelIds) };
    } catch (e) {
      // Reported rather than swallowed: a scan that failed is not a mailbox that is clean,
      // and letting it read as clean is the whole failure this feature exists to prevent.
      console.warn(`[maildrop] kon ${email} niet controleren op dubbelen:`, e);
      return { email, labelIds: [], error: 'Kon niet controleren' };
    }
  });

  const hits: Array<{ email: string; labelId: string }> = [];
  const failed: ExistingInMailbox[] = [];
  for (const scan of scans) {
    if (scan.error) failed.push({ email: scan.email, labels: [], error: scan.error });
    else for (const labelId of scan.labelIds) hits.push({ email: scan.email, labelId });
  }
  return { accounts: [...countExisting(hits), ...failed], scanned: files.length };
}

/** Copies whatever the last drag saved into the chosen labels, in the chosen mailboxes.
 *
 * Runs in three modes. 'check' scans for messages already there and reports them rather than
 * copying; 'all' skips the scan; the default copies what the scan said was new. */
export async function copyToMailboxes(arg: {
  targets: MailDropCopyTarget[];
  mode?: CopyMode;
}): Promise<MailDropCopyResult> {
  const cfg = oauthConfig();
  const requested = normalizeTargets(arg?.targets ?? []);
  // The window cannot offer a mailbox outside the work domain, so this is the guard for a
  // request that did not come from the window. Checked here rather than trusted from there,
  // because this is where mail actually leaves for another mailbox.
  const targets = requested.filter((t) => isAllowedAccount(t.email));
  const mode: CopyMode = arg?.mode ?? 'check';
  const fail = (error: string): MailDropCopyResult => ({
    ok: false,
    copied: 0,
    skipped: 0,
    total: 0,
    accounts: [],
    error,
  });
  if (!cfg || !oauthTokens) return fail('Koppeling niet ingesteld');
  if (requested.length === 0) return fail('Geen label gekozen');
  if (targets.length === 0) return fail('Alleen postvakken van het werkdomein kunnen worden gekozen');
  const files = lastDropSaved;
  if (files.length === 0) return fail('Geen opgeslagen berichten om te kopiëren');

  const total = copyTotal(targets, files.length);
  const ts = new Date().toISOString();
  const root = mailDropFolder();
  const records: LogRecord[] = [];
  const accounts: MailDropCopyAccountResult[] = [];
  let done = 0;
  let copied = 0;
  let skipped = 0;
  const progress = (phase: 'check' | 'copy', email: string, of = total) =>
    dropOverlay?.send(IPC.MAIL_DROP_COPY_PROGRESS, { phase, done, total: of, email });

  let index = new Set<string>();
  if (mode !== 'all') {
    const key = scanKey(targets);
    const hits =
      lastScan?.key === key
        ? lastScan.hits
        : await findDuplicates(targets, files, (n, of, email) => {
            done = n;
            progress('check', email, of);
          });
    lastScan = { key, hits };
    done = 0;
    index = duplicateIndex(hits);
    if (mode === 'check' && hits.length > 0) {
      return {
        ok: false,
        copied: 0,
        skipped: 0,
        total,
        accounts: [],
        needsConfirm: true,
        duplicates: groupDuplicates(hits),
        newCount: newMessageCount(index, targets, files.map((f) => f.messageId)),
      };
    }
  }

  for (const target of targets) {
    progress('copy', target.email);
    // One entry point for both kinds. A delegated mailbox has no token of its own and
    // never will — nobody signs in as a shared mailbox — so its token comes from the
    // relay, which checks Google's delegation record before handing one over.
    const got = await mailboxToken(target.email);
    if (!got.ok) {
      // Only an own account can have a link that expired; a delegated mailbox has none, so
      // it must not be flagged as needing a reconnect.
      if (!isDelegatedMailbox(target.email)) markRefreshFailed(target.email);
      done += files.length;
      progress('copy', target.email);
      accounts.push({
        email: target.email,
        copied: 0,
        skipped: 0,
        total: files.length,
        error: got.error,
      });
      continue;
    }
    let token = got.token;

    let ok = 0;
    let over = 0;
    let lastError: string | undefined;
    /** Source thread id -> the thread it became in this account. */
    const threadOfCopy = new Map<string, string>();
    for (const { file, messageId, threadId: sourceThreadId } of files) {
      const labelIds = labelsStillNeeded(index, target.email, target.labelIds, messageId);
      if (labelIds.length === 0) {
        over += 1;
        done += 1;
        progress('copy', target.email);
        continue;
      }
      let raw: Buffer;
      try {
        raw = readFileSync(file);
      } catch {
        lastError = `Kan ${file} niet lezen`;
        records.push({ ts, account: target.email, threadId: '', file, error: lastError });
        done += 1;
        progress('copy', target.email);
        continue;
      }
      // The thread this message's conversation landed in, in this account. The first
      // message of a conversation makes it and the rest are filed under it; without that
      // Gmail files every insert as a thread of its own and a copied conversation arrives
      // in pieces. Per target account, because a thread id is only meaningful inside the
      // mailbox that issued it.
      const groupKey = sourceThreadId || file;
      const landedIn = threadOfCopy.get(groupKey);
      try {
        let inserted: { id: string | null; threadId: string | null };
        const insert = (t: string, thread?: string) => insertMessage(t, raw, labelIds, thread);
        try {
          inserted = await insert(token, landedIn);
        } catch (e) {
          if (e instanceof GmailHttpError && e.status === 400 && landedIn) {
            // Google refused the thread rather than the message: its conditions on
            // References and Subject were not met, which is a property of this one mail
            // and not a reason to lose it. It goes in on its own instead.
            console.warn(`[maildrop] ${file} paste niet in thread ${landedIn}, los ingevoegd`);
            inserted = await insert(token);
          } else {
            if (!(e instanceof GmailHttpError) || e.status !== 401) throw e;
            const fresh = await forceRefresh(cfg, oauthTokens, target.email);
            if (!fresh) {
              markRefreshFailed(target.email);
              throw new Error('Verbinding verlopen');
            }
            token = fresh;
            clearRefreshFailure(target.email);
            inserted = await insert(token, landedIn);
          }
        }
        if (!landedIn && inserted.threadId) threadOfCopy.set(groupKey, inserted.threadId);
        ok += 1;
        records.push({
          ts,
          account: target.email,
          threadId: inserted.threadId ?? inserted.id ?? '',
          file,
          bytes: raw.length,
          copy: { to: target.email, labels: labelIds, ok: true },
        });
      } catch (e) {
        lastError = (e as Error).message;
        records.push({
          ts,
          account: target.email,
          threadId: '',
          file,
          error: lastError,
          copy: { to: target.email, labels: labelIds, ok: false, error: lastError },
        });
      }
      done += 1;
      progress('copy', target.email);
    }
    copied += ok;
    skipped += over;
    accounts.push({
      email: target.email,
      copied: ok,
      skipped: over,
      total: files.length,
      error: ok + over < files.length ? (lastError ?? 'Niet alles gekopieerd') : undefined,
    });
  }

  try {
    appendLog(root, records);
  } catch {
  }
  return {
    ok: copied > 0 || skipped > 0,
    copied,
    skipped,
    total,
    accounts,
  } satisfies MailDropCopyResult;
}
