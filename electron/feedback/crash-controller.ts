// Sending a crash report without anybody asking for one.
//
// The premise: a crash that nobody reports is a crash nobody fixes, and almost nobody reports
// one. The feedback panel needs a person to notice, describe and press send; a crash report
// needs the app to notice, and the app is the only witness anyway.
//
// So every place this process can fall over is hooked, and what comes out is mailed from the
// mailbox the user is signed in to -- gmail.send, see google-oauth.ts -- with the logs
// attached. Nothing is asked, nothing is clicked, and nothing is shown: who receives the report
// is not the user's problem, and a card about a mail they did not send tells them nothing they
// can act on.
//
// What they do get is the failure itself, where it happened: a mail view whose process died says
// so in that view (windows/profile-view-manager.ts, view-crash-page.ts), a drag that failed says
// so in the drag panel. This module is the reporting half and owns none of that.
//
// Three properties matter more than the sending itself:
//
// - Restraint. A crash loop must not mail forty copies of one stack. crash-report.ts owns that
//   decision; one fingerprint per six hours, five reports per hour at the very most.
// - Survival. A crash without a network, or before an account is linked, is exactly the crash
//   worth having: it waits in a file in userData and goes out at the next start.
// - Silence on failure. Nothing in here may ever raise anything. A crash reporter that throws
//   while reporting a crash takes the app down with it, and every hook here runs at a moment
//   where that would be the last thing the user sees.

import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { release } from 'node:os';
import { join } from 'node:path';
import { hasScopes } from '../auth/google-oauth';
import { withTokenFor } from '../auth/mailbox-token';
import { readJsonFile, writeJsonFile } from '../core/json-store';
import { oauthTokens, profiles } from '../core/runtime';
import { sendRawMessage } from '../gmail/gmail-api';
import { notifyLog } from '../notify/notify-log';
import { mailDropFolder } from '../mail/pull/pull-controller';
import { dropLogTail } from './drop-log';
import { redactedLogs } from './app-logs';
import { buildRawMail } from './crash-mail';
import { FEEDBACK_TO } from './feedback-mail';
import {
  MAX_TRIES,
  childGoneDecision,
  crashBody,
  crashLogLine,
  crashSubject,
  enqueueCrash,
  fingerprint,
  pruneSent,
  sendDecision,
  type CrashContext,
  type CrashEvent,
  type QueuedCrash,
  type SentCrash,
} from './crash-report';


//===========================
// Types
//===========================

/** What survives a restart: what is still to be sent, and what has been, so a crash that fires
 * on every start does not mail on every start. */
interface CrashFile {
  queue: QueuedCrash[];
  sent: SentCrash[];
}


//===========================
// Constants
//===========================

const STORE_NAME = 'crash-reports.json';

/** How much of each log rides along. notify.log caps itself at 512 KB and the mail may be
 * 25 MB, so this is not about the ceiling -- it is about a report staying readable. */
const LOG_ATTACH_MAX = 256 * 1024;

/** How long after a report the queue is looked at again, for the crash that happened with no
 * network. Five minutes, because the flush costs one Gmail call and only when it has something
 * to send. */
const FLUSH_EVERY_MS = 5 * 60 * 1000;

/** How long a new report waits before its flush, so a burst of three in one second goes out as
 * three mails from one pass rather than racing each other for the same queue file. */
const FLUSH_DEBOUNCE_MS = 3000;

/** How many go out in one pass. A backlog is drained over several passes so a machine that was
 * offline for a week does not send twenty mails in one second. */
const PER_FLUSH = 3;


//===========================
// Module state
//===========================

let installed = false;

let flushing = false;

let flushTimer: NodeJS.Timeout | null = null;

/** When the GPU process went, for this run of the app only. Deliberately not on disk: a machine
 * that loses its GPU process once a week is a machine nothing is wrong with, and the streak that
 * is worth a report happens inside one session. */
let gpuGone: number[] = [];


//===========================
// Exported functions
//===========================

