// Makes the app selectable as the Windows mail client, and reads back which app Windows
// actually hands mailto: to.
//
// `app.setAsDefaultProtocolClient` only writes the pre-Windows-8 fallback. Since Windows 8
// the answer comes from UrlAssociations\mailto\UserChoice, whose Hash Windows signs itself,
// so an app can only register its capability and let the user pick it in Settings.
//
// All keys live under HKCU, matching the per-user install and needing no admin.

import { execFile } from 'node:child_process';


//===========================
// Types
//===========================

export interface RegistryEntry {
  key: string;
  name: string;
  value: string;
}


//===========================
// Constants
//===========================

export const MAIL_APP_NAME = 'Gmail Desktop';
export const MAIL_PROG_ID = 'GmailDesktop.Url.mailto';

const USER_CHOICE_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\mailto\\UserChoice';


//===========================
// Exported functions
//===========================

/**
 * The registry keys that make the app pickable as the mail client
 *
 * @param exePath
 * @param appName the name Settings shows in the Email category
 * @param progId
 * @returns the entries in write order
 */
export function mailClientEntries(
  exePath: string,
  appName: string = MAIL_APP_NAME,
  progId: string = MAIL_PROG_ID,
): RegistryEntry[] {
  const exe = `"${exePath}"`;
  const cls = `HKCU\\Software\\Classes\\${progId}`;
  const client = `HKCU\\Software\\Clients\\Mail\\${appName}`;
  const caps = `${client}\\Capabilities`;

  return [
    { key: cls, name: '', value: appName },
    { key: cls, name: 'URL Protocol', value: '' },
    { key: `${cls}\\DefaultIcon`, name: '', value: `${exe},0` },
    { key: `${cls}\\shell\\open\\command`, name: '', value: `${exe} "%1"` },

    { key: client, name: '', value: appName },
    { key: `${client}\\shell\\open\\command`, name: '', value: exe },
    { key: caps, name: 'ApplicationName', value: appName },
    { key: caps, name: 'ApplicationIcon', value: `${exe},0` },
    { key: caps, name: 'ApplicationDescription', value: 'Gmail as a desktop app' },
    { key: `${caps}\\UrlAssociations`, name: 'mailto', value: progId },

    {
      key: 'HKCU\\Software\\RegisteredApplications',
      name: appName,
      value: `Software\\Clients\\Mail\\${appName}\\Capabilities`,
    },
  ];
}

/**
 * Pulls the ProgId out of a `reg query <UserChoice>` result
 *
 * @param regOutput
 * @returns the ProgId, or null when the key holds none
 */
export function parseUserChoiceProgId(regOutput: string): string | null {
  if (typeof regOutput !== 'string') return null;
  const m = /^\s*ProgId\s+REG_SZ\s+(.+?)\s*$/m.exec(regOutput);
  return m ? m[1] : null;
}

export function isOurProgId(progId: string | null, ours: string = MAIL_PROG_ID): boolean {
  return typeof progId === 'string' && progId.toLowerCase() === ours.toLowerCase();
}

/**
 * Writes the capability keys
 *
 * Idempotent, so it is safe to run on every launch.
 *
 * @param exePath
 * @returns {Promise<void>}
 */
export async function registerMailClient(exePath: string): Promise<void> {
  for (const e of mailClientEntries(exePath)) {
    // `reg add` refuses an empty /d, but omitting it writes the empty string we want.
    const args = ['add', e.key, ...(e.name === '' ? ['/ve'] : ['/v', e.name]), '/t', 'REG_SZ'];
    if (e.value !== '') args.push('/d', e.value);
    await reg([...args, '/f']);
  }
}

/**
 * The ProgId Windows currently hands mailto: to
 *
 * @returns {Promise<string|null>} null when nothing is set
 */
export async function readMailtoProgId(): Promise<string | null> {
  return parseUserChoiceProgId(await reg(['query', USER_CHOICE_KEY, '/v', 'ProgId']));
}


//===========================
// Helper functions
//===========================

/**
 * Runs reg.exe
 *
 * @param args
 * @returns {Promise<string>} stdout, or the empty string when the call failed
 * @private
 */
function reg(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile('reg.exe', args, { windowsHide: true }, (err, stdout) => {
      resolve(err ? '' : stdout);
    });
  });
}
