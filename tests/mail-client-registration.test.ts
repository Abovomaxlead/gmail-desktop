// Registering as a Windows mail client, and reading back which app Windows actually
// hands mailto: to. Both are pure string work here; the reg.exe calls are not tested.

import { describe, it, expect } from 'vitest';
import {
  MAIL_APP_NAME,
  MAIL_PROG_ID,
  mailClientEntries,
  parseUserChoiceProgId,
  isOurProgId,
} from '../electron/mail-client-registration';

const EXE = 'C:\\Users\\luca.manuel\\AppData\\Local\\Programs\\gmail-desktop\\Gmail Desktop.exe';

function find(entries: ReturnType<typeof mailClientEntries>, key: string, name: string) {
  return entries.find((e) => e.key.toLowerCase() === key.toLowerCase() && e.name === name);
}

describe('mailClientEntries', () => {
  const entries = mailClientEntries(EXE);

  it('points the ProgId open command at the exe with the url placeholder', () => {
    const e = find(entries, `HKCU\\Software\\Classes\\${MAIL_PROG_ID}\\shell\\open\\command`, '');
    expect(e?.value).toBe(`"${EXE}" "%1"`);
  });

  it('marks the ProgId as a url protocol with an empty value', () => {
    const e = find(entries, `HKCU\\Software\\Classes\\${MAIL_PROG_ID}`, 'URL Protocol');
    expect(e).toBeDefined();
    expect(e!.value).toBe('');
  });

  it('associates mailto with our own ProgId, not with the bare mailto key', () => {
    const e = find(
      entries,
      `HKCU\\Software\\Clients\\Mail\\${MAIL_APP_NAME}\\Capabilities\\UrlAssociations`,
      'mailto',
    );
    expect(e?.value).toBe(MAIL_PROG_ID);
  });

  it('announces the app in RegisteredApplications, which is what puts it in Settings', () => {
    const e = find(entries, 'HKCU\\Software\\RegisteredApplications', MAIL_APP_NAME);
    expect(e?.value).toBe(`Software\\Clients\\Mail\\${MAIL_APP_NAME}\\Capabilities`);
  });

  it('registers under Clients\\Mail so Windows lists it in the Email category', () => {
    expect(find(entries, `HKCU\\Software\\Clients\\Mail\\${MAIL_APP_NAME}\\shell\\open\\command`, '')?.value).toBe(
      `"${EXE}"`,
    );
  });

  it('names the app for the Settings list', () => {
    const caps = `HKCU\\Software\\Clients\\Mail\\${MAIL_APP_NAME}\\Capabilities`;
    expect(find(entries, caps, 'ApplicationName')?.value).toBe(MAIL_APP_NAME);
    expect(find(entries, caps, 'ApplicationIcon')?.value).toBe(`"${EXE}",0`);
  });

  it('writes only under HKCU, so no admin rights are needed', () => {
    expect(entries.every((e) => e.key.startsWith('HKCU\\'))).toBe(true);
  });

  it('keeps a path with spaces quoted in every command it writes', () => {
    for (const e of entries) {
      if (!e.value.includes(EXE)) continue;
      expect(e.value).toContain(`"${EXE}"`);
    }
  });
});

describe('parseUserChoiceProgId', () => {
  it('reads the ProgId out of real reg query output', () => {
    const out = [
      '',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\mailto\\UserChoice',
      '    ProgId    REG_SZ    Outlook.URL.mailto.15',
      '    Hash    REG_SZ    JqSVLxHiRiM=',
      '',
    ].join('\r\n');
    expect(parseUserChoiceProgId(out)).toBe('Outlook.URL.mailto.15');
  });

  it('reads our own ProgId once Windows has been pointed at us', () => {
    const out = `    ProgId    REG_SZ    ${MAIL_PROG_ID}\r\n    Hash    REG_SZ    abc=\r\n`;
    expect(parseUserChoiceProgId(out)).toBe(MAIL_PROG_ID);
  });

  it('returns null when there is no UserChoice at all', () => {
    expect(parseUserChoiceProgId('ERROR: The system was unable to find the specified registry key')).toBeNull();
  });

  it('returns null on empty output', () => {
    expect(parseUserChoiceProgId('')).toBeNull();
    expect(parseUserChoiceProgId(undefined as unknown as string)).toBeNull();
  });

  it('does not mistake the Hash line for the ProgId', () => {
    const out = '    Hash    REG_SZ    ProgId=nonsense\r\n    ProgId    REG_SZ    Real.Thing\r\n';
    expect(parseUserChoiceProgId(out)).toBe('Real.Thing');
  });
});

describe('isOurProgId', () => {
  it('is true for our ProgId regardless of case, since the registry is case-insensitive', () => {
    expect(isOurProgId(MAIL_PROG_ID)).toBe(true);
    expect(isOurProgId(MAIL_PROG_ID.toUpperCase())).toBe(true);
  });
  it('is false for another mail app', () => {
    expect(isOurProgId('Outlook.URL.mailto.15')).toBe(false);
  });
  it('is false when nothing is registered', () => {
    expect(isOurProgId(null)).toBe(false);
  });
});
