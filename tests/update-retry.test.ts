// Updating from an older version failed with a sha512 checksum mismatch, and clicking
// download a few more times installed it. That is a transient bad transfer being reported
// as a dead end: electron-updater clears the cache behind a failed download and starts the
// next one clean, so the retry the person worked out by hand is the fix, done for them.
//
// The tests that matter here are the ones that do NOT retry. A checksum mismatch is
// indistinguishable from a tampered installer by message alone, so the one failure that
// says tampering out loud — an invalid signature — must never be retried into passing.

import { describe, expect, it } from 'vitest';
import {
  UPDATE_DOWNLOAD_ATTEMPTS,
  UPDATE_RETRY_DELAY_MS,
  shouldRetryDownload,
} from '../electron/update-retry';

const CHECKSUM = 'sha512 checksum mismatch, expected abc, got def';

describe('shouldRetryDownload', () => {
  it('retries the checksum mismatch this was written for', () => {
    expect(shouldRetryDownload(CHECKSUM, 1)).toBe(true);
  });

  it('retries the transient transport failures, which have no fixed wording', () => {
    expect(shouldRetryDownload('net::ERR_CONNECTION_RESET', 1)).toBe(true);
    expect(shouldRetryDownload('Request timed out', 1)).toBe(true);
    expect(shouldRetryDownload('socket hang up', 1)).toBe(true);
    expect(shouldRetryDownload('response has been aborted by the server', 1)).toBe(true);
  });

  it('never retries an invalid signature, however many attempts are left', () => {
    const signature =
      'New version 0.3.1 is not signed by the application owner: publisherName mismatch';
    expect(shouldRetryDownload(signature, 1)).toBe(false);
    expect(shouldRetryDownload('ERR_UPDATER_INVALID_SIGNATURE', 1)).toBe(false);
  });

  it('never retries a download that was cancelled on purpose', () => {
    expect(shouldRetryDownload('Cancelled', 1)).toBe(false);
  });

  it('never retries what will fail the same way forever', () => {
    expect(shouldRetryDownload('Please check update first', 1)).toBe(false);
    expect(
      shouldRetryDownload('Unable to download new version 0.3.1. Web Installers are disabled', 1),
    ).toBe(false);
  });

  it('gives up on the last allowed attempt, so the failure is reported rather than hidden', () => {
    expect(shouldRetryDownload(CHECKSUM, UPDATE_DOWNLOAD_ATTEMPTS - 1)).toBe(true);
    expect(shouldRetryDownload(CHECKSUM, UPDATE_DOWNLOAD_ATTEMPTS)).toBe(false);
    expect(shouldRetryDownload(CHECKSUM, UPDATE_DOWNLOAD_ATTEMPTS + 1)).toBe(false);
  });

  it('waits between attempts rather than hammering a server that just failed', () => {
    expect(UPDATE_RETRY_DELAY_MS).toBeGreaterThan(0);
    expect(UPDATE_DOWNLOAD_ATTEMPTS).toBeGreaterThan(1);
  });
});
