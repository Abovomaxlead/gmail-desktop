// The updater's own log file, in userData beside the other stores.
//
// electron-updater is talkative and logs to `console` by default, which in a packaged
// Windows build goes nowhere at all: there is no terminal attached, so every line about
// which blockmap was fetched, which file was cached, and why a download was thrown away
// is written to a handle nobody can read. That is how a failed update becomes a single
// sentence in a dialog and nothing else — the one report of the sha512 mismatch could be
// answered only by reading electron-updater's source, because the machine that saw it had
// kept no record of what happened.
//
// Deliberately small. It is a plain text file, appended a line at a time, and when it
// passes the cap it is started over rather than rotated — the interesting lines are always
// the most recent ones, and an update log worth keeping history of is a contradiction. It
// must never be the reason an update fails, so every write is wrapped: a full disk or a
// read-only profile costs the log, not the update.

import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';



//===========================
// Constants
//===========================

// Roughly a session's worth of electron-updater chatter.
export const UPDATE_LOG_MAX_BYTES = 256 * 1024;


//===========================
// Types
//===========================

// The shape electron-updater expects of autoUpdater.logger.
export interface UpdateLogger {
  info(message: unknown): void;
  warn(message: unknown): void;
  error(message: unknown): void;
  debug(message: unknown): void;
}


//===========================
// Exported functions
//===========================

/**
 * Builds the logger electron-updater writes through
 *
 * @param path
 * @param now injectable, so a test can fix the stamp
 * @returns the logger; every write is wrapped, so the log can never fail an update
 */
export function createUpdateLog(
  path: string,
  now: () => Date = () => new Date(),
): UpdateLogger {
  const write = (level: string, message: unknown): void => {
    try {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      // Started over rather than rotated: see above.
      if (existsSync(path) && statSync(path).size > UPDATE_LOG_MAX_BYTES) {
        writeFileSync(path, '');
      }
      appendFileSync(path, `${now().toISOString()} [${level}] ${String(message)}\n`);
    } catch {
    }
  };
  return {
    info: (m) => write('info', m),
    warn: (m) => write('warn', m),
    error: (m) => write('error', m),
    debug: (m) => write('debug', m),
  };
}
