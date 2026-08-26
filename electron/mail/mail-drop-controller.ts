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
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { IPC } from '../core/ipc';
import type {
  MailDropCopyAccountResult,
  MailDropCopyControlAction,
  MailDropCopyControlResult,
  MailDropCopyProgress,
  MailDropCopyResult,
  MailDropCopyStoppedResult,
  MailDropCopyTarget,
  MailDropCopyWarnedResult,
  MailDropFolderStatus,
  MailDropPayload,
  MailDropPreviewItem,
  MailDropTree,
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
  insertLabelIds,
  labelsForMessage,
  labelsStillNeeded,
  newMessageCount,
  normalizeTargets,
  scanAnswer,
  tallyOutcomes,
  threadGroups,
  type CopyMode,
  type ResolvedTreeLabels,
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
  SIDEBAR_LABEL_SCRAPE_JS,
  labelListUrl,
  labelNamesFromHrefs,
  mergeTreeThreads,
  scrapeSettled,
  type LabelThread,
  type TreeThread,
} from './label-drop';
import {
  labelTreeMembers,
  planLabelTree,
  resolveMessageLabels,
  type LabelTreePlan,
} from './label-tree';
import { fetchThreadEmls } from './mail-fetch';
import { emptyIndex, indexedScan, remember } from './message-index';
import { BUSY_TEXT, NO_SUBJECT, SLOW_TEXT, dropOutcome, type MessageRef } from './dropzone';
import { DROP_LOCK_MS, createDropLock } from './drop-lock';
import { defaultMailFolder, looksRemoteFolder } from './mail-folder';
import { createCopyRunControl, type CopyRunControl } from './copy-control';
import {
  attemptWrite,
  finishCopyJournal,
  findOrphanedRuns,
  readCopyJournal,
  recordCopyJournalDecision,
  recordCopyJournalEntry,
  recordCopyJournalLabel,
  startCopyJournal,
  withWarnings,
  type CopyJournalRead,
} from './copy-journal';
import { deleteCreatedLabels, sweepRunMarkers as runSweep } from './copy-marker-run-sweep';
import type {
  CopyRunId,
  CopyStopMode,
  CreatedLabel,
  MarkerLabel,
  RollbackOutcome,
} from './copy-run-types';
import {
  GmailCancelledError,
  GmailHttpError,
  batchModifyMessages,
  createHiddenLabel,
  deleteLabel,
  fetchLabels,
  fetchUserLabelMap,
  createVisibleLabel,
  fetchMessageListPage,
  fetchThreadMessages,
  fetchThreadRaw,
  insertMessage,
  labelsHoldingMany,
  mailboxCanary,
  markerLabelName,
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
  /** The labels of a dragged tree this message was found under, empty for every other drag.
   * What the copy turns into destination labels, one mailbox at a time. */
  sourceLabels: string[];
}


//===========================
// Module state
//===========================

let lastDropPreview: MailDropPreviewItem[] = [];

let lastDropSaved: SavedRef[] = [];

let lastDropSource = '';

/** The tree the last drag turned out to be, or null when it was not a label drag. Read by the
 * picker, which draws what would be created, and by the copy, which plans against it. Cleared
 * at the start of every drop, so a conversation drag can never inherit the previous label
 * drag's tree. */
let lastDropTree: MailDropTree | null = null;

/** `scanned` is kept alongside `hits` for exactly one reason: proving, per mailbox and per
 * message, that this run's own scan found zero copies there before it inserted anything --
 * see absenceKey and where it is read in copyToMailboxes. */
let lastScan: { key: string; hits: DuplicateHit[]; scanned: Map<string, MailboxScan> } | null =
  null;

/** What the picker's own scan found, kept for the check at Kopieer, which asks a narrower
 * question about the same mail. Stamped with the drag it belongs to, so the next drag
 * ignores it rather than answering for the wrong mail. */
let lastExisting: { serial: number; byEmail: Map<string, MailboxScan> } | null = null;

let dropSerial = 0;

/** One pull at a time, and this is what says which one. */
const dropLock = createDropLock();

/** The copy in flight right now, if any -- so a pause or stop asked for over IPC can reach
 * the loop that is actually running. `total` is carried here too, not recomputed, since a
 * paused progress line needs the same number the running one showed. */
let activeRun: { runId: CopyRunId; control: CopyRunControl; root: string; total: number } | null =
  null;


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
  sourceLabels: string[] = [],
): SavedRef[] {
  return messages.map((m, i) => ({
    file: join(root, files[i]),
    messageId: m.headers.messageId,
    subject: m.headers.subject || NO_SUBJECT,
    threadId,
    sourceLabels,
  }));
}

/**
 * Which of a drag's messages are already in the chosen mailboxes and labels
 *
 * @param targets
 * @param saved
 * @param onProgress
 * @param tally filled in for the log: how much of the check the picker's scan had already
 *   answered
 * @returns the hits, and everything this pass actually learned live from Gmail per mailbox --
 *   `scanned`, which copyToMailboxes reads to prove absence per mail per mailbox for a
 *   cancel's reconciliation pass. A missing key there means "not looked up", an empty list
 *   means "looked up, found nothing" (MailboxScan's own contract); only the second is proof.
 */
async function findDuplicates(
  targets: MailDropCopyTarget[],
  saved: SavedRef[],
  onProgress: (done: number, total: number) => void,
  tally?: { checks: number; reused: number; asked: number },
  resolved: ResolvedTreeLabels = new Map(),
): Promise<{ hits: DuplicateHit[]; scanned: Map<string, MailboxScan> }> {
  const checks = duplicateChecks(targets, saved, resolved);

  // The scan behind the picker asked the wider question — which labels hold this message —
  // so most of these are already answered. What it did not cover, because the mailbox
  // refused or the drag was too big to scan, is still asked here.
  const scan = lastExisting?.serial === dropSerial ? lastExisting.byEmail : null;
  const answers = checks.map((check) => scanAnswer(scan, check));
  const open = checks.filter((_, i) => answers[i] === null);
  const scanned = new Map<string, MailboxScan>(scan ?? undefined);

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
    for (const [email, m] of fresh) scanned.set(email, m);

    // A mailbox that could not be asked answers false, which is what the per-check version did
    // when its request threw: better to copy a mail twice than to skip one that is not there.
    // That fallback only decides whether to insert -- it must never be read as proof of
    // absence, which is exactly why `scanned` only ever holds what `fresh` actually answered.
    for (const [i, answer] of answers.entries()) {
      if (answer === null) answers[i] = scanAnswer(fresh, checks[i]) ?? false;
    }
  }

  return { hits: checks.filter((_, i) => answers[i] === true), scanned };
}

