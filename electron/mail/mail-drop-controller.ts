// Dragging mail out of Gmail and onto the desktop, and copying what that saved into another
// mailbox.
//
// Two routes reach the same list and do not find the same messages. The API lists every
// message in a thread; the page route can only save what Gmail's "show original" page links
// to, and a long conversation arrives there collapsed. The API goes first for that reason,
// and the page is what is left when a mailbox has no token.
//
// A mailbox reached by delegation has no second route at all -- its page needs the
// /d/<token>/ a drag does not carry -- so there an API failure is the answer.
//
// One mail leaves per drag: the last message quotes the ones before it, which is the whole
// reason a thread gets dragged. Fetching them all is how the newest is known to be newest.

import { app, session } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { IPC } from '../core/ipc';
import type {
  MailDropCopyAccountResult,
  MailDropCopyResult,
  MailDropCopyTarget,
  MailDropFolderStatus,
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
  messageIndex,
  setDropOverlay,
} from '../core/runtime';
import { createUploadBudget, mapLimit, memoise, type UploadBudget } from '../core/concurrency';
import { OverlayView } from '../windows/overlay-view';
import type { Profile } from '../windows/profile-view-manager';
import { forceRefresh } from '../auth/oauth-flow';
import type { OAuthConfig } from '../auth/google-oauth';
import type { OAuthStore } from '../auth/oauth-store';
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
import { htmlToText, parseHeaders } from './eml';
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
  assembleCopy,
  checkLogLine,
  copyLogLine,
  copyTotal,
  perMailboxLimit,
  runThreadGroup,
  duplicateChecks,
  duplicateIndex,
  existingSoFar,
  groupDuplicates,
  labelsStillNeeded,
  newMessageCount,
  normalizeTargets,
  scanAnswer,
  threadGroups,
  type CopyMode,
  type DuplicateHit,
  type ExistingResult,
  type MailboxScan,
  type ScanOutcome,
} from './mail-copy';
import {
  LABEL_SCRAPE_JS,
  MAX_PAGES,
  MAX_THREADS,
  PAGE_SIZE,
  labelListUrl,
  mergeThreads,
  scrapeSettled,
  type LabelThread,
} from './label-drop';
import { fetchThreadEmls } from './mail-fetch';
import { emptyIndex, indexedScan, remember } from './message-index';
import { BUSY_TEXT, NO_SUBJECT, SLOW_TEXT, dropOutcome, type MessageRef } from './dropzone';
import { DROP_LOCK_MS, createDropLock } from './drop-lock';
import { defaultMailFolder, looksRemoteFolder } from './mail-folder';
import {
  GmailHttpError,
  fetchLabelId,
  fetchLabels,
  fetchThreadMessages,
  fetchThreadRaw,
  insertMessage,
  labelsHoldingMany,
  mailboxCanary,
  listLabelThreadIds,
  type AccountLabels,
  type ThreadMessage,
} from '../gmail/gmail-api';

//===========================
// Types
//===========================

/** Told how far a pull has got, in conversations. A total of nothing means the label is
 * still being listed. */
type SaveProgress = (done: number, total: number) => void;

interface SavedRef {
  file: string;
  messageId: string;
  subject: string;
  threadId: string;
}


//===========================
// Module state
//===========================

let lastDropPreview: MailDropPreviewItem[] = [];

let lastDropSaved: SavedRef[] = [];

let lastDropSource = '';

let lastScan: { key: string; hits: DuplicateHit[] } | null = null;

/** What the picker's own scan found, kept for the check at Kopieer, which asks a narrower
 * question about the same mail. Stamped with the drag it belongs to, so the next drag
 * ignores it rather than answering for the wrong mail. */
let lastExisting: { serial: number; byEmail: Map<string, MailboxScan> } | null = null;

let dropSerial = 0;

/** One pull at a time, and this is what says which one. */
const dropLock = createDropLock();


//===========================
// Exported functions
//===========================

/**
 * Where dragged mail is kept
 *
 * @returns the folder that was chosen, or the default for this platform, which is a directory
 *   no redirection or sync reaches -- see mail-folder.ts for why Documents is not it
 */
export function mailDropFolder(): string {
  return (
    prefs?.getAll().mailDrop.folder ||
    defaultMailFolder({
      platform: process.platform,
      env: process.env,
      appData: app.getPath('appData'),
      home: app.getPath('home'),
    })
  );
}

/**
 * The folder, and whether it hands the mail to something other than this machine
 *
 * Answered here rather than in the settings page: what counts as a folder that leaves the PC
 * is knowledge about paths, and the page only draws what it is told.
 *
 * @returns the path and the warning flag
 */
export function mailDropStatus(): MailDropFolderStatus {
  const folder = mailDropFolder();
  return { folder, remote: looksRemoteFolder(folder) };
}

type ApiThreadResult =
  | { kind: 'messages'; messages: ThreadMessage[] }
  | { kind: 'failed'; error: string }
  | { kind: 'no-route' };

/** One conversation, fetched and parsed. `parsed` is null when the API route had nothing to
 * give and the row has to fall back to the page. */
