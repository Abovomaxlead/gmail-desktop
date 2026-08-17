// The updater's own log file, in userData beside the other stores.
//
// electron-updater logs to `console`, which in a packaged Windows build goes to a handle
// nobody can read — which is how a failed update becomes one sentence in a dialog and
// nothing else.
//
// Plain text, appended a line at a time, started over rather than rotated past the cap, and
// every write wrapped so the log can never be the reason an update fails.

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
