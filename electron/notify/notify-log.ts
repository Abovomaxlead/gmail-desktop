// A record of what happened to every notification, beside the other stores in userData.
//
// A notification that does not appear leaves nothing behind: no window, no error, and by
// the time it is noticed the mail is minutes old. So every link in the chain says so here —
// did Gmail raise it, did a setting suppress it, did the stack draw it — and a missing
// notification leaves a trail naming which link it was.
//
// Modelled on update-log.ts: plain text, appended a line at a time, started over rather
// than rotated past the cap, every write wrapped so the log can never cost a notification.

import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';



//===========================
// Constants
//===========================

export const NOTIFY_LOG_MAX_BYTES = 512 * 1024;


//===========================
// Exported functions
//===========================

/**
 * Builds a sink that appends one line at a time to a file
 *
 * @param path
 * @param now injectable, so a test can fix the stamp
 * @returns the sink
 */
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

/**
 * Starts writing the log to a file
 *
 * @param path until this is called the log is console-only, which is what the tests and
 *   every module importing notifyLog without an app around them get
 */
export function openNotifyLog(path: string): void {
  sink = createNotifyLog(path);
}

/**
 * Records one line about one link in the notification chain
 *
 * @param message goes to the console as well, so a watching terminal keeps everything
 */
export function notifyLog(message: string): void {
  console.log(message);
  sink?.(message);
}


//===========================
// Module state
//===========================

let sink: ((message: string) => void) | null = null;
