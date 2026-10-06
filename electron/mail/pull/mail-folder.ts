// Where dragged mail is kept, and whether that place keeps it on this PC.
//
// Documents was the wrong default. On these machines it is redirected to the server, so mail
// dragged out of Gmail went straight back onto the network -- which is also why appended
// records in log.jsonl came back zeroed: the share does not honour an append the way a local
// disk does. The .eml files survived that; the log did not.
//
// So the default is the one directory per platform that no redirection, roaming profile or
// iCloud sync reaches. On Windows that is the local half of AppData, which has to be read from
// the environment: Electron's own `appData` is Roaming, and Roaming is exactly what a domain
// profile syncs. On a Mac it is Application Support, which iCloud's Desktop & Documents
// feature leaves alone.
//
// A folder someone picks by hand can still be a share, and this file says so rather than
// refusing it: the path is theirs to choose, but a silent choice that undoes the whole point
// of the change is worth a word.

import { posix, win32 } from 'node:path';


//===========================
// Types
//===========================

/** What resolving a folder needs to know, passed in so the rule can be tested for a platform
 * this machine is not. */
export interface FolderEnvironment {
  /** `process.platform` */
  platform: string;
  /** `process.env` */
  env: Record<string, string | undefined>;
  /** Electron's `appData`: Roaming on Windows, Application Support on a Mac, ~/.config else */
  appData: string;
  /** Electron's `home` */
  home: string;
}


//===========================
// Constants
//===========================

/** The two folders the mail lands in, under whichever base the platform gives. */
const MAIL_DIR = ['Gmail Desktop', 'Mail'];

/** Path segments that mean a file put here is handed to something else that copies it off the
 * machine. Matched as whole segments and folded to lower case, so a local folder that merely
 * has one of these words inside its name is not mistaken for the real thing. */
const SYNC_SEGMENTS = [
  'onedrive',
  'dropbox',
  'google drive',
  'my drive',
  'icloud drive',
  'mobile documents',
  'nextcloud',
  'owncloud',
  'box sync',
];

/** A business OneDrive names the tenant in the folder: "OneDrive - Abovo Maxlead". */
const ONEDRIVE_TENANT = 'onedrive -';


//===========================
// Exported functions
//===========================

/**
 * The folder dragged mail goes to when nobody has chosen one
 *
 * @param env the platform, its environment, and the two paths Electron resolves
 * @returns an absolute path that stays on this machine, in that platform's own notation
 */
export function defaultMailFolder(env: FolderEnvironment): string {
  const join = env.platform === 'win32' ? win32.join : posix.join;
  if (env.platform === 'win32') {
    // Roaming is what a domain profile syncs, so the local half is read from the environment,
    // and rebuilt from home only if the variable is missing -- which it should never be.
    const local = env.env.LOCALAPPDATA || join(env.home, 'AppData', 'Local');
    return join(local, ...MAIL_DIR);
  }
  return join(env.appData, ...MAIL_DIR);
}

/**
 * Whether a folder is one that hands its contents to something else
 *
 * The path is all this reads. A mapped network drive looks exactly like a local disk from
 * here, so a false answer means "nothing in the name says so" and never "this is certainly
 * local".
 *
 * @param folder
 * @returns true for a UNC path or a known sync folder
 */
export function looksRemoteFolder(folder: string): boolean {
  if (!folder) return false;
  if (folder.startsWith('\\\\') || folder.startsWith('//')) return true;
  const segments = folder.toLowerCase().split(/[\\/]+/);
  return segments.some((s) => SYNC_SEGMENTS.includes(s) || s.startsWith(ONEDRIVE_TENANT));
}
