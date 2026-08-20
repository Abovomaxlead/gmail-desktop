// The pure parts of copying a drag to other accounts: preparing the targets and summarising
// the outcome. The inserting is in gmail-api.ts.
//
// Skipped messages are reported apart from `copied` and are not errors — skipping is the
// point.

import { mapLimit } from '../core/concurrency';



//===========================
// Types
//===========================

export interface CopyTarget {
  email: string;
  labelIds: string[];
}

export interface CopyDuplicate {
  email: string;
  labelId: string;
  count: number;
  subjects: string[];
}

export interface CopyResult {
  ok: boolean;
  copied: number;
  skipped: number;
  total: number;
  accounts: CopyAccountResult[];
  error?: string;
  needsConfirm?: boolean;
  duplicates?: CopyDuplicate[];
  newCount?: number;
}

export type CopyMode = 'check' | 'new' | 'all';

export interface CopyAccountResult {
  email: string;
  copied: number;
  skipped: number;
  total: number;
  error?: string;
}

export interface DuplicateHit {
  email: string;
  labelId: string;
  messageId: string;
  subject: string;
}

/** What one scan of a mailbox found: per dragged Message-ID the labels that hold it. A
 * message that is nowhere in the mailbox is in here with an empty list, so a missing key
 * means "not looked up" and never "not there". */
export type MailboxScan = Map<string, string[]>;

/** One label of one mailbox that already holds part of the drag. */
export interface ExistingLabel {
  labelId: string;
  count: number;
}

export interface ExistingInMailbox {
  email: string;
  labels: ExistingLabel[];
  error?: string;
}

/** What the picker is told the moment it opens, before anything is ticked. `scanned` is 0
 * when the drag was too big to look up, which is not the same as finding nothing. */
export interface ExistingResult {
  accounts: ExistingInMailbox[];
  scanned: number;
  serial: number;
  answered: number;
}

/** What one mailbox of a copy came to, for the log. `inserts` holds the milliseconds of every
 * upload that was attempted, so the line can show the spread rather than an average. */
export interface MailboxCopyLog {
  email: string;
  delegated: boolean;
  tokenMs: number;
  inserts: number[];
  copied: number;
  skipped: number;
  failed: number;
}

/** What one mailbox answered. `found` is null when the mailbox could not be asked at all,
 * which the picker must not draw as "holds nothing".
 *
 * `provisional` marks an answer that came out of what the app remembers rather than off
 * Gmail. Good enough to warn with, so the picker draws it; not good enough to decide a copy
 * on, so it is kept out of what the check at Kopieer reuses. */
export interface ScanOutcome {
  email: string;
  found: Array<{ messageId: string; labelIds: string[] }> | null;
  error?: string;
  provisional?: boolean;
}



//===========================
// Constants
//===========================

export const DUPLICATE_SAMPLE = 5;

const BOOKKEEPING_LABELS = new Set([
  'UNREAD',
  'SPAM',
  'TRASH',
  'SENT',
  'DRAFT',
  'CHAT',
  'CATEGORY_PERSONAL',
  'CATEGORY_SOCIAL',
  'CATEGORY_PROMOTIONS',
  'CATEGORY_UPDATES',
  'CATEGORY_FORUMS',
]);


//===========================
// Exported functions
//===========================

/**
 * Groups the saved files by the conversation they came from
 *
 * The copy of a conversation goes in one message at a time: the first insert returns the
 * thread the rest have to be filed under, and without it Gmail hands the reader six loose
 * mails. Different conversations have nothing to do with each other and go alongside.
 *
 * @param files
 * @returns the groups, each in the order of the drag, the groups in first-appearance order;
 *   the index is the file's place in the drag, which is the order the log is written in
 */
export function threadGroups<T extends { file: string; threadId: string }>(
  files: T[],
): Array<Array<{ ref: T; index: number }>> {
  const byKey = new Map<string, Array<{ ref: T; index: number }>>();
  for (const [index, ref] of files.entries()) {
    const key = ref.threadId || ref.file;
    const group = byKey.get(key) ?? [];
    group.push({ ref, index });
    byKey.set(key, group);
  }
  return [...byKey.values()];
}