interface ThreadRead {
  api: ApiThreadResult;
  parsed: { all: SavedMessage[]; errors: Array<string | undefined> } | null;
}

/** Per drag, per conversation. A drag of twenty-two rows out of one conversation asked Gmail for
 * that whole conversation twenty-two times and parsed all of it twenty-two times, to keep one
 * different message each time -- 22 x 22 message fetches to save 22 mails. This is what they
 * share instead.
 *
 * Per drag and not longer: between two drags a conversation can have grown, and a stale answer
 * would save the wrong thing. Within one drag it cannot.
 *
 * What it does change, deliberately: a failed API attempt is now made once for the conversation
 * rather than once per row. Each row still falls back to the page route on its own. */
type ThreadReadCache = Map<string, Promise<ThreadRead>>;

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

/**
 * Reads one conversation over the API and parses it, once per drag
 *
 * @param cache the drag's cache
 * @param email the mailbox
 * @param threadId
 * @returns the fetch result, and the parsed messages when the API had them
 */
function readThread(cache: ThreadReadCache, email: string, threadId: string): Promise<ThreadRead> {
  return memoise(cache, threadId, async () => {
    const api = await threadMessagesViaApi(email, threadId);
    if (api.kind !== 'messages') return { api, parsed: null };
    const all: SavedMessage[] = [];
    const errors: Array<string | undefined> = [];
    for (const m of api.messages) {
      if (m.raw) {
        all.push({ raw: m.raw, headers: parseHeaders(m.raw.toString('utf8')), id: m.id });
      } else {
        errors.push(m.error);
      }
    }
    return { api, parsed: { all, errors } };
  });
}

