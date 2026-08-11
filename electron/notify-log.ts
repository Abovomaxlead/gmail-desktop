// A record of what happened to every notification, in a file, beside the other stores in
// userData.
//
// The app already logs the whole chain to `console`, and in a packaged Windows build that
// goes to a handle nobody can read — but the reason this file exists is narrower than
// that, and it is not about packaging. A notification that does not appear leaves nothing
// behind: there is no window to inspect, no error, and by the time it is noticed the mail
// is minutes old. Every link in that chain is a question nobody can answer afterwards.
// Did Gmail raise it at all? Was it suppressed by a setting? Was a card put on the stack?
// Did the stack draw it? So each link says so here, and a notification that goes missing
// leaves a trail explaining which one it was.
//
// Deliberately small, and modelled on update-log.ts: a plain text file, appended a line at
// a time, started over rather than rotated when it passes the cap, and every write
// wrapped. It must never be the reason a notification is lost — a full disk or a
// read-only profile costs the log, not the mail.

import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** A few days of ordinary use; the interesting lines are always the recent ones. */
export const NOTIFY_LOG_MAX_BYTES = 128 * 1024;

export function createNotifyLog(
  path: string,
  now: () => Date = () => new Date(),
): (message: string) => void {
  return (message: string): void => {
    try {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      if (existsSync(path) && statSync(path).size > NOTIFY_LOG_MAX_BYTES) {
        writeFileSync(path, '');
      }
      appendFileSync(path, `${now().toISOString()} ${message}\n`);
    } catch {
    }
  };
}

let sink: ((message: string) => void) | null = null;

/** Starts writing to `path`. Until this is called the log is console-only, which is what
 * the tests and every module that imports notifyLog without an app around them get. */
export function openNotifyLog(path: string): void {
  sink = createNotifyLog(path);
}

/** One line about one link in the chain. Goes to the console as well, so a terminal that
 * is watching keeps everything it had before. */
export function notifyLog(message: string): void {
  console.log(message);
  sink?.(message);
}