/**
 * Hooks every place this process can fall over
 *
 * Called before the app is ready, so a crash during startup -- the ones that leave a user with
 * a window that never appears -- is caught too. The queue is not flushed here: there is no
 * token store yet at that point. main.ts flushes once the window exists.
 */
export function installCrashReporting(): void {
  if (installed) return;
  installed = true;

  // Kept alive on purpose. Without a handler Node takes the process down, which for a mail
  // client means the window vanishing over a stray rejection in some background sweep -- see
  // the note in menus/context-menu.ts, where a clipboard held open by another app could do
  // exactly that. The report says what happened; the user keeps their app.
  process.on('uncaughtException', (error) => {
    reportCrash({
      kind: 'main-exception',
      message: String((error as Error)?.message ?? error),
      stack: (error as Error)?.stack,
      at: Date.now(),
    });
  });
  process.on('unhandledRejection', (reason) => {
    reportCrash({
      kind: 'unhandled-rejection',
      message: String((reason as Error)?.message ?? reason),
      stack: (reason as Error)?.stack,
      at: Date.now(),
    });
  });

  app.on('render-process-gone', (_e, contents, details) => {
    // A page the user closed is not a crash: Electron reports that as 'clean-exit'.
    if (details.reason === 'clean-exit') return;
    reportCrash({
      kind: 'renderer-gone',
      message: `a page's process is gone: ${details.reason} (exit ${details.exitCode})`,
      where: safeUrl(contents),
      at: Date.now(),
    });
  });
  app.on('child-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    const at = Date.now();
    const decision = childGoneDecision({ type: details.type, recent: gpuGone, at });
    if (details.type === 'GPU') gpuGone = decision.recent;
    const what = `a ${details.type} process is gone: ${details.reason} (exit ${details.exitCode})`;
    if (!decision.report) {
      // Logged and not mailed: Chromium starts another one and the window keeps painting, so
      // there is nothing for anybody to do -- but the line is what makes the report that does
      // go out readable, since it says how long this had been going on.
      notifyLog(`[crash] ${what}; Chromium will start another (${decision.streak} in a row)`);
      return;
    }
    reportCrash({
      kind: 'child-gone',
      message:
        details.type === 'GPU'
          ? `the GPU process has gone ${decision.streak} times in a row: ${details.reason} (exit ${details.exitCode})`
          : what,
      where: details.name ?? details.serviceName,
      detail: details.type === 'GPU' ? gpuSummary() : undefined,
      at,
    });
  });
  app.on('web-contents-created', (_e, contents) => {
    contents.on('preload-error', (_event, preloadPath, error) => {
      reportCrash({
        kind: 'preload-error',
        message: String(error?.message ?? error),
        stack: error?.stack,
        where: preloadPath,
        at: Date.now(),
      });
    });
  });
}

/**
 * Takes one crash, decides whether it may be reported, and queues it if so
 *
 * The one entry point: the hooks above and the app's own pages (via IPC, see
 * core/ipc-handlers.ts) all arrive here.
 *
 * @param event what fell over
 */
export function reportCrash(event: CrashEvent): void {
  try {
    const fp = fingerprint(event);
    const file = read();
    const decision = sendDecision(file.sent, fp, event.at);
    notifyLog(crashLogLine(event, decision));
    if (decision !== 'send') return;
    // Written as sent the moment it is queued rather than once it has left: the queue is
    // retried, and a crash loop must be silenced by the first firing rather than by the first
    // one that reached Gmail. A machine with no network would otherwise queue nothing but
    // still report the same stack every six hours forever.
    write({
      queue: enqueueCrash(file.queue, { ...event, id: randomUUID(), fingerprint: fp, tries: 0 }),
      sent: pruneSent([...file.sent, { fingerprint: fp, at: event.at }], event.at),
    });
    scheduleFlush(FLUSH_DEBOUNCE_MS);
  } catch (e) {
    // Reporting a crash may not be a way to crash
    notifyLog(`[crash] could not record a report: ${String(e)}`);
  }
}