async function saveOneThread(
  ts: string,
  account: string,
  root: string,
  threadId: string,
  authuser: string,
  ik: string,
  message: MessageRef | null = null,
  messageUnknown = false,
  cache: ThreadReadCache = new Map(),
): Promise<{ count: number; error?: string; saved: SavedRef[] }> {
  const failed = (error: string) => {
    try {
      appendLog(root, [{ ts, account, threadId, error }]);
    } catch {
    }
    return { count: 0, error, saved: [] };
  };

  // Before the fetch, since there is nothing to choose from once it lands: the newest
  // message stands in for a whole conversation, never for a row that named one and was not
  // read. Saying so beats saving the wrong mail, and "2 van 3 opgeslagen" is what the strip
  // then shows.
  if (messageUnknown) {
    notifyLog(`[maildrop] ${threadId}: rij geweigerd, het bericht was niet te lezen`);
    return failed('Kon niet zien welk bericht deze rij is');
  }

  const read = await readThread(cache, account, threadId);
  const viaApi = read.api;

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
      result = await fetchThreadEmls(
        session.fromPartition('persist:google'),
        { threadId, authuser, ik },
        message?.permId,
      );
    } catch (e) {
      return failed(`Ophalen mislukt (${(e as Error).message})`);
    }
    fetched = result.messages;
    pageHtml = result.page;
  }
  if (fetched.length === 0 && pageHtml) {

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

  // Parsed once per conversation when it came over the API: every row used to turn all of the
  // conversation's mails into text and headers to pick one out. The log lines are still built
  // per row, so a conversation with an unreadable message writes that line as often as it did.
  let all: SavedMessage[];
  const failedRecords: LogRecord[] = [];
  if (read.parsed) {
    all = read.parsed.all;
    for (const error of read.parsed.errors) {
      failedRecords.push({ ts, account, threadId, error: error ?? 'onbekende fout' });
    }
  } else {
    all = [];
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
  }
  if (all.length === 0) return failed(fetched[0]?.error ?? 'Geen bericht opgehaald');

  const dragged = draggedMessage(all, message);
  // The newest message stands in for a conversation, never for a named message that was not
  // found: measured in production twice on one thread, where the page route reached eight
  // messages but not the one grabbed, and the mail that left was the newest instead. Saying
  // so beats handing over a mail nobody pointed at.
  if (message && !dragged) {
    notifyLog(
      `[maildrop] ${threadId}: gesleept bericht niet in de conversatie gevonden (${all.length} opgehaald)`,
    );
    return failed('Het gesleepte bericht zat niet in de opgehaalde conversatie');
  }
  const chosen = dragged ?? newestMessage(all);
  const ok = chosen ? [chosen] : [];
  if (all.length > 1) {
    // Which message, not just which rule: two rows of one conversation that both end up on
    // the newest message save the same mail twice, and the old line could not say that.
    const which = chosen?.permMsgId ?? chosen?.id ?? chosen?.headers.messageId ?? 'onbekend';
    notifyLog(
      `[maildrop] ${threadId}: ${all.length} berichten, alleen ${dragged ? 'het gesleepte' : 'het laatste'} bewaard (${which})`,
    );
  }

  let files: string[];
  try {
    files = await writeThread(root, ts, ok);
  } catch {
    return failed(`Kan niet schrijven naar ${root}`);
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
  }));
  try {
    appendLog(root, [...records, ...failedRecords]);
  } catch {
  }
  return {
    count: ok.length,
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

async function findDuplicates(
  targets: MailDropCopyTarget[],
  saved: SavedRef[],
  onProgress: (done: number, total: number) => void,
  /** Filled in for the log: how much of the check the picker's scan had already answered */
  tally?: { checks: number; reused: number; asked: number },
): Promise<DuplicateHit[]> {
  const checks = duplicateChecks(targets, saved);

  // The scan behind the picker asked the wider question — which labels hold this message —
  // so most of these are already answered. What it did not cover, because the mailbox
  // refused or the drag was too big to scan, is still asked here.
  const scan = lastExisting?.serial === dropSerial ? lastExisting.byEmail : null;
  const answers = checks.map((check) => scanAnswer(scan, check));
  const open = checks.filter((_, i) => answers[i] === null);

  let done = checks.length - open.length;
  if (tally) {
    tally.checks = checks.length;
    tally.reused = checks.length - open.length;
    tally.asked = open.length;
  }
  if (open.length > 0) {
    const tokens = new Map<string, string>();
    for (const email of new Set(open.map((c) => c.email))) {
      const got = await mailboxToken(email);
      if (got.ok) tokens.set(email, got.token);
    }

    // One question per mailbox rather than one per label per message: labelsHoldingMany asks
    // which labels hold each mail, which is the wider question, so the per-label answers fall
    // out of it. Same shape the picker's own scan produces, so scanAnswer reads both.
    const fresh = new Map<string, MailboxScan>();
    await mapLimit([...new Set(open.map((c) => c.email))], EXISTING_SCAN_CONCURRENCY, async (email) => {
      const token = tokens.get(email);
      if (!token) return;
      const ids = [...new Set(open.filter((c) => c.email === email).map((c) => c.messageId))];
      try {
        const canary = await mailboxCanary(token).catch(() => '');
        const found = await labelsHoldingMany(token, ids, canary);
        fresh.set(email, new Map(found.map((m) => [m.messageId, m.labelIds])));
      } catch (e) {
        console.warn(`[maildrop] kon ${email} niet nakijken bij Kopieer:`, e);
      }
      done += open.filter((c) => c.email === email).length;
      onProgress(done, checks.length);
    });

    // A mailbox that could not be asked answers false, which is what the per-check version did
    // when its request threw: better to copy a mail twice than to skip one that is not there.
    for (const [i, answer] of answers.entries()) {
      if (answer === null) answers[i] = scanAnswer(fresh, checks[i]) ?? false;
    }
  }

  return checks.filter((_, i) => answers[i] === true);
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
      let settled = false;
      for (let tries = 0; tries < 25 && !settled; tries++) {
        await delay(400);
        const now = (await wc.executeJavaScript(LABEL_SCRAPE_JS).catch(() => [])) as LabelThread[];
        settled = scrapeSettled(pageThreads, now, firstOfPrevious);
        pageThreads = now;
      }
      if (pageThreads.length === 0) break;
      // The last read rather than nothing when the list never stood still: a busy mailbox
      // still has rows worth saving, and the log says the count is a floor.
      if (!settled) {
        notifyLog(
          `[maildrop] label "${label}" pagina ${page}: lijst stond niet stil, ${pageThreads.length} rijen genomen`,
        );
      }
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

// Four rather than five, because the messages inside a conversation are now fetched
// alongside each other too and it is the product of the two that meets Gmail's quota
const THREAD_FETCH_LIMIT = 4;

async function collectLabelViaApi(
  account: string,
  label: string,
  report: SaveProgress,
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

  let pulled = 0;
  report(0, list.threadIds.length);
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
    } finally {
      // In a finally, so a conversation that could not be fetched still moves the count on.
      // A counter that stops on a failed conversation reads as a pull that hung.
      pulled += 1;
      report(pulled, list.threadIds.length);
    }
  });
  return { collected, capped: list.capped };
}

