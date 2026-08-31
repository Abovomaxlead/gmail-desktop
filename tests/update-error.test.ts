// Turning what electron-updater throws into something a settings panel can show.
//
// The panel used to render `err.message` verbatim. For a missing latest.yml that message is
// about twenty lines: the request line, a sentence about authentication tokens, and a full
// JSON dump of the response headers. So a failed check filled the Updates section with a
// wall of text -- the report this exists for, "af en toe komt er een grote error log".
//
// The whole thing is already kept: autoUpdater.logger writes update.log, headers and stack
// included. What the panel needs is the one line that says what went wrong.

import { describe, it, expect } from 'vitest';
import { UPDATE_ERROR_MAX_CHARS, updateErrorText } from '../electron/updates/update-error';

describe('updateErrorText', () => {
  // The two real messages out of update.log, verbatim.
  it('keeps the sentence and drops the header dump', () => {
    const raw = [
      'Error: Cannot find latest.yml in the latest release artifacts (https://github.com/x/y/releases/download/v0.3.1/latest.yml): HttpError: 404 ',
      '"method: GET url: https://github.com/x/y/releases/download/v0.3.1/latest.yml\\n\\nPlease double check that your authentication token is correct."',
      'Headers: {',
      '  "cache-control": "no-cache",',
      '  "server": "github.com"',
      '}',
      '    at createHttpError (C:\\app.asar\\dist-electron\\main.js:7150:14)',
    ].join('\n');

    expect(updateErrorText(raw)).toBe(
      'Cannot find latest.yml in the latest release artifacts (https://github.com/x/y/releases/download/v0.3.1/latest.yml): HttpError: 404',
    );
  });

  // electron-updater doubles the prefix on its way through, so both have to come off.
  it('strips a doubled Error prefix', () => {
    expect(updateErrorText('Error: Error: No published versions on GitHub')).toBe(
      'No published versions on GitHub',
    );
  });

  it('keeps a message that is already one line', () => {
    expect(updateErrorText('sha512 checksum mismatch, expected AAA, got BBB')).toBe(
      'sha512 checksum mismatch, expected AAA, got BBB',
    );
  });

  // A stack trace with nothing in front of it still has to say something.
  it('falls back to the first line that is not stack', () => {
    const raw = ['    at newError (C:\\main.js:6284:21)', '    at fetchData (C:\\main.js:16305:57)'].join(
      '\n',
    );
    expect(updateErrorText(raw)).toBe('at newError (C:\\main.js:6284:21)');
  });

  it('caps a single line that is pathologically long', () => {
    const text = updateErrorText('x'.repeat(UPDATE_ERROR_MAX_CHARS + 200));
    expect(text).toHaveLength(UPDATE_ERROR_MAX_CHARS + 1);
    expect(text.endsWith('…')).toBe(true);
  });

  // Nothing usable must not become the string "undefined" in front of the user.
  it('answers with nothing for an empty message', () => {
    expect(updateErrorText('')).toBe('');
    expect(updateErrorText('   \n  \n ')).toBe('');
  });
});