/**
 * Every question the duplicate scan has to answer
 *
 * A check carries the same fields as a hit, because a hit is a check that came back yes.
 *
 * @param targets
 * @param files the messages the drag saved
 * @returns one check per mailbox, per chosen label, per message, skipping a message without
 *   a Message-ID since nothing can be matched on it
 */
export function duplicateChecks(
  targets: CopyTarget[],
  files: Array<{ messageId: string; subject: string }>,
): DuplicateHit[] {
  const out: DuplicateHit[] = [];
  for (const target of targets) {
    for (const labelId of target.labelIds) {
      for (const file of files) {
        if (!file.messageId.trim()) continue;
        out.push({ email: target.email, labelId, messageId: file.messageId, subject: file.subject });
      }
    }
  }
  return out;
}

/**
 * What the scan taken when the picker opened already says about this check
 *
 * The picker asks which labels hold each message, which is a wider question than "does this
 * label hold it" — so the answer is already there and Gmail does not have to be asked twice.
 *
 * @param scan per mailbox what was found, or null when nothing was scanned
 * @param check
 * @returns {boolean|null} null when this mailbox or this message was not part of the scan
 */
export function scanAnswer(
  scan: Map<string, MailboxScan> | null | undefined,
  check: DuplicateHit,
): boolean | null {
  const labels = scan?.get(check.email)?.get(check.messageId);
  return labels ? labels.includes(check.labelId) : null;
}

/**
 * Builds the lookup of what already exists where
 *
 * @param hits
 * @returns keys of account, label and message together
 */
export function duplicateIndex(hits: DuplicateHit[]): Set<string> {
  return new Set(hits.map((h) => dupKey(h.email, h.labelId, h.messageId)));
}


/**
 * Which of an account's labels this message is not filed under yet
 *
 * @param index
 * @param email
 * @param labelIds the labels chosen for this account
 * @param messageId
 * @returns the labels still to file it under
 */
export function labelsStillNeeded(
  index: Set<string>,
  email: string,
  labelIds: string[],
  messageId: string,
): string[] {
  return labelIds.filter((labelId) => !index.has(dupKey(email, labelId, messageId)));
}

/**
 * How many copies the drag would actually create
 *
 * @param index
 * @param targets
 * @param messageIds
 * @returns the count, skipping what every target already holds
 */
export function newMessageCount(
  index: Set<string>,
  targets: CopyTarget[],
  messageIds: string[],
): number {
  let n = 0;
  for (const t of targets) {
    for (const messageId of messageIds) {
      if (labelsStillNeeded(index, t.email, t.labelIds, messageId).length > 0) n += 1;
    }
  }
  return n;
}

/**
 * Narrows what a message is filed under to the labels the picker offers
 *
 * @param labelIds every label Gmail returned for the message
 * @returns the ones worth showing, in the order they came
 */
export function copyableLabelIds(labelIds: string[]): string[] {
  return labelIds.filter((id) => !BOOKKEEPING_LABELS.has(id));
}

/**
 * Folds the scan into a count per mailbox and label
 *
 * @param hits one per dragged message per label that already holds it
 * @returns one entry per mailbox, its labels in the order they were met
 */
export function countExisting(hits: Array<{ email: string; labelId: string }>): ExistingInMailbox[] {
  const out: ExistingInMailbox[] = [];
  for (const hit of hits) {
    let mailbox = out.find((m) => m.email === hit.email);
    if (!mailbox) {
      mailbox = { email: hit.email, labels: [] };
      out.push(mailbox);
    }
    const label = mailbox.labels.find((l) => l.labelId === hit.labelId);
    if (label) label.count += 1;
    else mailbox.labels.push({ labelId: hit.labelId, count: 1 });
  }
  return out;
}

/**
 * The line the log gets about one mailbox of a copy
 *
 * Split by phase on purpose. A copy into a delegated mailbox and one into an own account take
 * different routes to a token and the same route to an insert, and a single total cannot say
 * which of the two the time went into. The middle and the worst insert rather than an average,
 * because one upload of nine seconds is exactly what an average hides.
 *
 * @param m what one mailbox came to
 * @returns the line, without the `[maildrop]` prefix the caller adds
 */