/**
 * Sends what is waiting, as far as it gets
 *
 * Safe to call at any time and from anywhere: it does nothing when the queue is empty, when
 * another flush is running, or when no mailbox can send yet -- and in that last case the queue
 * is left exactly as it was, which is what makes a start with no network harmless.
 */
export async function flushCrashReports(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const file = read();
    if (file.queue.length === 0) return;
    const sender = sendingAccount();
    if (!sender) {
      notifyLog(`[crash] ${file.queue.length} report(s) waiting: no mailbox can send yet`);
      // Asked again on the timer rather than left until the next start. An account is linked,
      // a connection comes back, a token is refreshed -- all three happen while the app runs,
      // and none of them has anything to do with a new crash arriving to nudge the queue.
      scheduleFlush(FLUSH_EVERY_MS);
      return;
    }
    const context: CrashContext = {
      version: app.getVersion(),
      platform: process.platform,
      osRelease: release(),
      mailboxCount: profiles.length,
    };
    // Every log the app keeps: its own two out of userData, plus the drag log from the drop
    // folder, which is the only trail of what was being dragged or copied when this happened.
    // Attached only here and not to the feedback mail somebody types: that one carries its logs
    // inside a URL of eight kilobytes, where a third block would push the other two out.
    const dropLog = dropLogTail(mailDropFolder());
    const logs = [...redactedLogs(LOG_ATTACH_MAX), ...(dropLog ? [dropLog] : [])];

    const keep: QueuedCrash[] = [];
    for (const [at, crash] of file.queue.entries()) {
      if (at >= PER_FLUSH) {
        keep.push(crash);
        continue;
      }
      if (await sendOne(sender, crash, context, logs)) continue;
      const tries = crash.tries + 1;
      if (tries < MAX_TRIES) keep.push({ ...crash, tries });
      else notifyLog(`[crash] giving up on a report after ${MAX_TRIES} attempts: ${crash.id}`);
    }
    // Re-read rather than reusing what this pass started with: a crash reported while the
    // uploads were in flight is in the file by now, and writing the old queue back would lose
    // it. Its own ids are what tell the two apart.
    const now = read();
    const walked = new Set(file.queue.map((q) => q.id));
    const arrivedSince = now.queue.filter((q) => !walked.has(q.id));
    write({ queue: [...keep, ...arrivedSince], sent: now.sent });
    if (keep.length > 0) scheduleFlush(FLUSH_EVERY_MS);
  } catch (e) {
    notifyLog(`[crash] flush failed: ${String(e)}`);
  } finally {
    flushing = false;
  }
}

/**
 * Reports one error a page of this app's own interface raised
 *
 * Gmail's own pages are not hooked: their scripts are Google's, they throw on their own
 * schedule, and none of it is this app's to fix. This is for the sidebar, the settings panel,
 * the mail-drop window and the toasts -- the surfaces this repo actually renders.
 *
 * @param arg what the page reported, unvalidated -- it comes over IPC
 */
export function reportRendererError(arg: unknown): void {
  const raw = (arg ?? {}) as { message?: unknown; stack?: unknown; where?: unknown };
  const message = typeof raw.message === 'string' ? raw.message.slice(0, 2000) : '';
  if (message.trim() === '') return;
  reportCrash({
    kind: 'window-error',
    message,
    stack: typeof raw.stack === 'string' ? raw.stack.slice(0, 8000) : undefined,
    where: typeof raw.where === 'string' ? raw.where.slice(0, 500) : undefined,
    at: Date.now(),
  });
}


//===========================
// Helper functions
//===========================

/**
 * Starts the next flush, keeping the soonest of whatever was already asked for
 *
 * @param delay ms
 * @private
 */
function scheduleFlush(delay: number): void {
  clearTimeout(flushTimer ?? undefined);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushCrashReports();
  }, delay);
  flushTimer.unref?.();
}

