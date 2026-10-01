// What a crash report is, whether this one may go out, and what it says.
//
// Pure, and apart from the sending for the same reason feedback-mail.ts is apart from
// feedback-controller.ts: every decision here is one a test can hold. The decisions are all
// about restraint. A crash that repeats -- and the ones worth fixing always repeat -- must not
// mail the same stack forty times in a minute, because a report nobody can read is the same as
// no report at all, and because the mailbox it lands in is a person's.
//
// So a report carries a fingerprint: the kind, the message with its numbers flattened, and the
// first frame of the stack. Two crashes with the same fingerprint are the same bug, whatever
// their line numbers and ids happen to be. One goes out per fingerprint per DEDUPE_MS, and no
// more than MAX_PER_HOUR in total, whatever their fingerprints.

//===========================
// Types
//===========================

/** Where a crash came from. Every one of these is a place the app fell over rather than a place
 * it reported trouble: an error this app already handles and logs is not a crash. */
export type CrashKind =
  | 'main-exception'
  | 'unhandled-rejection'
  | 'renderer-gone'
  | 'child-gone'
  | 'preload-error'
  | 'window-error';

/** One crash, as much as is known about it. `where` is whatever names the place: a URL, a
 * process type, Electron's own reason string. */
export interface CrashEvent {
  kind: CrashKind;
  message: string;
  stack?: string;
  where?: string;
  /** epoch ms */
  at: number;
}

/** A crash waiting to be mailed. `tries` counts the flushes that failed on it, which is what
 * keeps a report that can never be sent -- a body Gmail refuses, say -- from being retried for
 * the rest of the installation's life. */
export interface QueuedCrash extends CrashEvent {
  id: string;
  fingerprint: string;
  tries: number;
}

/** One report that did go out, kept only to answer "have we sent this one already". */
export interface SentCrash {
  fingerprint: string;
  at: number;
}

/** What the app itself is, which goes under every report so a stack can be read against the
 * build it came out of. */
export interface CrashContext {
  version: string;
  platform: string;
  osRelease: string;
  mailboxCount: number;
}

/** Why a report is not being sent, or that it is. 'duplicate' and 'flooding' are both silence
 * on purpose and are told apart because only one of them means something is very wrong. */
export type SendDecision = 'send' | 'duplicate' | 'flooding';


//===========================
// Constants
//===========================

/** How long one fingerprint stays quiet after a report about it went out. Long enough that a
 * bug which fires on every start reports once a working day, short enough that a fix which did
 * not work is heard about the next morning. */
export const DEDUPE_MS = 6 * 60 * 60 * 1000;

/** The ceiling whatever the fingerprints are, for the crash that mutates its own message --
 * a different id in every line reads as a different bug to any fingerprint. */
export const MAX_PER_HOUR = 5;

const HOUR_MS = 60 * 60 * 1000;

/** How long a sent report is remembered. Twice the dedupe window, so the record that silences a
 * fingerprint always outlives the silence itself. */
export const REMEMBER_MS = 2 * DEDUPE_MS;

/** How many reports may wait for a working connection. Older ones are dropped first: the crash
 * that just happened is the one somebody is still looking at. */
export const QUEUE_MAX = 20;

/** How many flushes may fail on one report before it is given up on. */
export const MAX_TRIES = 5;

/** What of a message goes into the fingerprint. Long enough to tell two errors apart, short
 * enough that a message ending in a different path or id still matches itself. */
const FINGERPRINT_CHARS = 120;


//===========================
// Exported functions
//===========================

/**
 * What makes two crashes the same bug
 *
 * Numbers are flattened to `0`, because a port, a pid, a byte count and a line number all
 * differ between two firings of one bug. Backslashes are normalised so the same stack from a
 * Windows and a POSIX path reads as one.
 *
 * @param event
 * @returns a key that is stable across firings of the same fault
 */
export function fingerprint(event: CrashEvent): string {
  const message = normalize(event.message).slice(0, FINGERPRINT_CHARS);
  return `${event.kind}|${message}|${normalize(firstFrame(event.stack))}`;
}

/**
 * Whether this report may go out now
 *
 * @param sent what has already been reported, newest or oldest first -- order does not matter
 * @param fp the fingerprint of the report being considered
 * @param at epoch ms
 * @returns 'send', or why not
 */
