// The file the mail asks to have attached: what is in it, what it is called, and which of the
// older ones are thrown away.

import { describe, it, expect } from 'vitest';
import {
  BUNDLE_KEEP,
  bundleFileName,
  bundleText,
  bundlesToDelete,
} from '../electron/feedback/feedback-bundle';

const WHEN = new Date('2026-09-01T10:15:30.000Z');

const INPUT = {
  version: '1.0.0-beta.1',
  platform: 'win32',
  osRelease: '10.0.26200',
  mailboxCount: 3,
  logs: [
    { name: 'notify.log', text: 'a\nb\nc' },
    { name: 'update.log', text: 'checking for an update' },
  ],
  when: WHEN,
};

describe('bundleFileName', () => {
  it('stamps the name to the second, and sorts in that order', () => {
    expect(bundleFileName(WHEN)).toBe('gmail-desktop-log-2026-09-01-10-15-30.txt');
    const later = bundleFileName(new Date('2026-09-01T10:15:31.000Z'));
    expect([later, bundleFileName(WHEN)].sort()[0]).toBe(bundleFileName(WHEN));
  });

  it('has no character in it a file system would refuse', () => {
    expect(bundleFileName(WHEN)).not.toMatch(/[:*?"<>|]/);
  });
});

describe('bundleText', () => {
  it('names the app, the system and the moment at the top', () => {
    const text = bundleText(INPUT);
    expect(text).toContain('Gmail Desktop 1.0.0-beta.1');
    expect(text).toContain('10.0.26200');
    expect(text).toContain('3 mailboxes');
    expect(text).toContain('2026-09-01T10:15:30.000Z');
  });

  it('says what was masked, so nobody reads [hidden] as a fault', () => {
    expect(bundleText(INPUT)).toContain('[hidden]');
    expect(bundleText(INPUT)).toContain('[redacted]');
  });

  it('carries every log whole, under its own heading', () => {
    const text = bundleText(INPUT);
    expect(text).toContain('=========== notify.log ===========');
    expect(text).toContain('a\nb\nc');
    expect(text).toContain('=========== update.log ===========');
    expect(text).toContain('checking for an update');
  });

  it('does not cut a long log, which is the reason the file exists', () => {
    const text = 'x'.repeat(400_000);
    expect(bundleText({ ...INPUT, logs: [{ name: 'notify.log', text }] })).toContain(text);
  });

  it('ends in exactly one newline', () => {
    expect(bundleText(INPUT)).toMatch(/[^\n]\n$/);
  });
});

describe('bundlesToDelete', () => {
  const names = Array.from(
    { length: BUNDLE_KEEP + 3 },
    (_, i) => `gmail-desktop-log-2026-09-01-10-15-${String(i).padStart(2, '0')}.txt`,
  );

  it('keeps the newest and answers the rest, oldest first', () => {
    const gone = bundlesToDelete(names);
    expect(gone).toHaveLength(3);
    expect(gone[0]).toBe(names[0]);
    expect(gone).not.toContain(names[names.length - 1]);
  });

  it('deletes nothing while the folder is inside the limit', () => {
    expect(bundlesToDelete(names.slice(0, BUNDLE_KEEP))).toEqual([]);
  });

  it('never touches a file that is not one of ours', () => {
    const gone = bundlesToDelete([...names, 'notify.log', 'prefs.json', 'holiday.jpg']);
    expect(gone).not.toContain('notify.log');
    expect(gone).not.toContain('prefs.json');
    expect(gone).not.toContain('holiday.jpg');
  });

  it('reads an unsorted folder in the order the names imply', () => {
    const shuffled = [...names].reverse();
    expect(bundlesToDelete(shuffled)).toEqual(bundlesToDelete(names));
  });
});
