// Collecting mail onto disk: one dragged conversation, or a whole label's tree.
//
// Two routes reach the same list and do not find the same messages. The API lists every
// message in a thread; the page route can only save what Gmail's "show original" page links
// to, and a long conversation arrives there collapsed. The API goes first for that reason,
// and the page is what is left when a mailbox has no token.
//
// One mail leaves per drag: the last message quotes the ones before it, which is the whole
// reason a thread gets dragged. Fetching them all is how the newest is known to be newest.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { session } from 'electron';
import type { MailDropPreviewItem } from '../../core/ipc';
import { SESSION_PARTITION } from '../../core/session-partition';
import { manager } from '../../core/runtime';
import { mapLimit, memoise } from '../../core/concurrency';
import { isDelegatedMailbox, withMailboxToken } from '../../auth/mailbox-token';
import { notifyLog } from '../../notify/notify-log';
import {
  fetchThreadMessages,
  fetchThreadRaw,
  fetchUserLabelMap,
  listLabelThreadIds,
  type ThreadMessage,
} from '../../gmail/gmail-api';
import { htmlToText, parseHeaders } from '../shared/eml';
import {
  appendLog,
  draggedMessage,
  newestMessage,
  writeLabel,
  writeThread,
  type LogRecord,
  type SavedMessage,
} from './mail-archive';
import { fetchThreadEmls } from './mail-fetch';
import { attemptWrite } from '../copy/copy-journal';
import {
  API_MAX_THREADS,
  LABEL_SCRAPE_JS,
  MAX_PAGES,
  PAGE_SIZE,
  SCRAPE_MAX_THREADS,
  SIDEBAR_LABEL_SCRAPE_JS,
  labelListUrl,
  labelNamesFromHrefs,
  mergeTreeThreads,
  scrapeSettled,
  type LabelThread,
  type TreeThread,
} from '../drag/label-drop';
import { labelTreeMembers } from '../copy/label-tree';
import { NO_SUBJECT, type MessageRef } from '../drag/dropzone';
import { activePull, lastDropTree, setLastDropTree, type SavedRef } from '../drop-state';


//===========================
// Types
//===========================

/** Told how far a pull has got, in conversations. A total of nothing means the label is
 * still being listed. */
export type SaveProgress = (done: number, total: number) => void;

/** What a label's tree resolved to, whether scraped or listed over the API: every conversation
 * found, the members the tree carries and the order they were resolved in, and whether the
 * count hit its cap. */
export interface LabelTreeListing {
  threads: TreeThread[];
  members: string[];
  capped: boolean;
  cap: number;
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
export type ThreadReadCache = Map<string, Promise<ThreadRead>>;

export interface CollectedThread {
  thread: TreeThread;
  messages: SavedMessage[];
  error?: string;
}


//===========================
// Constants
//===========================

// How many dragged conversations are fetched at once. The messages inside each dragged
// conversation are fetched alongside each other too, under MESSAGE_FETCH_LIMIT (gmail-api.ts),
// so one label is up to six times that many requests in flight. What keeps the rate inside
// Gmail's allowance is the budget in quota.ts rather than this number; this one bounds how much
// of a label is in memory at once.
const THREAD_FETCH_LIMIT = 4;


//===========================
// Exported functions
//===========================

/**
 * Reads one conversation over the API and parses it, once per drag
 *
 * @param cache the drag's cache
 * @param email the mailbox
 * @param threadId
 * @returns the fetch result, and the parsed messages when the API had them
 */
export function readThread(cache: ThreadReadCache, email: string, threadId: string): Promise<ThreadRead> {
  return memoise(cache, threadId, async () => {
    const api = await threadMessagesViaApi(email, threadId);
    if (api.kind !== 'messages') return { api, parsed: null };
    const all: SavedMessage[] = [];
    const errors: Array<string | undefined> = [];
    for (const m of api.messages) {
      if (m.raw) {
        all.push({
          raw: m.raw,
          headers: parseHeaders(m.raw.toString('utf8')),
          id: m.id,
          unread: m.unread,
        });
      } else {
        errors.push(m.error);
      }
    }
    return { api, parsed: { all, errors } };
  });
}

export async function saveOneThread(
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
    const logError = attemptWrite(() => appendLog(root, [{ ts, account, threadId, error }]));
    if (logError) notifyLog(`[maildrop] archive log not appended: ${logError}`);
    return { count: 0, error: withLogTrouble(error, logError), saved: [] };
  };