async function saveLabel(
  ts: string,
  account: string,
  root: string,
  label: string,
  authuser: string,
  ik: string,
  report: SaveProgress,
): Promise<{ items: MailDropPreviewItem[]; saved: SavedRef[]; rows: number[] }> {
  const empty = () => {
    const error = `Geen mail gevonden in label "${label}"`;
    try {
      appendLog(root, [{ ts, account, threadId: '', label, error }]);
    } catch {
    }
    return { items: [{ threadId: '', subject: label, saved: 0, error }], saved: [], rows: [] };
  };

  const viaApi = await collectLabelViaApi(account, label, report);
  let collected: CollectedThread[];
  let capped: boolean;

  if (viaApi) {
    notifyLog(`[maildrop] label "${label}" via de API: ${viaApi.collected.length} gesprekken`);
    if (viaApi.collected.length === 0) return empty();
    collected = viaApi.collected;
    capped = viaApi.capped;
  } else {
    const scraped = await collectLabelThreads(authuser, label);
    notifyLog(`[maildrop] label "${label}" van de pagina gelezen: ${scraped.threads.length} gesprekken`);
    if (scraped.threads.length === 0) return empty();
    capped = scraped.capped;
    report(0, scraped.threads.length);

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
      // One entry per conversation whatever happened to it, so the count is what has been
      // collected rather than a counter of its own.
      report(collected.length, scraped.threads.length);
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
    files = await writeLabel(root, ts, label, flat);
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
      rows: collected.map(() => 0),
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
  return { items, saved, rows: collected.map((c) => c.messages.length) };
}

// How many dragged conversations are fetched at once. Times MESSAGE_FETCH_LIMIT for the
// messages inside each of them, so the whole drag stays around twelve requests in flight.
// Nests inside MESSAGE_FETCH_LIMIT, so a drag has up to this many conversations times that
// many messages in flight. The budget in quota.ts is what keeps the rate inside Gmail.
const DRAG_THREAD_LIMIT = 6;

/**
 * Pulls what was dragged into local files, with every Gmail view locked while it runs
 *
 * The lock is the point of this wrapper. One pull is one module-level job -- it empties
 * lastDropSaved and bumps the drag serial before it has written a file -- so a second drop
 * landing mid-pull threw the first drag's results away. Refusing the second drop is what
 * keeps that from happening; the veil over the views is so nobody tries.
 *
 * @param acctKey the view the drag came from
 * @param payload what the page read off the drag
 */
export async function handleMailDrop(acctKey: string, payload: MailDropPayload): Promise<void> {
  const profile = profiles.find((p) => keyOf(p) === acctKey);
  const items = payload?.items ?? [];
  if (items.length === 0 && !payload?.label) return;
  // Both of these come before the lock: a drag that changes nothing must not put a veil over
  // every Gmail view. The label case is the older bug of the two -- it used to bump the serial
  // and the source and then return without opening a preview, which left the previous drag's
  // picker on screen with the previous drag's mailboxes.
  if (payload.label && !profile) return;

  const token = dropLock.take(Date.now());
  if (token === null) {
    // The views are locked already; this answers the drag that got in just before the lock
    // reached its page.
    manager?.sendDropResult(acctKey, { ok: false, count: 0, total: 0, error: BUSY_TEXT });
    notifyLog('[maildrop] tweede sleep geweigerd, er wordt al mail opgehaald');
    return;
  }
  manager?.sendDropLock({ locked: true });
  // The lock lifts itself as well. The pull is the one thing here that waits on Gmail without
  // a timeout of its own, and a request that never answers would otherwise leave every Gmail
  // view under the veil until the app is restarted.
  const lifts = setTimeout(
    () => manager?.sendDropLock({ locked: false, note: SLOW_TEXT }),
    DROP_LOCK_MS,
  );
  try {
    await pullMailDrop(acctKey, payload, profile);
  } finally {
    clearTimeout(lifts);
    // Only if this pull still holds it: one that answers after its hold went stale must not
    // unlock the pull that replaced it.
    if (dropLock.release(token)) manager?.sendDropLock({ locked: false });
  }
}

/**
 * Saves the dragged mail and opens the picker on what it saved
 *
 * @param acctKey the view the drag came from
 * @param payload
 * @param profile the account behind that view
 * @private
 */
async function pullMailDrop(
  acctKey: string,
  payload: MailDropPayload,
  profile: Profile | undefined,
): Promise<void> {
  const ts = new Date().toISOString();
  const account = profile?.email ?? '';
  const root = mailDropFolder();
  const items = payload.items ?? [];
  // Counted in conversations, and sent to every Gmail view: they are all locked by this pull,
  // so they all say how far it has got.
  const report: SaveProgress = (done, total) => manager?.sendDropProgress({ done, total });
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
    report(0, 0);
    const { items: done, saved: refs, rows } = await saveLabel(
      ts,
      account,
      root,
      payload.label,
      payload.authuser,
      payload.ik,
      report,
    );
    lastDropSaved = refs;
    // rows rather than the display items: those carry the truncation notice too, which is
    // not a conversation that failed to save.
    manager?.sendDropResult(acctKey, dropOutcome(rows, done.find((i) => i.error)?.error));
    openDropPreview(done);
    startExistingScan();
    return;
  }

  // Side by side rather than one after the other: ten dragged mails were ten conversations
  // waiting on each other, which is minutes on a normal mailbox. mapLimit answers in the
  // order the rows were dragged, so the preview strip, the numbering and log.jsonl read the
  // same as when this was a loop.
  // One cache for this drag: rows of the same conversation share the fetch and the parse.
  const cache: ThreadReadCache = new Map();
  let pulled = 0;
  report(0, items.length);
  const results = await mapLimit(items, DRAG_THREAD_LIMIT, async (item) => {
    const one = await saveOneThread(
      ts,
      account,
      root,
      item.threadId,
      payload.authuser,
      payload.ik,
      item.message ?? null,
      item.messageUnknown ?? false,
      cache,
    );
    // After the row is saved rather than as it starts, and counted here rather than off the
    // results array: they come back in drag order but they do not finish in it.
    pulled += 1;
    report(pulled, items.length);
    return one;
  });

  const done: MailDropPreviewItem[] = [];
  const saved: number[] = [];
  let lastError: string | undefined;
  for (const [i, item] of items.entries()) {
    const r = results[i];
    saved.push(r.count);
    if (r.error) lastError = r.error;
    lastDropSaved.push(...r.saved);
    done.push({ ...item, saved: r.count, error: r.error });
  }
  manager?.sendDropResult(acctKey, dropOutcome(saved, lastError));
  openDropPreview(done);
  startExistingScan();
}

