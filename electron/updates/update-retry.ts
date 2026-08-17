// Whether a failed update download is worth trying again, and how long to wait first.
//
// The failure this exists for is a sha512 mismatch. electron-updater already falls back
// from a broken differential download to a full one, so a mismatch that reaches us is a
// full download that came off the wire wrong, and the next attempt starts from a cleared
// cache and usually works.
//
// A deny list rather than an allow list: the transient failures have no bounded set of
// messages, while the ones that must never be retried are few and named — an invalid
// signature above all, since retrying it is the worst answer to a possible attack.


//===========================
// Constants
//===========================

export const UPDATE_DOWNLOAD_ATTEMPTS = 3;

// Long enough for a dropped connection to be worth re-opening, short enough that the
// progress bar sitting still is not read as a hang.
export const UPDATE_RETRY_DELAY_MS = 2000;

// Both the code and the wording for each, because what reaches us is `err.message` and
// electron-updater carries its ERR_UPDATER_* codes on a separate property: matching only
// the codes would retry every one of these.
const NEVER_RETRY = [
  'ERR_UPDATER_INVALID_SIGNATURE',
  'is not signed by the application owner',
  'ERR_UPDATER_WEB_INSTALLER_DISABLED',
  'Web Installers are disabled',
  'Please check update first',
  'cancelled',
];


//===========================
// Exported functions
//===========================

/**
 * Whether a failed download should be tried again rather than shown
 *
 * @param message the error text, which is what reaches us
 * @param attempt 1 for the first try, so the last allowed attempt reports instead
 * @returns true to retry
 */
export function shouldRetryDownload(message: string, attempt: number): boolean {
  if (attempt >= UPDATE_DOWNLOAD_ATTEMPTS) return false;
  const lower = message.toLowerCase();
  return !NEVER_RETRY.some((phrase) => lower.includes(phrase.toLowerCase()));
}
