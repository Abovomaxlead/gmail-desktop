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
import { readFile } from 'node:fs/promises';
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
  copyTotal,
  copyableLabelIds,
  countExisting,
  duplicateChecks,
  duplicateIndex,
  groupDuplicates,
  labelsStillNeeded,
  newMessageCount,
  normalizeTargets,
  scanAnswer,
  threadGroups,
  type CopyMode,
  type DuplicateHit,
  type ExistingInMailbox,
  type ExistingResult,
  type MailboxScan,
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
import { NO_SUBJECT, dropOutcome, type MessageRef } from './dropzone';
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

//===========================
// Types
//===========================

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


//===========================
// Exported functions
//===========================

export function mailDropFolder(): string {
  return prefs?.getAll().mailDrop.folder || join(app.getPath('documents'), 'Gmail Desktop', 'Mail');
}

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
  messageUnknown = false,
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

  const viaApi = await threadMessagesViaApi(account, threadId);

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

const DUPLICATE_CHECK_LIMIT = 8;

async function findDuplicates(
  targets: MailDropCopyTarget[],
  saved: SavedRef[],
  onProgress: (done: number, total: number, email: string) => void,
): Promise<DuplicateHit[]> {
  const checks = duplicateChecks(targets, saved);

  // The scan behind the picker asked the wider question — which labels hold this message —
  // so most of these are already answered. What it did not cover, because the mailbox
  // refused or the drag was too big to scan, is still asked here.
  const scan = lastExisting?.serial === dropSerial ? lastExisting.byEmail : null;
  const answers = checks.map((check) => scanAnswer(scan, check));
  const open = checks.filter((_, i) => answers[i] === null);

  let done = checks.length - open.length;
  if (open.length > 0) {
    const tokens = new Map<string, string>();
    for (const email of new Set(open.map((c) => c.email))) {
      const got = await mailboxToken(email);
      if (got.ok) tokens.set(email, got.token);
    }

    const asked = await mapLimit(open, DUPLICATE_CHECK_LIMIT, async (check) => {
      const token = tokens.get(check.email);
      let exists = false;
      if (token) {
        try {
          exists = await messageExistsInLabel(token, check.messageId, check.labelId);
        } catch {
        }
      }
      onProgress((done += 1), checks.length, check.email);
      return exists;
    });

    let at = 0;
    for (const [i, answer] of answers.entries()) if (answer === null) answers[i] = asked[at++];
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
  label: string,
  authuser: string,
  ik: string,
): Promise<{ items: MailDropPreviewItem[]; saved: SavedRef[]; rows: number[] }> {
  const empty = () => {
    const error = `Geen mail gevonden in label "${label}"`;
    try {
      appendLog(root, [{ ts, account, threadId: '', label, error }]);
    } catch {
    }
    return { items: [{ threadId: '', subject: label, saved: 0, error }], saved: [], rows: [] };
  };

  const viaApi = await collectLabelViaApi(account, label);
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
const DRAG_THREAD_LIMIT = 4;

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
    const { items: done, saved: refs, rows } = await saveLabel(
      ts,
      account,
      root,
      payload.label,
      payload.authuser,
      payload.ik,
    );
    lastDropSaved = refs;
    // rows rather than the display items: those carry the truncation notice too, which is
    // not a conversation that failed to save.
    manager?.sendDropResult(acctKey, dropOutcome(rows, done.find((i) => i.error)?.error));
    openDropPreview(done);
    return;
  }

  // Side by side rather than one after the other: ten dragged mails were ten conversations
  // waiting on each other, which is minutes on a normal mailbox. mapLimit answers in the
  // order the rows were dragged, so the preview strip, the numbering and log.jsonl read the
  // same as when this was a loop.
  const results = await mapLimit(items, DRAG_THREAD_LIMIT, (item) =>
    saveOneThread(
      ts,
      account,
      root,
      item.threadId,
      payload.authuser,
      payload.ik,
      item.message ?? null,
      item.messageUnknown ?? false,
    ),
  );

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

const EXISTING_SCAN_LIMIT = 10;

const EXISTING_SCAN_CONCURRENCY = 4;

// Per mailbox, so times EXISTING_SCAN_CONCURRENCY for what is in flight while the picker opens
const EXISTING_MESSAGE_CONCURRENCY = 2;

/** Where the last drag's mail already sits, asked the moment the picker opens.
 *
 * The warning before the choice rather than after it: the check at Kopieer only looks at
 * labels already ticked, so "already there, under another label" arrived too late.
 *
 * One search per mailbox per message rather than one per label — the same two requests
 * whether the mailbox has four labels or four hundred. */
export async function existingForCopyTargets(): Promise<ExistingResult> {
  const files = lastDropSaved.filter((f) => f.messageId.trim());
  const targetable = copyTargetEmails(profiles, lastDropSource);
  if (files.length === 0 || files.length > EXISTING_SCAN_LIMIT || targetable.length === 0) {
    return { accounts: [], scanned: 0 };
  }

  const scans = await mapLimit(targetable, EXISTING_SCAN_CONCURRENCY, async (email) => {
    const got = await mailboxToken(email);

    if (!got.ok) return { email, found: null };
    try {
      const found = await mapLimit(files, EXISTING_MESSAGE_CONCURRENCY, async (ref) => ({
        messageId: ref.messageId,
        labelIds: await labelsHoldingMessage(got.token, ref.messageId),
      }));
      return { email, found };
    } catch (e) {

      console.warn(`[maildrop] kon ${email} niet controleren op dubbelen:`, e);
      return { email, found: null, error: 'Kon niet controleren' };
    }
  });

  // Kept before it is folded into counts: the check at Kopieer needs to know which message
  // sits under which label, and the counts no longer say.
  const byEmail = new Map<string, MailboxScan>();
  const hits: Array<{ email: string; labelId: string }> = [];
  const failed: ExistingInMailbox[] = [];
  for (const scan of scans) {
    if (scan.error) failed.push({ email: scan.email, labels: [], error: scan.error });
    if (!scan.found) continue;
    byEmail.set(scan.email, new Map(scan.found.map((m) => [m.messageId, m.labelIds])));
    for (const message of scan.found) {
      for (const labelId of copyableLabelIds(message.labelIds)) {
        hits.push({ email: scan.email, labelId });
      }
    }
  }
  lastExisting = { serial: dropSerial, byEmail };
  return { accounts: [...countExisting(hits), ...failed], scanned: files.length };
}

// How many mails go into one mailbox at once. An insert costs 25 of the 250 quota units a
// user gets per second, so ten a second is the ceiling; four in flight stays under it and
// fills a normal uplink, which is the real limit on a mail with attachments.
const COPY_LIMIT = 4;

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

  await mapLimit(threadGroups(files), COPY_LIMIT, async (group) => {
    let landedIn: string | undefined;
    for (const { ref, index: at } of group) {
      const { outcome, threadId } = await copyOneFile({
        ts,
        target,
        ref,
        index,
        landedIn,
        token: () => token,
        freshToken,
      });
      if (!landedIn && threadId) landedIn = threadId;
      outcomes[at] = outcome;
      onDone();
    }
  });
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
}): Promise<{ outcome: CopyOutcome; threadId?: string }> {
  const { ts, target, ref, index, landedIn } = arg;
  const { file, messageId } = ref;

  const labelIds = labelsStillNeeded(index, target.email, target.labelIds, messageId);
  if (labelIds.length === 0) return { outcome: { skipped: true } };

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
    };
  } catch (e) {
    const error = (e as Error).message;
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
    };
  }
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

    const got = await mailboxToken(target.email);
    if (!got.ok) {
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
    const outcomes = await copyToMailbox({
      cfg,
      tokens: oauthTokens,
      ts,
      target,
      token: got.token,
      files,
      index,
      onDone: () => {
        done += 1;
        progress('copy', target.email);
      },
    });

    // In the order of the drag rather than the order the uploads finished, so log.jsonl and
    // the error the strip shows read the same as when this ran one mail at a time.
    let ok = 0;
    let over = 0;
    let lastError: string | undefined;
    for (const outcome of outcomes) {
      if (!outcome) continue;
      if (outcome.copied) ok += 1;
      if (outcome.skipped) over += 1;
      if (outcome.error) lastError = outcome.error;
      if (outcome.record) records.push(outcome.record);
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