/** What the preview window should draw. It asks once it is listening rather than being
 * pushed to, because the overlay loads after the drop that filled this. */
export function dropPreviewItems(): { items: MailDropPreviewItem[] } {
  return { items: lastDropPreview };
}

export function closeDropPreview(): void {
  dropOverlay?.close();
}

export async function labelsForCopyTargets(): Promise<{ accounts: AccountLabels[] }> {
  const cfg = oauthConfig();

  const targetable = copyTargetEmails(profiles, lastDropSource);
  if (!cfg || !oauthTokens) {
    return {
      accounts: targetable.map((email) => ({ email, labels: [], error: 'Niet gekoppeld' })),
    };
  }

  const tokens = oauthTokens;
  const accounts: AccountLabels[] = await mapLimit(targetable, 4, async (email) => {
    const got = await mailboxToken(email);
    if (!got.ok) return { email, labels: [], error: got.error };
    const token = got.token;
    try {
      return { email, labels: await fetchLabels(token) };
    } catch (e) {

      const refused = e instanceof GmailHttpError && (e.status === 401 || e.status === 403);
      if (e instanceof GmailHttpError) {
        console.warn(
          `[labels] ${email} (${isDelegatedMailbox(email) ? 'gedelegeerd' : 'eigen'}) HTTP ${e.status}: ${e.message}`,
        );
      }

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

          if (e2 instanceof GmailHttpError && (e2.status === 401 || e2.status === 403)) {
            console.warn(`[labels] ${email} ook na een verse token HTTP ${e2.status}: ${e2.message}`);
            return { email, labels: [], error: mailboxRefusedText(email) };
          }
          return { email, labels: [], error: (e2 as Error).message };
        }
      }
      if (refused) {
        if (!isDelegatedMailbox(email)) markRefreshFailed(email);
        return { email, labels: [], error: mailboxRefusedText(email) };
      }
      return { email, labels: [], error: (e as Error).message };
    }
  });
  return { accounts };
}

// Above this the picker says nothing about duplicates at all, so it is set above the most a
// drag can produce: a label drag stops at MAX_THREADS. It used to be ten, which meant a drag of
// a hundred rows was reported on for none of them. What made this affordable is the batched
// query -- ten Message-IDs per search instead of one -- and that the scan runs from the drop
// rather than from the click, so its cost is paid while the window is still drawing.
const EXISTING_SCAN_LIMIT = MAX_THREADS;

const EXISTING_SCAN_CONCURRENCY = 4;

/** The scan of the drag that is on screen, kept so the picker cannot start a second one. Its
 * answers sit in a map so a remembered one is replaced by Gmail's rather than counted twice. */
let existingScan: {
  serial: number;
  scanned: number;
  outcomes: Map<string, ScanOutcome>;
} | null = null;

/** What the picker draws, from the answers that have landed so far. Also refreshes what the
 * check at Kopieer reuses, since that is the same fold. */
function existingSnapshot(): ExistingResult {
  if (!existingScan) return { accounts: [], scanned: 0, serial: dropSerial, answered: 0 };
  const { result, byEmail } = existingSoFar(
    [...existingScan.outcomes.values()],
    existingScan.scanned,
    existingScan.serial,
  );
  // Updated on every answer, not only at the end: press Kopieer while the scan is running and
  // the mailboxes that did answer cost no requests, the rest are asked as they always were.
  lastExisting = { serial: existingScan.serial, byEmail };
  return result;
}

/**
 * Starts asking where the drag's mail already sits, at the drop rather than at the click
 *
 * The warning belongs before the choice: the check at Kopieer only looks at labels already
 * ticked, so "already there, under another label" arrived too late. Waiting for the picker to
 * open only moved that wait in front of the user, so the drop starts it and every mailbox
 * that answers is pushed straight to the window.
 *
 * One search per mailbox per message rather than one per label — the same two requests
 * whether the mailbox has four labels or four hundred.
 */