function scanKey(targets: MailDropCopyTarget[]): string {
  return `${dropSerial}|${JSON.stringify(targets)}`;
}

/**
 * The lookup key for what one mailbox's scan proved about one message
 *
 * @param email
 * @param messageId the RFC822 Message-ID
 * @returns the two joined by NUL, which no address or Message-ID can contain
 * @private
 */
function absenceKey(email: string, messageId: string): string {
  return `${email}\0${messageId}`;
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
): Promise<{ threads: TreeThread[]; members: string[]; capped: boolean }> {
  const threads: TreeThread[] = [];
  let capped = false;
  let members: string[] = [label];
  if (!manager) return { threads, members, capped };

  await manager.withHiddenView(labelListUrl(authuser, label, 1), async (wc) => {
    // Gmail's own navigation is the only list of sublabels there is without the API, and it
    // is read from whichever label view happens to be open -- the sidebar is the same on all
    // of them.
    const hrefs = (await wc.executeJavaScript(SIDEBAR_LABEL_SCRAPE_JS).catch(() => [])) as string[];
    const found = labelTreeMembers(labelNamesFromHrefs(hrefs), label);
    if (found.length > 0) members = found;

    // Carried across the members, not reset per member: the guard against reading a list that
    // has not been replaced yet is exactly as needed when the previous page belonged to the
    // previous label as when it belonged to the previous page of this one.
    let firstOfPrevious = '';
    for (const member of members) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const hash = new URL(labelListUrl(authuser, member, page)).hash;
        await wc.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`).catch(() => null);
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
            `[maildrop] label "${member}" pagina ${page}: lijst stond niet stil, ${pageThreads.length} rijen genomen`,
          );
        }
        firstOfPrevious = pageThreads[0].threadId;

        const { added, total } = mergeTreeThreads(threads, member, pageThreads);
        if (total >= MAX_THREADS) {
          capped = pageThreads.length >= PAGE_SIZE;
          break;
        }
        if (added === 0) break;
      }
      if (capped) break;
    }
  });
  return { threads, members, capped };
}

interface CollectedThread {
  thread: TreeThread;
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
): Promise<{ collected: CollectedThread[]; members: string[]; capped: boolean } | null> {
  if (!account) return null;
  const withToken = await withMailboxToken(account);
  if (!withToken) return null;

  const threads: TreeThread[] = [];
  let members: string[];
  let capped = false;
  try {
    const all = await withToken((token) => fetchUserLabelMap(token));
    members = labelTreeMembers([...all.keys()], label);
    if (members.length === 0) return null;
    // One listing per member, folded into one accumulator: the cap counts the tree, and a
    // conversation in two of its labels is one conversation carrying both.
    for (const member of members) {
      const labelId = all.get(member);
      if (!labelId) continue;
      const list = await withToken((token) => listLabelThreadIds(token, labelId, MAX_THREADS));
      const page = list.threadIds.map((threadId) => ({ threadId, subject: '' }));
      const { total } = mergeTreeThreads(threads, member, page);
      capped = capped || list.capped;
      if (total >= MAX_THREADS) {
        capped = true;
        break;
      }
    }
  } catch {
    return null;
  }

  let pulled = 0;
  report(0, threads.length);
  const collected = await mapLimit(threads, THREAD_FETCH_LIMIT, async (thread) => {
    const { threadId } = thread;
    try {
      const raws = await withToken((token) => fetchThreadRaw(token, threadId));
      const messages: SavedMessage[] = raws.map((raw) => ({
        raw,
        headers: parseHeaders(raw.toString('utf8')),
      }));
      return {
        thread: { ...thread, subject: messages[0]?.headers.subject || NO_SUBJECT },
        messages,
        error: messages.length === 0 ? 'Geen bericht in dit gesprek' : undefined,
      };
    } catch (e) {
      return {
        thread: { ...thread, subject: '' },
        messages: [],
        error: `Ophalen mislukt (${(e as Error).message})`,
      };
    } finally {
      // In a finally, so a conversation that could not be fetched still moves the count on.
      // A counter that stops on a failed conversation reads as a pull that hung.
      pulled += 1;
      report(pulled, threads.length);
    }
  });
  return { collected, members, capped };
}

/**
 * How many conversations each label of the tree turned out to hold
 *
 * Counted off what was actually collected rather than off the listing, so the number the
 * picker shows is the number that will be copied. A label with none is still in the list: an
 * empty sublabel is created too, and leaving it out would make the picker promise a shape it
 * is not going to build.
 *
 * @param members every label of the tree, parents first
 * @param collected
 * @returns one entry per member, in the members' own order
 * @private
 */
function memberCounts(
  members: string[],
  collected: CollectedThread[],
): Array<{ name: string; threads: number }> {
  return members.map((name) => ({
    name,
    threads: collected.filter((c) => c.thread.labels.includes(name)).length,
  }));
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
  let members: string[];

  if (viaApi) {
    notifyLog(
      `[maildrop] label "${label}" via de API: ${viaApi.members.length} label(s), ${viaApi.collected.length} gesprekken`,
    );
    if (viaApi.collected.length === 0) return empty();
    collected = viaApi.collected;
    capped = viaApi.capped;
    members = viaApi.members;
  } else {
    const scraped = await collectLabelThreads(authuser, label);
    notifyLog(
      `[maildrop] label "${label}" van de pagina gelezen: ${scraped.members.length} label(s), ${scraped.threads.length} gesprekken`,
    );
    if (scraped.threads.length === 0) return empty();
    capped = scraped.capped;
    members = scraped.members;
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
    saved.push(
      ...savedRefs(
        root,
        files.slice(at, at + c.messages.length),
        c.messages,
        c.thread.threadId,
        c.thread.labels,
      ),
    );
    at += c.messages.length;
  }
  lastDropTree = { dragged: label, members: memberCounts(members, collected) };
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
  lastDropTree = null;
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
  /** Identifies the journal a successful insert here is recorded in */
  runId: CopyRunId;
  journalRoot: string;
  /** Checked before each new conversation starts; copyOneFile checks it again per file */
  wait: () => Promise<'continue' | 'stop'>;
  /** Aborted the moment the run is told to stop, to sever whatever is already on the wire */
  signal: AbortSignal;
  /** Whether this run's own scan found this mailbox holding zero copies of a given
   * Message-ID before anything was inserted -- keyed by absenceKey. Empty in 'all' mode. */
  provedAbsent: Set<string>;
  /** Per mailbox, per Message-ID the labels a dragged tree resolved to. Empty for a flat
   * drag, where the labels are the target's own ticked ones. */
  resolved: ResolvedTreeLabels;
  /** This mailbox's own marker label for this run, created before the first file went out to
   * it. Folded into every insert's own labelIds -- see copyOneFile -- never applied after the
   * fact, so a severed insert can never land without it. */
  markerLabelId: string;
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

  await mapLimit(
    threadGroups(files),
    arg.groupLimit,
    async (group) =>
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
            runId: arg.runId,
            journalRoot: arg.journalRoot,
            wait: arg.wait,
            signal: arg.signal,
            provedAbsent: arg.provedAbsent,
            resolved: arg.resolved,
            markerLabelId: arg.markerLabelId,
          });
          // Only the upload itself. Timing the whole call would fold the wait for room into
          // the figure the diagnosis rests on, and make a copy look slower per mail the wider
          // it runs.
          if (uploadMs !== undefined) arg.onInsert?.(uploadMs);
          outcomes[at] = outcome;
          onDone();
          return { threadId: threadId ?? undefined };
        },
        arg.groupLimit,
      ),
    arg.wait,
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
  runId: CopyRunId;
  journalRoot: string;
  wait: () => Promise<'continue' | 'stop'>;
  signal: AbortSignal;
  provedAbsent: Set<string>;
  /** Per mailbox, per Message-ID the labels a dragged tree resolved to. Empty for a flat
   * drag, where the labels are the target's own ticked ones. */
  resolved: ResolvedTreeLabels;
  markerLabelId: string;
}): Promise<{ outcome: CopyOutcome; threadId?: string; uploadMs?: number }> {
  const { ts, target, ref, index, landedIn } = arg;
  const { file, messageId } = ref;

  const wanted = labelsForMessage(target, messageId, arg.resolved);
  const labelIds = labelsStillNeeded(index, target.email, wanted, messageId);
  if (labelIds.length === 0) return { outcome: { skipped: true } };

  // Checked before the budget is ever asked for room: a file paused here has reserved
  // nothing, so it costs the mailboxes still running nothing either. Checking after
  // budget.run had already claimed had started would hold that room hostage for as long as
  // the pause lasts.
  if ((await arg.wait()) === 'stop') return { outcome: {} };

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
      // The marker rides the same multipart POST as the real labels -- never a follow-up
      // modify call to add it afterwards, which would reopen exactly the window a cancel-safe
      // copy exists to close. It never reaches the journal or the outcome record below: both
      // stay exactly what the user asked for (`labelIds`), and the marker is tracked only by
      // the run's own journal header (see MarkerLabel).
      const withMarker = insertLabelIds(labelIds, arg.markerLabelId);
      const insert = (t: string, thread?: string) =>
        insertMessage(t, raw, withMarker, thread, arg.signal);
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
      // Gmail's own id, not the Message-ID header above: this is the only key a later
      // rollback may trash by, since a header can also match mail that was already there.
      if (inserted.id) {
        // Deliberate, not an oversight: the insert already landed and is reported as copied
        // regardless of what happens to this line. What is lost when it fails is narrow and
        // already accounted for -- this one message cannot be offered for rollback later --
        // not a reason to fail an insert that really happened. Logged rather than only
        // warned to the console, since a share dropping this write is worth being able to
        // see later, not only while someone happens to be watching devtools.
        const journalError = recordCopyJournalEntry(arg.journalRoot, {
          runId: arg.runId,
          email: target.email,
          gmailId: inserted.id,
          threadId: inserted.threadId ?? undefined,
          labelIds,
        });
        if (journalError) {
          notifyLog(`[maildrop] kon een regel niet aan de rollback-journal toevoegen: ${journalError}`);
        }
      }
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
      if (e instanceof GmailCancelledError) {
        // Deliberate, not a failure: this upload was severed because the run was told to
        // stop, not because Gmail refused it. Reported as neither copied nor an error --
        // exactly the shape a gate-refused file already answers with, below. Nothing needs
        // recording here any more: if this insert landed before the socket was cut, it landed
        // with the marker already on it (insertLabelIds above), so the run's own end-of-run
        // sweep finds it by label membership. There is no ambiguous state left to reconcile.
        return { outcome: {}, uploadMs: Date.now() - from };
      }
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

/** What every mailbox taking a dragged tree has to do, worked out before anything is created */
interface TreePlanning {
  /** Per mailbox its own plan; a mailbox not taking the tree is absent */
  plans: Map<string, LabelTreePlan>;
  /** Per mailbox the labels resolved so far. Until the missing labels have been created this
   * only names the ones that were already there, which is exactly what the duplicate scan may
   * ask about: a label yet to be made holds nothing. */
  resolved: ResolvedTreeLabels;
  /** Per mailbox why it could not be planned at all */
  errors: Map<string, string>;
}

/**
 * The label a chosen id belongs to
 *
 * @param existing name to id, as the mailbox answered it
 * @param labelId
 * @returns the name, or null when the mailbox no longer has that label
 * @private
 */
function nameForLabelId(existing: Map<string, string>, labelId: string): string | null {
  for (const [name, id] of existing) if (id === labelId) return name;
  return null;
}

/**
 * Per saved message the labels it goes out with in one mailbox
 *
 * @param files the drag's saved messages
 * @param plan
 * @param ids every destination name that exists in the mailbox now
 * @returns Message-ID to label ids
 * @private
 */
function perMessageLabels(
  files: SavedRef[],
  plan: LabelTreePlan,
  ids: Map<string, string>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const file of files) {
    if (!file.messageId.trim()) continue;
    out.set(file.messageId, resolveMessageLabels(file.sourceLabels, plan.destinations, ids));
  }
  return out;
}

/**
 * Works out per mailbox what taking the dragged tree would mean, creating nothing
 *
 * Deliberately before the duplicate scan and before the run exists: the scan can only ask
 * about labels that are already there, and a 'check' pass the user then cancels must not leave
 * new labels behind in their mailbox.
 *
 * @param targets
 * @param files the drag's saved messages
 * @param tree what the drag turned out to carry, or null when it was not a label drag
 * @returns the plans, what already resolves, and per mailbox whatever went wrong
 * @private
 */
async function planTrees(
  targets: MailDropCopyTarget[],
  files: SavedRef[],
  tree: MailDropTree | null,
): Promise<TreePlanning> {
  const plans = new Map<string, LabelTreePlan>();
  const resolved: ResolvedTreeLabels = new Map();
  const errors = new Map<string, string>();
  const taking = targets.filter((t) => t.tree);
  if (!tree || taking.length === 0) return { plans, resolved, errors };

  const members = tree.members.map((m) => m.name);
  await mapLimit(taking, MAILBOX_LIMIT, async (target) => {
    const got = await mailboxToken(target.email);
    if (!got.ok) {
      errors.set(target.email, got.error);
      return;
    }
    try {
      const existing = await fetchUserLabelMap(got.token);
      const chosen = target.tree?.parentLabelId ?? null;
      const parent = chosen ? nameForLabelId(existing, chosen) : null;
      // Refused rather than quietly put at the top of the list: the user picked a label, and
      // landing somewhere else is not a smaller version of that.
      if (chosen && !parent) {
        errors.set(target.email, 'het gekozen label bestaat niet meer in dit postvak');
        return;
      }
      const plan = planLabelTree(members, tree.dragged, parent, existing);
      plans.set(target.email, plan);
      resolved.set(target.email, perMessageLabels(files, plan, new Map(plan.reuse)));
    } catch (e) {
      errors.set(target.email, (e as Error).message);
    }
  });
  return { plans, resolved, errors };
}

/**
 * Creates the labels a mailbox is still missing, recording each one as it lands
 *
 * Parents before children, which is `plan.create`'s own order -- creating `A/B` first leaves
 * Gmail drawing a parent nobody made. A name Gmail refuses takes only itself out of the copy:
 * the messages that would have gone there are skipped and the name is reported, since filing
 * them under a nearer ancestor would put mail where nobody asked for it.
 *
 * @param root the drop folder, for the journal
 * @param runId
 * @param email
 * @param plan
 * @returns every destination name that exists now, and per failed label its own reason
 * @private
 */
async function createTreeLabels(
  root: string,
  runId: CopyRunId,
  email: string,
  plan: LabelTreePlan,
): Promise<{ ids: Map<string, string>; created: CreatedLabel[]; failed: string[]; warnings: string[] }> {
  const ids = new Map(plan.reuse);
  const created: CreatedLabel[] = [];
  const failed: string[] = [];
  const warnings: string[] = [];
  if (plan.create.length === 0) return { ids, created, failed, warnings };

  const got = await mailboxToken(email);
  if (!got.ok) {
    for (const name of plan.create) failed.push(`${name}: ${got.error}`);
    return { ids, created, failed, warnings };
  }
  for (const name of plan.create) {
    try {
      const made = await createVisibleLabel(got.token, name);
      ids.set(name, made.id);
      const record: CreatedLabel = { email, labelId: made.id, name };
      created.push(record);
      const warn = recordCopyJournalLabel(root, runId, record);
      if (warn) warnings.push(`kon label "${name}" niet in het journaal zetten: ${warn}`);
    } catch (e) {
      failed.push(`${name}: ${(e as Error).message}`);
    }
  }
  return { ids, created, failed, warnings };
}

/**
 * Sweeps every mailbox's own marker for one run, wiring the real Gmail calls into
 * copy-marker-run-sweep.ts's own sweepRunMarkers
 *
 * The strip-vs-trash logic and the "acts on the listing, not on any local record" property it
 * gives a rollback both live there instead of here, purely so they can be unit tested: this
 * file pulls in Electron's `app` at module load (core/paths.ts), so nothing importing it can
 * ever run under a test.
 *
 * @param runId
 * @param markers this run's own marker per mailbox, from its journal header
 * @param mode 'strip' for a clean finish or a stop-keep, 'trash' for a stop-rollback
 * @param created the labels this run made itself, deleted again on a rollback and left alone
 *   on every other ending
 * @param onProgress called once per mailbox as it settles, so a rollback dialog can show this
 *   running
 * @returns what became of each mailbox, and whether every one of them converged cleanly
 * @private
 */
async function sweepRunMarkers(
  runId: CopyRunId,
  markers: MarkerLabel[],
  mode: 'strip' | 'trash',
  created: CreatedLabel[] = [],
  onProgress?: (done: number, total: number) => void,
): Promise<RollbackOutcome> {
  const deps = {
    token: mailboxToken,
    list: fetchMessageListPage,
    modify: batchModifyMessages,
    deleteLabel,
  };
  const outcome = await runSweep(runId, markers, mode, deps, onProgress);
  // After the mail, never before it: a label deleted while its messages still carry it takes
  // the marker off them too, and the sweep would then have nothing left to find them by.
  if (mode === 'trash' && created.length > 0) {
    const left = await deleteCreatedLabels(created, deps);
    if (left.length > 0) {
      notifyLog(`[maildrop] rollback: labels bleven staan — ${left.join(', ')}`);
    }
  }
  return outcome;
}

/**
 * The warning line for a mailbox whose sweep did not converge
 *
 * Framed as resumable, not as doubtful: unlike the old Message-ID reconciliation this
 * replaces, there is no ambiguity left to report here -- only a sweep that has not finished
 * yet, which the next start's resumed sweep will pick up on its own.
 *
 * @param m
 * @param verb the Dutch verb for what did not finish -- 'opruimen' or 'ongedaan maken'
 * @returns the line, for `warnings`
 */
function sweepWarning(m: RollbackOutcome['mailboxes'][number], verb: string): string {
  const why = m.refused === 'permission'
    ? 'geen rechten'
    : m.refused === 'auth'
      ? 'kon niet worden geopend'
      : m.reason ?? 'nog niet bevestigd';
  return `${m.email}: ${verb} niet afgerond (${why}), wordt bij de volgende start opnieuw geprobeerd`;
}

/**
 * Whether every mailbox in a sweep has reached a terminal state
 *
 * Not the same question as `complete`: a mailbox that refused outright is terminal -- retrying
 * will not fix a permission problem -- while one that merely has not converged yet is not, and
 * must be left open for the next resumed sweep rather than closed as if it were done. Only
 * when every mailbox is one or the other does this run's journal get its closing line.
 *
 * @param outcome
 * @returns true once nothing here would change by sweeping again right now
 */
function settled(outcome: RollbackOutcome): boolean {
  return outcome.mailboxes.every((m) => m.converged || m.refused);
}

/**
 * Pauses, resumes or stops the copy in flight
 *
 * @param action what the paused dialog asked for
 * @returns whether the gate took the action, since there is not always a copy running to
 *   take it
 */
export function controlCopyRun(action: MailDropCopyControlAction): MailDropCopyControlResult {
  if (!activeRun) return { ok: false, error: 'Er wordt niet gekopieerd' };
  const { control } = activeRun;
  switch (action) {
    case 'pause':
      control.pause();
      sendPausedProgress();
      return { ok: true };
    case 'resume':
      control.resume();
      return { ok: true };
    case 'stop-keep':
      control.stop('keep');
      return { ok: true };
    case 'stop-rollback':
      control.stop('rollback');
      return { ok: true };
    default:
      return { ok: false, error: 'Onbekende actie' };
  }
}

/**
 * Tells the modal how far a paused copy had got, per mailbox
 *
 * Read off the journal rather than off a running tally: every insert that landed is already
 * on disk the moment it answers (appendCopyJournalEntry), so counting those lines is the
 * same count a rollback would work from, and needs nothing kept in memory just for this.
 *
 * @private
 */
function sendPausedProgress(): void {
  if (!activeRun) return;
  const { runId, root, total } = activeRun;
  const entries = readCopyJournal(root, runId)?.entries ?? [];
  const byMailbox = new Map<string, number>();
  for (const e of entries) byMailbox.set(e.email, (byMailbox.get(e.email) ?? 0) + 1);
  dropOverlay?.send(IPC.MAIL_DROP_COPY_PROGRESS, {
    phase: 'copy',
    done: entries.length,
    total,
    paused: true,
    byMailbox: [...byMailbox.entries()].map(([email, copied]) => ({ email, copied })),
  } satisfies MailDropCopyProgress);
}

/** Copies whatever the last drag saved into the chosen labels, in the chosen mailboxes.
 *
 * Runs in three modes. 'check' scans for messages already there and reports them rather than
 * copying; 'all' skips the scan; the default copies what the scan said was new.
 *
 * The mails of one mailbox go up alongside each other, the mailboxes themselves one after
 * the other: the progress bar names the mailbox it is working on, and that only stays true
 * with one at a time.
 *
 * A copy that is paused and then stopped ends in one of three ways: 'completed' when it was
 * never stopped at all, 'kept' when the user chose to leave what had already landed, or a
 * rollback outcome when they chose to undo it -- see copyOneFile and the tail of this
 * function for where each of those is decided. */
export async function copyToMailboxes(arg: {
  targets: MailDropCopyTarget[];
  mode?: CopyMode;
}): Promise<MailDropCopyResult | MailDropCopyWarnedResult | MailDropCopyStoppedResult> {
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

  // Planned before the scan below, and creating nothing yet: see planTrees.
  const trees = await planTrees(targets, files, lastDropTree);
  const treeResolved: ResolvedTreeLabels = new Map(trees.resolved);

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
  // Empty in 'all' mode on purpose: that mode skips the scan below, so there is nothing to
  // prove absence from. See absenceKey.
  const provedAbsent = new Set<string>();
  if (mode !== 'all') {
    const key = scanKey(targets);
    const tally = { checks: 0, reused: 0, asked: 0 };
    const checkFrom = Date.now();
    const reusedWholeScan = lastScan?.key === key;
    const { hits, scanned } = reusedWholeScan
      ? lastScan!
      : await findDuplicates(
          targets,
          files,
          (n, of) => {
            done = n;
            progress('check', of);
          },
          tally,
          treeResolved,
        );
    notifyLog(
      `[maildrop] ${
        reusedWholeScan
          ? `dubbelencheck: overgeslagen, dezelfde keuze als de vorige poging`
          : checkLogLine({ ...tally, ms: Date.now() - checkFrom })
      }`,
    );
    lastScan = { key, hits, scanned };
    done = 0;
    index = duplicateIndex(hits);
    // A mail this mailbox's own scan found holding nothing under it is proof it was absent
    // before this run touched it. Decided once, here, rather than re-derived from `mode`
    // anywhere downstream.
    for (const [email, mailboxScan] of scanned) {
      for (const file of files) {
        if (!file.messageId.trim()) continue;
        const labelIds = mailboxScan.get(file.messageId);
        if (labelIds && labelIds.length === 0) provedAbsent.add(absenceKey(email, file.messageId));
      }
    }
    if (mode === 'check' && hits.length > 0) {
      return {
        ok: false,
        copied: 0,
        skipped: 0,
        total,
        accounts: [],
        needsConfirm: true,
        duplicates: groupDuplicates(hits),
        newCount: newMessageCount(index, targets, files.map((f) => f.messageId), treeResolved),
      };
    }
  }

  // Minted here rather than reusing dropSerial: dropSerial names the drag, and a 'check' pass
  // followed by an 'all' pass against the same drag are two runs, each with its own inserts
  // to answer for if either one is stopped partway through.
  const runId: CopyRunId = randomUUID();

  // One hidden marker label per mailbox, created before a single file goes out to it. Its id
  // is folded into every insert this run makes to that mailbox (copyOneFile) -- never applied
  // by a follow-up call -- which is what later lets a sweep find everything this run created
  // by label membership, with nothing to infer. A mailbox whose marker cannot be created is
  // not written to at all: there is nothing safe to insert into it without one, so it is
  // reported exactly like a mailbox whose token could not be had.
  const markerName = markerLabelName(runId);
  type MarkerAttempt = { email: string; markerLabelId: string } | { email: string; error: string };
  const markerAttempts = await mapLimit(targets, MAILBOX_LIMIT, async (target): Promise<MarkerAttempt> => {
    const got = await mailboxToken(target.email);
    if (!got.ok) return { email: target.email, error: got.error };
    try {
      const created = await createHiddenLabel(got.token, markerName);
      return { email: target.email, markerLabelId: created.id };
    } catch (e) {
      return { email: target.email, error: (e as Error).message };
    }
  });
  const markers: MarkerLabel[] = [];
  const markerLabelByEmail = new Map<string, string>();
  for (const a of markerAttempts) {
    if ('markerLabelId' in a) {
      markers.push({ email: a.email, markerLabelId: a.markerLabelId });
      markerLabelByEmail.set(a.email, a.markerLabelId);
    } else {
      notifyLog(`[maildrop] copy ${a.email}: kon geen intern label aanmaken — ${a.error}`);
      accounts.push({ email: a.email, copied: 0, skipped: 0, total: files.length, error: a.error });
      done += files.length;
      progress('copy');
    }
  }
  // A mailbox whose tree could not even be planned is reported and left alone, exactly like one
  // whose marker could not be made: there is nothing safe to insert into it either.
  for (const [email, error] of trees.errors) {
    if (!markerLabelByEmail.has(email)) continue;
    notifyLog(`[maildrop] copy ${email}: kon de labelstructuur niet bepalen — ${error}`);
    accounts.push({ email, copied: 0, skipped: 0, total: files.length, error });
    done += files.length;
    progress('copy');
    markerLabelByEmail.delete(email);
  }
  const readyTargets = targets.filter((t) => markerLabelByEmail.has(t.email));

  // Alongside each other, because the quota that limits a copy is per user and every target is
  // a different user: three mailboxes have three times ten inserts a second between them where
  // one after the other had ten. What is left after that is the uplink, since there is no
  // server-side copy between accounts and the bytes go up once per mailbox regardless.
  // Worked out here rather than fixed: a copy into one mailbox gets the whole allowance and
  // reaches that mailbox's own ceiling of ten inserts a second, where a fixed split left it on
  // the same narrow limit as one of three.
  const groupLimit = perMailboxLimit(
    Math.min(readyTargets.length, MAILBOX_LIMIT),
    COPY_IN_FLIGHT,
    PER_MAILBOX_MAX,
  );
  // Shared across the mailboxes on purpose: the memory these uploads hold is one pool, however
  // many mailboxes are being written to.
  const budget = createUploadBudget(COPY_BYTES_IN_FLIGHT, COPY_IN_FLIGHT);
  const copyFrom = Date.now();

  const control = createCopyRunControl();
  activeRun = { runId, control, root, total };
  startCopyJournal(root, runId, readyTargets.map((t) => t.email), Date.now(), markers);

  // After the journal exists, because every created label is written to it the moment it lands,
  // and after the markers, because an insert without one must stay impossible. Before the first
  // insert, because a message cannot be filed under a label that is not there yet.
  const createdLabels: CreatedLabel[] = [];
  const treeWarnings: string[] = [];
  const failedLabels = new Map<string, string[]>();
  for (const target of readyTargets) {
    const plan = trees.plans.get(target.email);
    if (!plan) continue;
    const made = await createTreeLabels(root, runId, target.email, plan);
    createdLabels.push(...made.created);
    treeWarnings.push(...made.warnings);
    if (made.failed.length > 0) failedLabels.set(target.email, made.failed);
    treeResolved.set(target.email, perMessageLabels(files, plan, made.ids));
    notifyLog(
      `[maildrop] copy ${target.email}: ${made.created.length} label(s) aangemaakt, ${plan.reuse.size} hergebruikt${
        made.failed.length > 0 ? `, ${made.failed.length} mislukt` : ''
      }`,
    );
  }

  const runCopy = async (): Promise<MailDropCopyResult | MailDropCopyWarnedResult | MailDropCopyStoppedResult> => {
    const perTarget = await mapLimit(
      readyTargets,
      MAILBOX_LIMIT,
      async (target) => {
        const tokenFrom = Date.now();
        const got = await mailboxToken(target.email);
        const tokenMs = Date.now() - tokenFrom;
        // Every attempted upload, so the line can show the spread. Held per mailbox rather
        // than logged per mail: notifyLog appends synchronously, and a label drag is
        // hundreds of mails.
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
          runId,
          journalRoot: root,
          wait: control.wait,
          signal: control.signal(),
          provedAbsent,
          resolved: treeResolved,
          markerLabelId: markerLabelByEmail.get(target.email)!,
          onInsert: (ms) => inserts.push(ms),
          onDone: () => {
            done += 1;
            progress('copy');
          },
        });

        // In the order of the drag rather than the order the uploads finished, so log.jsonl
        // and the error the strip shows read the same as when this ran one mail at a time.
        const mine: LogRecord[] = [];
        for (const outcome of outcomes) {
          if (outcome?.record) mine.push(outcome.record);
        }
        // Counted, not derived by subtraction: a file the gate refused and one a cancel
        // severed mid-flight are `stopped`, never `failed` -- see tallyOutcomes.
        const { copied: ok, skipped: over, failed, stopped, lastError } = tallyOutcomes(outcomes);
        notifyLog(
          `[maildrop] ${copyLogLine({
            email: target.email,
            delegated: isDelegatedMailbox(target.email),
            tokenMs,
            inserts,
            copied: ok,
            skipped: over,
            failed,
            stopped,
          })}`,
        );
        return {
          account: {
            email: target.email,
            copied: ok,
            skipped: over,
            total: files.length,
            error: failed > 0 ? (lastError ?? 'Niet alles gekopieerd') : undefined,
          },
          records: mine,
        };
      },
      control.wait,
    );

    // In the order the mailboxes were picked rather than the order they finished: mapLimit
    // answers in input order, and assembleCopy keeps it that way, so log.jsonl and the report
    // read the same as they did when the mailboxes ran one at a time.
    const assembled = assembleCopy(perTarget);
    records.push(...assembled.records);
    // A label Gmail refused is named in the mailbox's own line rather than folded into the
    // warnings: the mail that would have gone there was not copied, and that is a property of
    // this mailbox, not of the run.
    accounts.push(
      ...assembled.accounts.map((a) => {
        const refused = failedLabels.get(a.email);
        if (!refused) return a;
        const said = `label niet aangemaakt: ${refused.join('; ')}`;
        return { ...a, error: a.error ? `${a.error} — ${said}` : said };
      }),
    );
    copied += assembled.copied;
    skipped += assembled.skipped;

    notifyLog(
      `[maildrop] copy klaar: ${copied} gekopieerd, ${skipped} overgeslagen van ${total} ` +
        `naar ${targets.length} postvak(ken) in ${((Date.now() - copyFrom) / 1000).toFixed(1)}s`,
    );

    // Written for a stopped run too: this is real mail that really landed, and the log must
    // say so whether or not the run was allowed to run to its own end. A failure here is not
    // swallowed any more -- this share has dropped an appended write before, and the run
    // must say so rather than quietly proceed as if nothing happened.
    const warnings: string[] = [...treeWarnings];
    const logError = attemptWrite(() => appendLog(root, records));
    if (logError) {
      const message = `logboek niet bijgeschreven: ${logError}`;
      warnings.push(message);
      notifyLog(`[maildrop] ${message}`);
    }

    const stopMode = control.stopMode();
    if (!stopMode) {
      // Recorded before the sweep is even attempted: a normal, never-stopped finish still
      // resolves to 'keep' (strip the marker), and writing that down first is what lets a
      // crash mid-sweep resume silently instead of asking the keep-or-rollback question a
      // run that was never even paused has no business being asked.
      const decisionError = attemptWrite(() => recordCopyJournalDecision(root, runId, 'keep'));
      if (decisionError) {
        notifyLog(`[maildrop] kon de opruimkeuze niet vastleggen: ${decisionError}`);
      }
      const swept = await sweepRunMarkers(runId, markers, 'strip');
      for (const m of swept.mailboxes) {
        if (!m.converged) warnings.push(sweepWarning(m, 'opruimen'));
      }
      if (settled(swept)) {
        // Left to fail rather than only warned: an unclosed journal is precisely how this
        // app recognises a run that died halfway, so a dropped write here would make a fully
        // successful copy indistinguishable from a crash -- and the next start would offer
        // to undo mail that never needed undoing. The copy itself still succeeded, so this
        // is reported as success regardless, with the failure carried in `warnings` instead
        // of lost the way it was before.
        const closeError = attemptWrite(() => finishCopyJournal(root, runId, 'completed'));
        if (closeError) {
          const message = `afronding niet vastgelegd: ${closeError}`;
          warnings.push(message);
          notifyLog(`[maildrop] ${message}`);
        }
      } else {
        // Deliberately left without a closing line: this is what makes resumeOrphanedCopyRuns
        // pick it up and finish the sweep at the next start, using the decision above rather
        // than asking again.
        notifyLog(`[maildrop] opruimen van run ${runId} nog niet compleet, wordt hervat`);
      }
      return withWarnings(
        {
          ok: copied > 0 || skipped > 0,
          copied,
          skipped,
          total,
          accounts,
        } satisfies MailDropCopyResult,
        warnings,
      );
    }

    const byMailbox = accounts.map((a) => ({ email: a.email, copied: a.copied }));
    const decisionError = attemptWrite(() => recordCopyJournalDecision(root, runId, stopMode));
    if (decisionError) notifyLog(`[maildrop] kon de opruimkeuze niet vastleggen: ${decisionError}`);

    if (stopMode === 'keep') {
      // 'keep' means the user asked to keep the mail, not this app's own bookkeeping -- the
      // marker is stripped exactly as it would be on a normal finish.
      const swept = await sweepRunMarkers(runId, markers, 'strip');
      for (const m of swept.mailboxes) {
        if (!m.converged) warnings.push(sweepWarning(m, 'opruimen'));
      }
      if (!settled(swept)) {
        notifyLog(`[maildrop] opruimen van run ${runId} nog niet compleet, wordt hervat`);
        return {
          stopped: true,
          mode: 'keep',
          copied,
          byMailbox,
          ...(warnings.length > 0 ? { warnings } : {}),
        } satisfies MailDropCopyStoppedResult;
      }
      // Non-negotiable: this is the one write that tells a run the user chose to keep apart
      // from a crash. Left to surface rather than swallowed, so a share that drops the write
      // is reported as an error rather than trusted as a clean stop.
      const closeError = attemptWrite(() => finishCopyJournal(root, runId, 'kept'));
      if (closeError) {
        return {
          stopped: true,
          mode: 'keep',
          copied,
          byMailbox,
          error: `Gestopt, maar niet afgerond: ${closeError}`,
          ...(warnings.length > 0 ? { warnings } : {}),
        } satisfies MailDropCopyStoppedResult;
      }
      return {
        stopped: true,
        mode: 'keep',
        copied,
        byMailbox,
        ...(warnings.length > 0 ? { warnings } : {}),
      } satisfies MailDropCopyStoppedResult;
    }

    // stopMode === 'rollback': every message this run created, landed or merely severed mid-
    // flight, carries this mailbox's marker -- see copyOneFile. So undoing the run is exactly
    // the sweep that finds it: list the marker, trash whatever comes back, repeat until the
    // listing is empty. There is nothing left to reconcile by Message-ID; membership under
    // the marker already answers "is this ours" with certainty a search never could.
    const rollback = await sweepRunMarkers(runId, markers, 'trash', createdLabels, (rDone, rTotal) =>
      dropOverlay?.send(IPC.MAIL_DROP_COPY_PROGRESS, {
        phase: 'rollback',
        done: rDone,
        total: rTotal,
      } satisfies MailDropCopyProgress),
    );
    if (settled(rollback)) {
      const remainder = rollback.mailboxes
        .filter((m) => !m.converged || m.refused)
        .map((m) => ({ email: m.email, reason: m.reason ?? m.refused ?? 'niet geconvergeerd' }));
      finishCopyJournal(
        root,
        runId,
        rollback.complete ? 'rolled-back' : 'rolled-back-partial',
        remainder,
      );
    } else {
      notifyLog(`[maildrop] ongedaan maken van run ${runId} nog niet compleet, wordt hervat`);
    }
    return {
      stopped: true,
      mode: 'rollback',
      copied,
      byMailbox,
      rollback,
      ...(warnings.length > 0 ? { warnings } : {}),
    } satisfies MailDropCopyStoppedResult;
  };

  try {
    return await runCopy();
  } finally {
    if (activeRun?.runId === runId) activeRun = null;
  }
}


//===========================
// Orphaned runs
//===========================

/** A run that crashed before ever deciding what to do with its markers, waiting for the
 * mail-drop window to ask the same keep-or-rollback question a live run's stop dialog already
 * asks. A run whose journal already recorded a decision needs none of this -- it is finished
 * silently by resumeOrphanedCopyRuns instead. */
let pendingOrphans: CopyJournalRead[] = [];

/**
 * Finishes one orphaned run's sweep, closing its journal once every mailbox has settled
 *
 * @param root the drop folder
 * @param journal
 * @param mode already decided, either by the run itself before it died or by the user just now
 * @private
 */
async function finishOrphanRun(
  root: string,
  journal: CopyJournalRead,
  mode: CopyStopMode,
): Promise<void> {
  if (journal.markers.length === 0) return; // nothing this app can sweep by label
  const outcome = await sweepRunMarkers(
    journal.runId,
    journal.markers,
    mode === 'keep' ? 'strip' : 'trash',
    journal.created,
  );
  if (!settled(outcome)) {
    notifyLog(
      `[maildrop] hervatte opruiming van run ${journal.runId} nog niet compleet, wordt bij de volgende start opnieuw geprobeerd`,
    );
    return;
  }
  const remainder =
    mode === 'rollback'
      ? outcome.mailboxes
          .filter((m) => !m.converged || m.refused)
          .map((m) => ({ email: m.email, reason: m.reason ?? m.refused ?? 'niet geconvergeerd' }))
      : undefined;
  finishCopyJournal(
    root,
    journal.runId,
    mode === 'keep' ? 'kept' : outcome.complete ? 'rolled-back' : 'rolled-back-partial',
    remainder,
  );
}

/**
 * Resumes every copy run this app never heard the end of
 *
 * Meant to be called once, at app start. sweepMarker is idempotent -- listing an
 * already-empty label costs one call and changes nothing -- so resuming a run that had
 * already half-finished only repeats whatever is still needed, never doubles it. A run whose
 * journal never recorded a decision at all is left pending rather than guessed at: that is
 * the one case this app must still ask the user about.
 */
export async function resumeOrphanedCopyRuns(): Promise<void> {
  const root = mailDropFolder();
  const orphans = findOrphanedRuns(root);
  const stillPending: CopyJournalRead[] = [];
  for (const journal of orphans) {
    if (journal.decidedMode) await finishOrphanRun(root, journal, journal.decidedMode);
    else stillPending.push(journal);
  }
  pendingOrphans = stillPending;
}

/**
 * The next orphaned run the user has to make a keep-or-rollback decision about, if any
 *
 * Asked by the mail-drop window when it opens, the same moment it already asks for an
 * existing-mail scan -- nothing else in this app surfaces on its own.
 *
 * @returns the run and how far it got per mailbox, or null when nothing is waiting
 */
export function pendingOrphanDecision(): {
  runId: CopyRunId;
  byMailbox: { email: string; inserted: number }[];
} | null {
  const journal = pendingOrphans[0];
  if (!journal) return null;
  const byMailbox = new Map<string, number>();
  for (const e of journal.entries) byMailbox.set(e.email, (byMailbox.get(e.email) ?? 0) + 1);
  return {
    runId: journal.runId,
    byMailbox: journal.markers.map((m) => ({ email: m.email, inserted: byMailbox.get(m.email) ?? 0 })),
  };
}

/**
 * Answers a pending orphan decision, sweeping that run's markers with the chosen mode
 *
 * @param runId must be the one pendingOrphanDecision last returned
 * @param mode
 * @returns whether the decision was taken -- false when this run is no longer pending, which a
 *   second click or a stale window can both cause harmlessly
 */
export async function decideOrphanRun(
  runId: CopyRunId,
  mode: CopyStopMode,
): Promise<{ ok: boolean }> {
  const at = pendingOrphans.findIndex((j) => j.runId === runId);
  if (at === -1) return { ok: false };
  const [journal] = pendingOrphans.splice(at, 1);
  const root = mailDropFolder();
  const decisionError = attemptWrite(() => recordCopyJournalDecision(root, runId, mode));
  if (decisionError) notifyLog(`[maildrop] kon de opruimkeuze niet vastleggen: ${decisionError}`);
  await finishOrphanRun(root, journal, mode);
  return { ok: true };
}