/**
 * Sends one report
 *
 * @param sender the account it goes out as
 * @param crash
 * @param context
 * @param logs the attachments, read once for the whole flush
 * @returns {Promise<boolean>} whether Gmail took it
 * @private
 */
async function sendOne(
  sender: { email: string; run: <T>(fn: (token: string) => Promise<T>) => Promise<T> },
  crash: QueuedCrash,
  context: CrashContext,
  logs: Array<{ name: string; text: string }>,
): Promise<boolean> {
  const raw = buildRawMail({
    from: sender.email,
    to: FEEDBACK_TO,
    subject: crashSubject(crash, context),
    body: crashBody(crash, context),
    attachments: logs.map((l) => ({ filename: l.name, text: l.text })),
  });
  try {
    const id = await sender.run((token) => sendRawMessage(token, raw));
    notifyLog(`[crash] report sent from ${sender.email} as ${id ?? 'an unnamed message'}`);
    return true;
  } catch (e) {
    notifyLog(`[crash] sending failed from ${sender.email}: ${String(e)}`);
    return false;
  }
}

/**
 * Which account the report is sent as
 *
 * An own account, never a delegated mailbox: sending as somebody whose mailbox this person is
 * only a delegate of is not something to do behind their back. The token must already carry
 * gmail.send, or Gmail answers 403 and the report is retried five times for nothing -- an
 * account still on the old scopes is one the reconnect banner is already asking about.
 *
 * @returns the address and a runner, or null when nothing can send yet
 * @private
 */
function sendingAccount(): {
  email: string;
  run: <T>(fn: (token: string) => Promise<T>) => Promise<T>;
} | null {
  for (const profile of profiles) {
    if (profile.ref.kind !== 'authuser') continue;
    const token = oauthTokens?.get(profile.email);
    if (!token || !hasScopes(token)) continue;
    const run = withTokenFor(profile.email);
    if (run) return { email: profile.email, run };
  }
  return null;
}

/**
 * Where a page that died was
 *
 * @param contents the dead page's webContents, which may refuse every question by now
 * @returns the URL, or nothing when it cannot be had
 * @private
 */
function safeUrl(contents: { isDestroyed?: () => boolean; getURL?: () => string }): string {
  try {
    if (contents.isDestroyed?.()) return '';
    return contents.getURL?.() ?? '';
  } catch {
    return '';
  }
}

/**
 * What the machine's graphics are doing, for a report about the GPU process
 *
 * Without this a GPU report says "gone (exit 34)" and nothing else, which names no driver, no
 * vendor and no feature -- unanswerable, and a report nobody can answer is a report not worth
 * sending. Chromium's own feature list is what it decided about this machine and is the part
 * that differs between the machine that is fine and the one that is not.
 *
 * @returns one line per feature, or nothing when Electron will not say
 * @private
 */
function gpuSummary(): string | undefined {
  try {
    const status = app.getGPUFeatureStatus() as unknown as Record<string, string>;
    const lines = Object.entries(status).map(([feature, state]) => `${feature}: ${state}`);
    return lines.length ? lines.join('\n') : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The queue and the record of what was sent, as they are on disk
 *
 * @returns both, empty when there is no file or it cannot be read -- a broken file is not worth
 *   a second crash
 * @private
 */
function read(): CrashFile {
  try {
    const raw = readJsonFile(join(app.getPath('userData'), STORE_NAME)) as Partial<CrashFile>;
    return {
      queue: Array.isArray(raw?.queue) ? raw.queue : [],
      sent: Array.isArray(raw?.sent) ? raw.sent : [],
    };
  } catch {
    return { queue: [], sent: [] };
  }
}

/**
 * Puts the queue back
 *
 * @param file
 * @private
 */
function write(file: CrashFile): void {
  try {
    writeJsonFile(join(app.getPath('userData'), STORE_NAME), file);
  } catch (e) {
    notifyLog(`[crash] could not write the queue: ${String(e)}`);
  }
}