  // Before the fetch, since there is nothing to choose from once it lands: the newest
  // message stands in for a whole conversation, never for a row that named one and was not
  // read. Saying so beats saving the wrong mail, and "2 van 3 opgeslagen" is what the strip
  // then shows.
  if (messageUnknown) {
    notifyLog(`[maildrop] ${threadId}: row refused, its message could not be read`);
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
        session.fromPartition(SESSION_PARTITION),
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
    const explanation = htmlToText(pageHtml.html).replace(/\s+/g, ' ').trim();
    const shortAndClear = explanation.length > 0 && explanation.length <= 300;
    if (!shortAndClear) {
      const dump = join(root, `diagnose-om-${threadId}.html`);
      let kept = true;
      try {
        mkdirSync(root, { recursive: true });
        writeFileSync(dump, pageHtml.html, 'utf8');
      } catch {
        // The dump is a diagnostic aid, so a folder that refuses it must not replace Gmail's own
        // failure -- but the line below may then not claim the page was kept
        kept = false;
      }
      return failed(
        `Geen origineel gevonden (HTTP ${pageHtml.status}, ${pageHtml.html.length} tekens${
          kept ? ` — pagina bewaard als ${dump}` : ''
        })`,
      );
    }
    return failed(`Gmail: ${explanation}`);
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
      `[maildrop] ${threadId}: dragged message not found in the conversation (${all.length} fetched)`,
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
      `[maildrop] ${threadId}: ${all.length} messages, only ${dragged ? 'the dragged one' : 'the last one'} kept (${which})`,
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
  const logError = attemptWrite(() => appendLog(root, [...records, ...failedRecords]));
  if (logError) notifyLog(`[maildrop] archive log not appended: ${logError}`);
  return {
    count: ok.length,
    saved: savedRefs(root, files, ok, threadId),
    ...(logError ? { error: `Logboek niet bijgeschreven: ${logError}` } : {}),
  };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function collectLabelThreads(
  authuser: string,
  label: string,
): Promise<LabelTreeListing> {
  const threads: TreeThread[] = [];
  let capped = false;
  let members: string[] = [label];
  if (!manager) return { threads, members, capped, cap: SCRAPE_MAX_THREADS };

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
            `[maildrop] label "${member}" page ${page}: list would not settle, took ${pageThreads.length} rows`,
          );
        }
        firstOfPrevious = pageThreads[0].threadId;

        const { added, total } = mergeTreeThreads(threads, member, pageThreads);
        if (total >= SCRAPE_MAX_THREADS) {
          capped = pageThreads.length >= PAGE_SIZE;
          break;
        }
        if (added === 0) break;
      }
      if (capped) break;
    }
  });
  return { threads, members, capped, cap: SCRAPE_MAX_THREADS };
}

/**
 * Lists every conversation of a dragged label's tree, without fetching any of them
 *
 * The cheap half of a label drag, and the half a batched job needs on its own: one
 * `threads.list` page is 500 ids for 10 units, so a tree of ten thousand is twenty pages and two
 * hundred units -- under a second of the budget, against the minutes fetching them costs. That
 * is what lets a plan know which conversations it is going to pull before it pulls one.
 *
 * The walk is gated and counted per page. It used to be neither: a label of thousands is
 * hundreds of pages waiting on each other, and for the whole of it the strip said "Mail zoeken…"
 * and Annuleren did nothing, because the gate was only looked at once the listing had finished
 * on its own. Both drops of 2026-09-01 06:29 were killed with the app rather than cancelled.
 *
 * @param account the mailbox the label was dragged out of
 * @param label the dragged label, whose tree is resolved from the mailbox's own label map
 * @param found called with the running count as the pages land, for the strip
 * @returns the conversations with the tree labels each of them carries, the members in the
 *   order the tree resolved them, and whether the cap bit -- or null when this mailbox has no
 *   usable token or does not have the label, which is the caller's signal to scrape instead
 */