export function copyLogLine(m: MailboxCopyLog): string {
  const kind = m.delegated ? 'gedelegeerd' : 'eigen';
  const total = m.inserts.reduce((s, ms) => s + ms, 0);
  const spread =
    m.inserts.length > 0
      ? ` (mediaan ${duration(middle(m.inserts))}, traagste ${duration(Math.max(...m.inserts))})`
      : '';
  const counts = [
    `${m.copied} gekopieerd`,
    `${m.skipped} overgeslagen`,
    `${m.failed} mislukt`,
  ].join(', ');
  return (
    `copy ${m.email} (${kind}): token ${duration(m.tokenMs)}, ` +
    `${m.inserts.length} inserts in ${duration(total)}${spread}, ${counts}`
  );
}

/**
 * The line the log gets about the duplicate check
 *
 * @param t what the check came to
 * @returns the line, without the `[maildrop]` prefix the caller adds
 */
export function checkLogLine(t: { checks: number; reused: number; asked: number; ms: number }): string {
  return (
    `dubbelencheck: ${t.checks} vragen, ${t.reused} uit de scan, ` +
    `${t.asked} opnieuw gevraagd, ${duration(t.ms)}`
  );
}

/**
 * How many uploads one mailbox may have in flight
 *
 * The uploads in flight are what bound peak memory and the uplink, and they are shared between
 * the mailboxes being worked. Dividing them is the point: bounding each half separately gave a
 * copy into one mailbox the same narrow limit as one of three, and left that mailbox's own quota
 * unused.
 *
 * @param mailboxes how many are being worked at once
 * @param inFlight the uploads the whole copy may have going
 * @param max the most one mailbox can use, since its own quota caps it anyway
 * @returns the limit for one mailbox, never below one
 */
export function perMailboxLimit(mailboxes: number, inFlight: number, max: number): number {
  return Math.max(1, Math.min(max, Math.floor(inFlight / Math.max(1, mailboxes))));
}

/**
 * Copies one conversation into a mailbox: the first mail alone, then the rest together
 *
 * The mails of one conversation used to go in strictly one at a time, because the first insert
 * returns the thread the others have to be filed under. But only the first one has to be waited
 * for: once the thread is known, the rest all attach to the same one and have nothing to do with
 * each other. A drag of twenty-two rows out of a single conversation was twenty-two uploads in a
 * row, and no amount of concurrency elsewhere touched it.
 *
 * If the first mail lands nowhere -- no thread came back -- the group keeps going in a row. Firing
 * the rest off together with nothing to attach them to would scatter one conversation over as
 * many threads, which is a different result, not a faster one.
 *
 * @param group the mails of one conversation, in the order of the drag
 * @param insert does the upload and answers with the thread it landed in
 * @param limit how many of the rest may be in flight at once
 */
export async function runThreadGroup<T>(
  group: T[],
  insert: (item: T, landedIn?: string) => Promise<{ threadId?: string }>,
  limit: number,
): Promise<void> {
  if (group.length === 0) return;
  const [first, ...rest] = group;
  const landedIn = (await insert(first)).threadId;
  if (rest.length === 0) return;

  if (!landedIn) {
    let carried: string | undefined;
    for (const item of rest) {
      const answer = await insert(item, carried);
      if (!carried && answer.threadId) carried = answer.threadId;
    }
    return;
  }
  await mapLimit(rest, limit, async (item) => {
    await insert(item, landedIn);
  });
}

/**
 * Puts the mailboxes' results back in the order they were picked
 *
 * The mailboxes upload alongside each other now, so the order they finish in is not the order
 * the user chose them in. Everything the outside world sees is assembled here instead: the log
 * lines, the per-mailbox report, and the totals.
 *
 * @param perTarget one entry per mailbox, in the order the mailboxes were picked
 * @returns the log records and the report, both in that same order, and the totals
 */
export function assembleCopy<R>(
  perTarget: Array<{ account: CopyAccountResult; records: R[] }>,
): { records: R[]; accounts: CopyAccountResult[]; copied: number; skipped: number } {
  const records: R[] = [];
  const accounts: CopyAccountResult[] = [];
  let copied = 0;
  let skipped = 0;
  for (const one of perTarget) {
    records.push(...one.records);
    accounts.push(one.account);
    copied += one.account.copied;
    skipped += one.account.skipped;
  }
  return { records, accounts, copied, skipped };
}