export function startExistingScan(): void {
  if (existingScan?.serial === dropSerial) return;

  const files = lastDropSaved.filter((f) => f.messageId.trim());
  const targetable = copyTargetEmails(profiles, lastDropSource);
  const tooBig = files.length > EXISTING_SCAN_LIMIT;
  if (tooBig) {
    notifyLog(`[maildrop] ${files.length} mails is te veel om op dubbelen te controleren`);
  }
  const state = {
    serial: dropSerial,
    // 0 says "not looked up", which the picker draws differently from "found nothing"
    scanned: tooBig ? 0 : files.length,
    outcomes: new Map<string, ScanOutcome>(),
  };
  existingScan = state;
  if (files.length === 0 || tooBig || targetable.length === 0) return;

  const answered = (outcome: ScanOutcome) => {
    // A scan can outlive the drop that started it; the one on screen is the only one that
    // may still draw.
    if (existingScan !== state) return;
    // One answer per mailbox: Gmail's replaces a remembered one rather than joining it, or the
    // same mail would be counted twice under the same label.
    if (state.outcomes.get(outcome.email)?.provisional === false && outcome.provisional) return;
    state.outcomes.set(outcome.email, outcome);
    dropOverlay?.send(IPC.MAIL_DROP_EXISTING, existingSnapshot());
  };

  // Before a single request goes out: what the app has already seen. For a mail it copied
  // there itself that is the answer Gmail is about to give, so the warning is on screen while
  // the scan is still starting.
  const messageIds = files.map((f) => f.messageId);
  const index = messageIndex?.load() ?? emptyIndex();
  for (const email of targetable) {
    const found = indexedScan(index, messageIds, email, Date.now());
    if (found.length > 0) answered({ email, found, provisional: true });
  }

  // Nobody awaits this: the picker is sent every answer as it lands and asks for the rest
  // itself. That makes the mailbox loop the only place an error can still surface, so it
  // catches per mailbox and reports that mailbox as unchecked.
  void mapLimit(targetable, EXISTING_SCAN_CONCURRENCY, async (email) => {
    try {
      const got = await mailboxToken(email);
      if (!got.ok) return answered({ email, found: null });
      // A mail of this mailbox's own, to prove the batched query was understood. Without one
      // labelsHoldingMany asks per message, which is what this always did.
      const canary = await mailboxCanary(got.token).catch(() => '');
      const found = await labelsHoldingMany(got.token, messageIds, canary);
      answered({ email, found, provisional: false });
      for (const m of found) {
        if (m.labelIds.length > 0) remember(index, m.messageId, email, m.labelIds, Date.now());
      }
      messageIndex?.save(Date.now());
    } catch (e) {
      console.warn(`[maildrop] kon ${email} niet controleren op dubbelen:`, e);
      answered({ email, found: null, error: 'Kon niet controleren' });
    }
  });
}

/** Where the last drag's mail already sits, as far as the scan has got. The picker asks once
 * when it opens, because it may well have opened after the first answers landed, and is sent
 * the rest as they come in. */
export function existingForCopyTargets(): ExistingResult {
  startExistingScan();
  return existingSnapshot();
}

// What may be in flight across the whole copy, in bytes rather than in mails. A count was the
// wrong unit: it had to be low enough for the one mail of eleven megabytes, which then throttled
// the ninety-nine of fifty kilobytes beside it -- measured at 28% of the quota Gmail allowed,
// purely because of that setting. This bounds peak memory for real, and lets small mails go wide.
const COPY_BYTES_IN_FLIGHT = 64 * 1024 * 1024;

// A ceiling on the count as well, so tiny mails do not open hundreds of connections at once.
//
// Set from a measurement rather than from the arithmetic. The arithmetic says thirty-two: an
// insert costs 25 of 250 units, so ten a second, and reaching ten a second while one insert takes
// 2.8 seconds needs about thirty in flight. Tried, and it came out 2.2x SLOWER -- the old quota
// window handed out a second's worth in one burst, Gmail answered 429, and the retry backoff cost
// more than the concurrency won. quota.ts paces smoothly now, so that failure mode is gone, but
// twelve is as far as this goes until a live run says otherwise. It is already better than the
// eight it replaces on both counts measured: 4.3 a second into the delegated mailbox against
// 2.75, and the full ten into an own account against 7.12.
const COPY_IN_FLIGHT = 24;

// How many mailboxes are worked at once. Each is a different Gmail user with a quota of its own.
const MAILBOX_LIMIT = 3;

const PER_MAILBOX_MAX = 12;

/** What copying one file to one mailbox came to. Kept per file rather than appended as it
 * happens, so log.jsonl reads in the order of the drag and not in the order the uploads
 * finished. */
interface CopyOutcome {
  copied?: true;
  skipped?: true;
  error?: string;
  record?: LogRecord;
}

/**
 * Copies the saved files into one mailbox
 *
 * @param arg
 * @returns {Promise<CopyOutcome[]>} one entry per file, in the order of the drag
 * @private
 */