export async function listLabelTree(
  account: string,
  label: string,
  found: (count: number) => void = () => {},
): Promise<LabelTreeListing | null> {
  if (!account) return null;
  const withToken = await withMailboxToken(account);
  if (!withToken) return null;

  const threads: TreeThread[] = [];
  let capped = false;
  let stopped = false;
  const started = Date.now();
  try {
    const all = await withToken((token) => fetchUserLabelMap(token));
    const members = labelTreeMembers([...all.keys()], label);
    if (members.length === 0) return null;
    // One listing per member, folded into one accumulator: the cap counts the tree, and a
    // conversation in two of its labels is one conversation carrying both.
    for (const member of members) {
      const labelId = all.get(member);
      if (!labelId) continue;
      const list = await withToken((token) =>
        // The members before this one are already counted, so the strip reads as one walk over
        // the tree rather than restarting per sublabel. Answering false is what a cancel comes
        // out as: mid-walk rather than after the last page of the last member.
        listLabelThreadIds(token, labelId, API_MAX_THREADS, (soFar) => {
          found(threads.length + soFar);
          return !activePull?.stopped();
        }),
      );
      const page = list.threadIds.map((threadId) => ({ threadId, subject: '' }));
      const { total } = mergeTreeThreads(threads, member, page, API_MAX_THREADS);
      capped = capped || list.capped;
      if (list.stopped) {
        stopped = true;
        break;
      }
      if (total >= API_MAX_THREADS) {
        capped = true;
        break;
      }
    }
    // Not on a walk that was called off: the caller logs that cancel itself, and a second line
    // saying the label was listed would read as a listing that finished.
    if (!stopped) {
      notifyLog(
        `[maildrop] label "${label}" listed: ${threads.length} conversations in ` +
          `${members.length} label(s), ${Math.round((Date.now() - started) / 100) / 10}s` +
          `${capped ? ' (truncated)' : ''}`,
      );
    }
    return { threads, members, capped, cap: API_MAX_THREADS };
  } catch (e) {
    // Named rather than swallowed. This catch is what sends the drag to the scrape, and a log
    // with nothing in it for the two minutes before a kill is what made this bug guesswork.
    notifyLog(`[maildrop] label "${label}" could not be listed over the API: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Fetches the mail of conversations already listed
 *
 * @param account
 * @param slice the conversations to fetch, which for a job is one batch of the plan and for an
 *   ordinary drag is everything listLabelTree answered
 * @param report moved on per conversation, in a finally, so one that could not be fetched still
 *   advances the count -- a counter that stops on a failure reads as a pull that hung
 * @returns one entry per conversation in `slice`, or null when the mailbox has no usable token
 */
export async function fetchThreadSlice(
  account: string,
  slice: TreeThread[],
  report: SaveProgress,
): Promise<CollectedThread[] | null> {
  const withToken = await withMailboxToken(account);
  if (!withToken) return null;

  let pulled = 0;
  report(0, slice.length);
  // The gate of the pull that holds the lock, read here rather than threaded through saveLabel:
  // activePull IS this pull, since the lock admits one. mapLimit answers 'stop' to every worker
  // once it is stopped, so the loop leaves off where it stands.
  const collected = await mapLimit(slice, THREAD_FETCH_LIMIT, async (thread): Promise<CollectedThread> => {
    const { threadId } = thread;
    try {
      const raws = await withToken((token) => fetchThreadRaw(token, threadId));
      const messages: SavedMessage[] = raws.map(({ raw, unread }) => ({
        raw,
        headers: parseHeaders(raw.toString('utf8')),
        unread,
      }));
      return {
        thread: { ...thread, subject: messages[0]?.headers.subject || NO_SUBJECT },
        messages,
        error: messages.length === 0 ? 'Geen bericht in dit gesprek' : undefined,
      };
    } catch (e) {
      return {
        thread,
        messages: [],
        error: `Ophalen mislukt (${(e as Error).message})`,
      };
    } finally {
      pulled += 1;
      report(pulled, slice.length);
    }
  }, activePull?.wait);
  // mapLimit's signature promises R[], but a stop leaves the slot of every item it kept from
  // starting untouched, so the holes are real at runtime even though the type cannot show them.
  // Dropped rather than handed on, since a conversation that never started is not one that failed.
  return collected.filter((c) => c !== undefined);
}

export async function saveLabel(
  ts: string,
  account: string,
  root: string,
  label: string,
  authuser: string,
  ik: string,
  report: SaveProgress,
  /** What listLabelTree already answered for this drag, handed in rather than asked for again.
   * The caller has to list before it can decide whether this label needs a plan at all, and
   * listing twice would double the threads.list pages of every ordinary label drag. Null for a
   * job's later batch, which has no fresh listing and does not need one. */
  listed: LabelTreeListing | null,
  /** One batch of a job's plan, or null for an ordinary drag, which fetches everything the
   * listing above answered. Null is what keeps a label that fits in one batch byte-for-byte
   * today's drag. */
  slice: TreeThread[] | null,
): Promise<{ items: MailDropPreviewItem[]; saved: SavedRef[]; rows: number[]; threads: TreeThread[] }> {
  const empty = () => {
    const error = `Geen mail gevonden in label "${label}"`;
    const logError = attemptWrite(() => appendLog(root, [{ ts, account, threadId: '', label, error }]));
    if (logError) notifyLog(`[maildrop] archive log not appended: ${logError}`);
    return {
      items: [{ threadId: '', subject: label, saved: 0, error: withLogTrouble(error, logError) }],
      saved: [],
      rows: [],
      threads: [],
    };
  };

  const toFetch = slice ?? listed?.threads ?? null;
  const fetched = toFetch === null ? null : await fetchThreadSlice(account, toFetch, report);
  // A job's batch owns one slice of the label and the page route below can only read a label
  // whole, so a batch whose token has gone is a failed batch rather than a pull of everything.
  if (slice && fetched === null) {
    const error = `Geen toegang tot het postvak van deze batch (${account})`;
    const logError = attemptWrite(() => appendLog(root, [{ ts, account, threadId: '', label, error }]));
    if (logError) notifyLog(`[maildrop] archive log not appended: ${logError}`);
    notifyLog(`[maildrop] batch of label "${label}" failed: no usable token for ${account}`);
    return {
      items: [{ threadId: '', subject: label, saved: 0, error: withLogTrouble(error, logError) }],
      saved: [],
      rows: [],
      threads: [],
    };
  }
  const viaApi =
    fetched === null
      ? null
      : {
          collected: fetched,
          members: listed?.members ?? lastDropTree?.members.map((m) => m.name) ?? [label],
          capped: listed?.capped ?? false,
          cap: listed?.cap ?? API_MAX_THREADS,
        };
  let collected: CollectedThread[];
  let capped: boolean;
  let members: string[];
  // Carried from whichever collector answered rather than read off a constant: both paths reach
  // the same two truncation messages, and they stop at wildly different numbers.
  let cap: number;

  if (viaApi) {
    notifyLog(
      `[maildrop] label "${label}" over the API: ${viaApi.members.length} label(s), ${viaApi.collected.length} conversations`,
    );
    if (viaApi.collected.length === 0) return empty();
    collected = viaApi.collected;
    capped = viaApi.capped;
    members = viaApi.members;
    cap = viaApi.cap;
  } else {
    // Only ever a pull that owns the whole label. A batch is refused above precisely because
    // this path ignores `slice` and would fetch every conversation of the label instead.
    if (slice) throw new Error('interne fout: een batch mag nooit van de pagina worden gelezen');
    const scraped = await collectLabelThreads(authuser, label);
    notifyLog(
      `[maildrop] label "${label}" read from the page: ${scraped.members.length} label(s), ${scraped.threads.length} conversations`,
    );
    if (scraped.threads.length === 0) return empty();
    capped = scraped.capped;
    members = scraped.members;
    cap = scraped.cap;
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
          const explanation = htmlToText(result.page.html).replace(/\s+/g, ' ').trim();
          collected.push({
            thread,
            messages: [],
            error:
              explanation && explanation.length <= 300
                ? `Gmail: ${explanation}`
                : 'Geen origineel gevonden',
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

  const extra: LogRecord[] = capped
    ? [{ ts, account, threadId: '', label, error: `Afgekapt op ${cap} gesprekken; het label bevat er meer` }]
    : [];
  const { items, saved, logError, wrote } = await writeCollected(ts, account, root, label, collected, extra);
  // Every row is a failed one here, so each keeps its conversation for the retry
  if (!wrote) return { items, saved, rows: collected.map(() => 0), threads: collected.map((c) => c.thread) };

  if (capped) {
    items.push({
      threadId: '',
      subject: `Afgekapt op ${cap} gesprekken`,
      saved: 0,
      error: 'Het label bevat meer mail dan in één sleep wordt opgehaald',
    });
  }
  // Carried to the strip and the list rather than swallowed: log.jsonl is the only record of
  // what was ever saved, and a label drag onto an offline share used to report nothing at all.
  if (logError) {
    items.push({
      threadId: '',
      subject: 'Niet in het logboek gezet',
      saved: 0,
      error: `Logboek niet bijgeschreven: ${logError}`,
    });
  }
  setLastDropTree({ dragged: label, members: memberCounts(members, collected) });
  return {
    items,
    saved,
    rows: collected.map((c) => c.messages.length),
    threads: collected.map((c) => c.thread),
  };
}

/**
 * Writes collected conversations to disk and the log, one mail per conversation
 *
 * @param ts
 * @param account
 * @param root
 * @param label
 * @param collected
 * @param extra log records written after the conversations', in the same append
 * @returns the rows and saved files, and `wrote: false` when nothing could be written
 */
export async function writeCollected(
  ts: string,
  account: string,
  root: string,
  label: string,
  collected: CollectedThread[],
  extra: LogRecord[],
): Promise<{ items: MailDropPreviewItem[]; saved: SavedRef[]; logError: string | null; wrote: boolean }> {
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
      logError: null,
      wrote: false,
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
  records.push(...extra);
  const logError = attemptWrite(() => appendLog(root, records));
  if (logError) notifyLog(`[maildrop] archive log not appended: ${logError}`);

  const items = collected.map((c) => ({
    threadId: c.thread.threadId,
    subject: c.thread.subject,
    saved: c.messages.length,
    error: c.error,
  }));
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
  return { items, saved, logError, wrote: true };
}

/**
 * One drop error with the archive write that also failed folded into it
 *
 * log.jsonl is the only record of what was ever saved and this share has dropped an appended
 * write before, so a failure is reported rather than swallowed. A row that already failed has no
 * second field to carry it, so it rides along in the same line.
 *
 * @param error what the row itself failed on
 * @param logError what the archive write answered, or null when it went through
 * @returns {string} the line the strip and the picker show
 */
export function withLogTrouble(error: string, logError: string | null): string {
  return logError ? `${error} (logboek niet bijgeschreven: ${logError})` : error;
}

//===========================
// Helper functions
//===========================

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
    unread: m.unread === true,
  }));
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

async function threadMessagesViaApi(email: string, threadId: string): Promise<ApiThreadResult> {
  if (!email) return { kind: 'no-route' };
  const withToken = await withMailboxToken(email);
  if (!withToken) return { kind: 'no-route' };
  try {
    return { kind: 'messages', messages: await withToken((token) => fetchThreadMessages(token, threadId)) };
  } catch (e) {
    const error = (e as Error).message || 'onbekende fout';
    console.warn(`[maildrop] API fetch failed for ${email} ${threadId}:`, e);
    return { kind: 'failed', error };
  }
}