/**
 * Folds the mailbox scans that have landed into what the picker draws
 *
 * Called again on every answer, so the warning fills in per mailbox instead of waiting for
 * the slowest one. A mailbox that has not answered is simply not in the result.
 *
 * @param outcomes one per mailbox that answered, in any order
 * @param scanned how many of the dragged messages the scan covers
 * @param serial the drag it belongs to, so an answer that outlived its drop is recognisable
 * @returns what the picker draws, and the per-message labels the check at Kopieer reuses
 */
export function existingSoFar(
  outcomes: ScanOutcome[],
  scanned: number,
  serial = 0,
): { result: ExistingResult; byEmail: Map<string, MailboxScan> } {
  const byEmail = new Map<string, MailboxScan>();
  const hits: Array<{ email: string; labelId: string }> = [];
  const failed: ExistingInMailbox[] = [];
  for (const outcome of outcomes) {
    if (outcome.error) failed.push({ email: outcome.email, labels: [], error: outcome.error });
    if (!outcome.found) continue;
    if (!outcome.provisional) {
      byEmail.set(outcome.email, new Map(outcome.found.map((m) => [m.messageId, m.labelIds])));
    }
    for (const message of outcome.found) {
      for (const labelId of copyableLabelIds(message.labelIds)) {
        hits.push({ email: outcome.email, labelId });
      }
    }
  }
  return {
    result: {
      accounts: [...countExisting(hits), ...failed],
      scanned,
      serial,
      answered: outcomes.length,
    },
    byEmail,
  };
}

/**
 * Groups the duplicate hits per account and label, with a sample of subjects
 *
 * @param hits
 * @param sample how many subjects to keep per group
 * @returns one group per account-and-label, carrying the full count
 */
export function groupDuplicates(
  hits: DuplicateHit[],
  sample = DUPLICATE_SAMPLE,
): CopyDuplicate[] {
  const out: CopyDuplicate[] = [];
  for (const hit of hits) {
    let group = out.find((g) => g.email === hit.email && g.labelId === hit.labelId);
    if (!group) {
      group = { email: hit.email, labelId: hit.labelId, count: 0, subjects: [] };
      out.push(group);
    }
    group.count += 1;
    if (group.subjects.length < sample) group.subjects.push(hit.subject);
  }
  return out;
}


/**
 * Folds the chosen targets into one entry per account
 *
 * @param targets
 * @returns the accounts that have at least one label, their labels deduplicated
 */
export function normalizeTargets(targets: CopyTarget[]): CopyTarget[] {
  const byEmail = new Map<string, string[]>();
  for (const t of targets ?? []) {
    const email = (t?.email ?? '').trim();
    if (!email) continue;
    const labels = byEmail.get(email) ?? [];
    for (const id of t.labelIds ?? []) {
      if (id && !labels.includes(id)) labels.push(id);
    }
    byEmail.set(email, labels);
  }
  return [...byEmail]
    .filter(([, labelIds]) => labelIds.length > 0)
    .map(([email, labelIds]) => ({ email, labelIds }));
}

/**
 * How many copies the drag amounts to in total
 *
 * @param targets
 * @param messageCount
 * @returns one per message per target
 */
export function copyTotal(targets: CopyTarget[], messageCount: number): number {
  return targets.length * messageCount;
}


//===========================
// Helper functions
//===========================

/**
 * The lookup key for one message in one label of one account
 *
 * @param email
 * @param labelId
 * @param messageId
 * @returns the three joined by NUL, which no address or label can contain
 * @private
 */
const dupKey = (email: string, labelId: string, messageId: string) =>
  `${email}\0${labelId}\0${messageId}`;

/**
 * Milliseconds, written the way a person reads them
 *
 * @param ms
 * @returns milliseconds below a second, seconds with one decimal above it
 * @private
 */
function duration(ms: number): string {
  // Rounded to tenths before formatting: toFixed would read 1450ms back as 1.4s, because 1.45
  // has no exact binary form.
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(Math.round(ms / 100) / 10).toFixed(1)}s`;
}

/**
 * The middle value, which unlike an average cannot be pulled by one slow upload
 *
 * @param xs at least one number
 * @returns the median, the lower of the two middles for an even count
 * @private
 */
function middle(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : s[s.length / 2 - 1];
}