async function copyToMailbox(arg: {
  cfg: OAuthConfig;
  tokens: OAuthStore;
  ts: string;
  target: MailDropCopyTarget;
  token: string;
  files: SavedRef[];
  index: Set<string>;
  /** How many uploads this mailbox may have going, shared out by perMailboxLimit */
  groupLimit: number;
  /** Room to upload, by size, shared with the other mailboxes of this copy */
  budget: UploadBudget;
  /** The milliseconds one upload took, for the log */
  onInsert?: (ms: number) => void;
  onDone: () => void;
}): Promise<CopyOutcome[]> {
  const { cfg, tokens, ts, target, files, index, onDone } = arg;
  const outcomes = new Array<CopyOutcome>(files.length);
  let token = arg.token;

  // One refresh per mailbox however many uploads ran into the 401 together: each of them
  // asking for a fresh token would trade the expired one in four times over, and the later
  // answers would invalidate the token the earlier uploads just got.
  let refreshing: Promise<string | null> | null = null;
  const freshToken = async (used: string): Promise<string | null> => {
    if (token !== used) return token;
    refreshing ??= (async () => {
      const fresh = await forceRefresh(cfg, tokens, target.email);
      if (fresh) {
        token = fresh;
        clearRefreshFailure(target.email);
      } else {
        markRefreshFailed(target.email);
      }
      return fresh;
    })().finally(() => {
      refreshing = null;
    });
    return await refreshing;
  };

  await mapLimit(threadGroups(files), arg.groupLimit, async (group) =>
    runThreadGroup(
      group,
      async ({ ref, index: at }: { ref: SavedRef; index: number }, landedIn?: string) => {
        const { outcome, threadId, uploadMs } = await copyOneFile({
          ts,
          target,
          ref,
          index,
          landedIn,
          token: () => token,
          freshToken,
          budget: arg.budget,
        });
        // Only the upload itself. Timing the whole call would fold the wait for room into the
        // figure the diagnosis rests on, and make a copy look slower per mail the wider it runs.
        if (uploadMs !== undefined) arg.onInsert?.(uploadMs);
        outcomes[at] = outcome;
        onDone();
        return { threadId: threadId ?? undefined };
      },
      arg.groupLimit,
    ),
  );
  return outcomes;
}

/**
 * Copies one saved file into one mailbox
 *
 * @param arg
 * @returns {Promise<{outcome: CopyOutcome, threadId?: string}>} the thread it landed in, for
 *   the rest of its conversation to be filed under
 * @private
 */
async function copyOneFile(arg: {
  ts: string;
  target: MailDropCopyTarget;
  ref: SavedRef;
  index: Set<string>;
  landedIn?: string;
  token: () => string;
  freshToken: (used: string) => Promise<string | null>;
  budget: UploadBudget;
}): Promise<{ outcome: CopyOutcome; threadId?: string; uploadMs?: number }> {
  const { ts, target, ref, index, landedIn } = arg;
  const { file, messageId } = ref;

  const labelIds = labelsStillNeeded(index, target.email, target.labelIds, messageId);
  if (labelIds.length === 0) return { outcome: { skipped: true } };

  // Asked before the file is read, so the room is reserved before the memory is taken rather
  // than after. A file whose size cannot be read reserves nothing and takes its chances.
  let size = 0;
  try {
    size = (await stat(file)).size;
  } catch {
  }

  return await arg.budget.run(size, async () => {
    const from = Date.now();
    let raw: Buffer;
    try {
      raw = await readFile(file);
    } catch {
      const error = `Kan ${file} niet lezen`;
      return { outcome: { error, record: { ts, account: target.email, threadId: '', file, error } } };
    }

    try {
      const used = arg.token();
      const insert = (t: string, thread?: string) => insertMessage(t, raw, labelIds, thread);
      let inserted: { id: string | null; threadId: string | null };
      try {
        inserted = await insert(used, landedIn);
      } catch (e) {
        if (e instanceof GmailHttpError && e.status === 400 && landedIn) {
          console.warn(`[maildrop] ${file} paste niet in thread ${landedIn}, los ingevoegd`);
          inserted = await insert(used);
        } else {
          if (!(e instanceof GmailHttpError) || e.status !== 401) throw e;
          const fresh = await arg.freshToken(used);
          if (!fresh) throw new Error('Verbinding verlopen');
          inserted = await insert(fresh, landedIn);
        }
      }
      // The one thing about a duplicate this app can know for certain: it put it there. Free,
      // exact, and it is the mail the next drag is most likely to ask about.
      if (messageIndex) remember(messageIndex.load(), messageId, target.email, labelIds, Date.now());
      return {
        outcome: {
          copied: true,
          record: {
            ts,
            account: target.email,
            threadId: inserted.threadId ?? inserted.id ?? '',
            file,
            bytes: raw.length,
            copy: { to: target.email, labels: labelIds, ok: true },
          },
        },
        threadId: inserted.threadId ?? undefined,
        uploadMs: Date.now() - from,
      };
    } catch (e) {
      const error = (e as Error).message;
      // Timed as well: an upload that was refused still spent its time on the wire, and leaving
      // it out would flatter the figure.
      return {
        outcome: {
          error,
          record: {
            ts,
            account: target.email,
            threadId: '',
            file,
            error,
            copy: { to: target.email, labels: labelIds, ok: false, error },
          },
        },
        uploadMs: Date.now() - from,
      };
    }
  });
}

/** Copies whatever the last drag saved into the chosen labels, in the chosen mailboxes.
 *
 * Runs in three modes. 'check' scans for messages already there and reports them rather than
 * copying; 'all' skips the scan; the default copies what the scan said was new.
 *
 * The mails of one mailbox go up alongside each other, the mailboxes themselves one after
 * the other: the progress bar names the mailbox it is working on, and that only stays true
 * with one at a time. */