export function sendDecision(sent: SentCrash[], fp: string, at: number): SendDecision {
  const withinHour = sent.filter((s) => at - s.at < HOUR_MS);
  if (sent.some((s) => s.fingerprint === fp && at - s.at < DEDUPE_MS)) return 'duplicate';
  if (withinHour.length >= MAX_PER_HOUR) return 'flooding';
  return 'send';
}

/**
 * The record of what has been sent, with what no longer decides anything dropped
 *
 * @param sent
 * @param at epoch ms
 * @returns a new array, oldest first
 */
export function pruneSent(sent: SentCrash[], at: number): SentCrash[] {
  return sent.filter((s) => at - s.at < REMEMBER_MS).sort((a, b) => a.at - b.at);
}

/**
 * The queue with one crash added, inside its ceiling
 *
 * A crash whose fingerprint is already waiting is not added twice: the queue is what has not
 * been sent yet, and sending the same stack twice from one backlog tells nobody anything.
 *
 * @param queue
 * @param crash
 * @returns a new array, oldest first, at most QUEUE_MAX long
 */
export function enqueueCrash(queue: QueuedCrash[], crash: QueuedCrash): QueuedCrash[] {
  if (queue.some((q) => q.fingerprint === crash.fingerprint)) return queue;
  return [...queue, crash].slice(-QUEUE_MAX);
}

/**
 * The subject line one report gets
 *
 * The kind and the fingerprint's own message are in it, so a mailbox holding a hundred of these
 * sorts into bugs rather than into a wall of identical lines.
 *
 * @param event
 * @param context
 * @returns the subject
 */
export function crashSubject(event: CrashEvent, context: CrashContext): string {
  const head = oneLine(event.message).slice(0, 80) || event.kind;
  return `[crash] ${context.version} ${event.kind}: ${head}`;
}

/**
 * The body of one report
 *
 * English, like the diagnostics block of a feedback mail and for the same reason: it is read by
 * whoever fixes the bug, not by the person it happened to.
 *
 * @param event
 * @param context
 * @returns the text, with the stack under it
 */
export function crashBody(event: CrashEvent, context: CrashContext): string {
  const lines = [
    'This report was sent automatically. Nobody typed it.',
    '',
    `when       ${new Date(event.at).toISOString()}`,
    `kind       ${event.kind}`,
    `version    ${context.version}`,
    `platform   ${context.platform} ${context.osRelease}`,
    `mailboxes  ${context.mailboxCount}`,
    `signature  ${fingerprint(event)}`,
  ];
  if (event.where) lines.push(`where      ${event.where}`);
  lines.push('', 'message', event.message || '(none)');
  if (event.stack) lines.push('', 'stack', event.stack);
  lines.push('', 'The logs are attached, with credentials and mail content masked.');
  return lines.join('\n');
}

/**
 * What one crash is called in the log
 *
 * @param event
 * @param decision
 * @returns one line, short enough for a log that also carries everything else
 */
export function crashLogLine(event: CrashEvent, decision: SendDecision): string {
  const verb = decision === 'send' ? 'queued' : `not sent (${decision})`;
  return `[crash] ${event.kind}: ${oneLine(event.message).slice(0, 160)} — ${verb}`;
}


//===========================
// Helper functions
//===========================

/**
 * The first line of a stack that names code of ours, with the directories dropped
 *
 * The head of a stack is often the message again, and the frames under it are what identify the
 * fault. Node's own internals are skipped: `node:internal/process/task_queues` is where half of
 * everything asynchronous surfaces and identifies nothing.
 *
 * Only the file's own name is kept, because the directory above it is not a property of the
 * bug: it is where this installation happens to sit. A dev checkout, a packaged app and the
 * same app installed under another user's profile would otherwise each read as a bug of their
 * own -- and the whole point of a fingerprint is that one fault has one.
 *
 * @param stack
 * @returns the frame, or an empty string when there is none
 * @private
 */
function firstFrame(stack: string | undefined): string {
  for (const line of (stack ?? '').split('\n')) {
    const text = line.trim();
    if (!text.startsWith('at ')) continue;
    if (text.includes('node:internal')) continue;
    return text.replace(/[^\s(]*[\\/]/g, '');
  }
  return '';
}

/**
 * Text with everything that differs between two firings of one bug taken out
 *
 * @param text
 * @returns the flattened text
 * @private
 */
function normalize(text: string): string {
  return oneLine(text).replace(/\\/g, '/').replace(/\d+/g, '0');
}

/**
 * Text as one line, however many it arrived as
 *
 * @param text
 * @returns the text with its whitespace collapsed
 * @private
 */
function oneLine(text: string): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}
