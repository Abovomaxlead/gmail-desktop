// Where dragged mail is kept when nobody has chosen a folder. Documents is the wrong answer
// on these machines: it is redirected to the server, which is how the mail leaves the PC and
// why appended records in log.jsonl came back zeroed. So the default has to be a directory
// that no redirection, roaming profile or iCloud sync touches -- on both platforms, which is
// why the resolver takes the platform rather than reading this machine's own.

import { describe, it, expect } from 'vitest';
import { defaultMailFolder, looksRemoteFolder } from '../electron/mail/mail-folder';

const windows = {
  platform: 'win32',
  env: { LOCALAPPDATA: 'C:\\Users\\iemand\\AppData\\Local' },
  appData: 'C:\\Users\\iemand\\AppData\\Roaming',
  home: 'C:\\Users\\iemand',
};
const mac = {
  platform: 'darwin',
  env: {},
  appData: '/Users/iemand/Library/Application Support',
  home: '/Users/iemand',
};

describe('defaultMailFolder', () => {
  it('keeps Windows in the local half of AppData, never the roamed one', () => {
    expect(defaultMailFolder(windows)).toBe(
      'C:\\Users\\iemand\\AppData\\Local\\Gmail Desktop\\Mail',
    );
  });

  it('falls back to the local path under home when LOCALAPPDATA is not set', () => {
    expect(defaultMailFolder({ ...windows, env: {} })).toBe(
      'C:\\Users\\iemand\\AppData\\Local\\Gmail Desktop\\Mail',
    );
  });

  it('uses Application Support on a Mac, which iCloud does not sync', () => {
    expect(defaultMailFolder(mac)).toBe(
      '/Users/iemand/Library/Application Support/Gmail Desktop/Mail',
    );
  });

  it('has an answer for a platform that is neither', () => {
    expect(
      defaultMailFolder({
        platform: 'linux',
        env: {},
        appData: '/home/iemand/.config',
        home: '/home/iemand',
      }),
    ).toBe('/home/iemand/.config/Gmail Desktop/Mail');
  });

  it('never lands in Documents, and never in Roaming', () => {
    for (const arg of [windows, mac, { ...windows, env: {} }]) {
      const folder = defaultMailFolder(arg).toLowerCase();
      expect(folder).not.toContain('documents');
      expect(folder).not.toContain('roaming');
    }
  });
});

describe('looksRemoteFolder', () => {
  it('recognises a UNC path, which is the share this whole change is about', () => {
    expect(looksRemoteFolder('\\\\server\\profiles\\iemand\\Documents')).toBe(true);
    expect(looksRemoteFolder('//server/profiles/iemand')).toBe(true);
  });

  it('recognises the sync folders that push a file off the machine', () => {
    expect(looksRemoteFolder('C:\\Users\\iemand\\OneDrive - Abovo\\Mail')).toBe(true);
    expect(looksRemoteFolder('C:\\Users\\iemand\\OneDrive\\Mail')).toBe(true);
    expect(looksRemoteFolder('/Users/iemand/Library/Mobile Documents/com~apple~CloudDocs')).toBe(
      true,
    );
    expect(looksRemoteFolder('C:\\Users\\iemand\\Dropbox\\Mail')).toBe(true);
    expect(looksRemoteFolder('/Users/iemand/Google Drive/Mail')).toBe(true);
  });

  it('leaves a plain local path alone', () => {
    expect(looksRemoteFolder('C:\\Users\\iemand\\AppData\\Local\\Gmail Desktop\\Mail')).toBe(false);
    expect(looksRemoteFolder('/Users/iemand/Library/Application Support/Gmail Desktop/Mail')).toBe(
      false,
    );
    expect(looksRemoteFolder('D:\\Mail')).toBe(false);
  });

  it('answers no rather than yes for nothing at all', () => {
    expect(looksRemoteFolder('')).toBe(false);
  });

  it('does not mistake a folder that merely mentions a name in passing', () => {
    // The marker has to be a segment of its own: a folder called "Dropbox archief 2019" on the
    // local disk is somebody's archive of old files, not a sync folder.
    expect(looksRemoteFolder('C:\\Mail\\Dropbox archief 2019')).toBe(false);
  });
});
