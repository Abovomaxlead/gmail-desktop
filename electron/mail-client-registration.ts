// Makes the app selectable as the Windows mail client, and reads back which app
// Windows actually hands mailto: to.
//
// Why this exists next to `app.setAsDefaultProtocolClient('mailto')`: that call only
// writes HKCU\Software\Classes\mailto, the pre-Windows-8 fallback. Since Windows 8 the
// answer comes from UrlAssociations\mailto\UserChoice, whose `Hash` is signed by
// Windows itself, so no application can claim the default - write it yourself and
// Windows discards the association. What an app *can* do is register its capability
// and let the user pick it in Settings, which is how Chrome and Thunderbird do it too.
//
// All keys live under HKCU, matching this app's per-user install and needing no admin.

import { execFile } from 'node:child_process';

export const MAIL_APP_NAME = 'Gmail Desktop';
export const MAIL_PROG_ID = 'GmailDesktop.Url.mailto';

const USER_CHOICE_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\mailto\\UserChoice';

export interface RegistryEntry {
  key: string;
  /** Empty means the key's default value (reg's `/ve`). */
  name: string;
  value: string;
}

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
    // The ProgId Windows will point mailto: at once the user picks us.
    { key: cls, name: '', value: appName },
    { key: cls, name: 'URL Protocol', value: '' },
    { key: `${cls}\\DefaultIcon`, name: '', value: `${exe},0` },
    { key: `${cls}\\shell\\open\\command`, name: '', value: `${exe} "%1"` },

    // Being a mail client is what lands the app in the Email category of Settings.
    { key: client, name: '', value: appName },
    { key: `${client}\\shell\\open\\command`, name: '', value: exe },
    { key: caps, name: 'ApplicationName', value: appName },
    { key: caps, name: 'ApplicationIcon', value: `${exe},0` },
    { key: caps, name: 'ApplicationDescription', value: 'Gmail as a desktop app' },
    { key: `${caps}\\UrlAssociations`, name: 'mailto', value: progId },

    // Without this line the app exists but Settings never lists it.
    {
      key: 'HKCU\\Software\\RegisteredApplications',
      name: appName,
      value: `Software\\Clients\\Mail\\${appName}\\Capabilities`,
    },
  ];
}

/** Pulls the ProgId out of `reg query <UserChoice>` output, or null if there is none. */
export function parseUserChoiceProgId(regOutput: string): string | null {
  if (typeof regOutput !== 'string') return null;
  const m = /^\s*ProgId\s+REG_SZ\s+(.+?)\s*$/m.exec(regOutput);
  return m ? m[1] : null;
}

export function isOurProgId(progId: string | null, ours: string = MAIL_PROG_ID): boolean {
  return typeof progId === 'string' && progId.toLowerCase() === ours.toLowerCase();
}

function reg(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile('reg.exe', args, { windowsHide: true }, (err, stdout) => {
      resolve(err ? '' : stdout);
    });
  });
}

/** Writes the capability keys. Idempotent, so it is safe to run on every launch. */
export async function registerMailClient(exePath: string): Promise<void> {
  for (const e of mailClientEntries(exePath)) {
    // `reg add` refuses an empty /d, but omitting it writes the empty string we want.
    const args = ['add', e.key, ...(e.name === '' ? ['/ve'] : ['/v', e.name]), '/t', 'REG_SZ'];
    if (e.value !== '') args.push('/d', e.value);
    await reg([...args, '/f']);
  }
}

/** The ProgId Windows currently uses for mailto:, or null if nothing is set. */
export async function readMailtoProgId(): Promise<string | null> {
  return parseUserChoiceProgId(await reg(['query', USER_CHOICE_KEY, '/v', 'ProgId']));
}