export async function copyToMailboxes(arg: {
  targets: MailDropCopyTarget[];
  mode?: CopyMode;
}): Promise<MailDropCopyResult> {
  const cfg = oauthConfig();
  const requested = normalizeTargets(arg?.targets ?? []);
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
  // Held in a const because the mailboxes now run inside a closure, where the module binding
  // could in principle have been cleared by the time a worker gets there.
  const tokens = oauthTokens;
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
  // No mailbox in here any more: both phases run several at once, so naming one of them was
  // going to be a lie. The count is over the whole copy.
  const progress = (phase: 'check' | 'copy', of = total) =>
    dropOverlay?.send(IPC.MAIL_DROP_COPY_PROGRESS, { phase, done, total: of });

  let index = new Set<string>();
  if (mode !== 'all') {
    const key = scanKey(targets);
    const tally = { checks: 0, reused: 0, asked: 0 };
    const checkFrom = Date.now();
    const reusedWholeScan = lastScan?.key === key;
    const hits = reusedWholeScan
      ? lastScan!.hits
      : await findDuplicates(
          targets,
          files,
          (n, of) => {
            done = n;
            progress('check', of);
          },
          tally,
        );
    notifyLog(
      `[maildrop] ${
        reusedWholeScan
          ? `dubbelencheck: overgeslagen, dezelfde keuze als de vorige poging`
          : checkLogLine({ ...tally, ms: Date.now() - checkFrom })
      }`,
    );
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

  // Alongside each other, because the quota that limits a copy is per user and every target is
  // a different user: three mailboxes have three times ten inserts a second between them where
  // one after the other had ten. What is left after that is the uplink, since there is no
  // server-side copy between accounts and the bytes go up once per mailbox regardless.
  // Worked out here rather than fixed: a copy into one mailbox gets the whole allowance and
  // reaches that mailbox's own ceiling of ten inserts a second, where a fixed split left it on
  // the same narrow limit as one of three.
  const groupLimit = perMailboxLimit(
    Math.min(targets.length, MAILBOX_LIMIT),
    COPY_IN_FLIGHT,
    PER_MAILBOX_MAX,
  );
  // Shared across the mailboxes on purpose: the memory these uploads hold is one pool, however
  // many mailboxes are being written to.
  const budget = createUploadBudget(COPY_BYTES_IN_FLIGHT, COPY_IN_FLIGHT);
  const copyFrom = Date.now();
  const perTarget = await mapLimit(targets, MAILBOX_LIMIT, async (target) => {
    const tokenFrom = Date.now();
    const got = await mailboxToken(target.email);
    const tokenMs = Date.now() - tokenFrom;
    // Every attempted upload, so the line can show the spread. Held per mailbox rather than
    // logged per mail: notifyLog appends synchronously, and a label drag is hundreds of mails.
    const inserts: number[] = [];
    if (!got.ok) {
      notifyLog(
        `[maildrop] copy ${target.email} (${
          isDelegatedMailbox(target.email) ? 'gedelegeerd' : 'eigen'
        }): geen token na ${tokenMs}ms — ${got.error}`,
      );
      if (!isDelegatedMailbox(target.email)) markRefreshFailed(target.email);
      done += files.length;
      progress('copy');
      return {
        account: {
          email: target.email,
          copied: 0,
          skipped: 0,
          total: files.length,
          error: got.error,
        },
        records: [] as LogRecord[],
      };
    }
    const outcomes = await copyToMailbox({
      cfg,
      tokens,
      ts,
      target,
      token: got.token,
      files,
      index,
      groupLimit,
      budget,
      onInsert: (ms) => inserts.push(ms),
      onDone: () => {
        done += 1;
        progress('copy');
      },
    });

    // In the order of the drag rather than the order the uploads finished, so log.jsonl and
    // the error the strip shows read the same as when this ran one mail at a time.
    let ok = 0;
    let over = 0;
    let lastError: string | undefined;
    const mine: LogRecord[] = [];
    for (const outcome of outcomes) {
      if (!outcome) continue;
      if (outcome.copied) ok += 1;
      if (outcome.skipped) over += 1;
      if (outcome.error) lastError = outcome.error;
      if (outcome.record) mine.push(outcome.record);
    }
    notifyLog(
      `[maildrop] ${copyLogLine({
        email: target.email,
        delegated: isDelegatedMailbox(target.email),
        tokenMs,
        inserts,
        copied: ok,
        skipped: over,
        failed: files.length - ok - over,
      })}`,
    );
    return {
      account: {
        email: target.email,
        copied: ok,
        skipped: over,
        total: files.length,
        error: ok + over < files.length ? (lastError ?? 'Niet alles gekopieerd') : undefined,
      },
      records: mine,
    };
  });

  // In the order the mailboxes were picked rather than the order they finished: mapLimit
  // answers in input order, and assembleCopy keeps it that way, so log.jsonl and the report
  // read the same as they did when the mailboxes ran one at a time.
  const assembled = assembleCopy(perTarget);
  records.push(...assembled.records);
  accounts.push(...assembled.accounts);
  copied += assembled.copied;
  skipped += assembled.skipped;

  notifyLog(
    `[maildrop] copy klaar: ${copied} gekopieerd, ${skipped} overgeslagen van ${total} ` +
      `naar ${targets.length} postvak(ken) in ${((Date.now() - copyFrom) / 1000).toFixed(1)}s`,
  );

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
