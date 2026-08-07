// Whether a failed update download is worth trying again, and how long to wait first.
//
// The failure this exists for is "sha512 checksum mismatch, expected X, got Y". It means
// the installer that arrived is not the one latest.yml describes, and the reason it is
// worth retrying rather than reporting is what it does not mean: electron-updater already
// falls back from a broken differential download to a full one by itself, so a mismatch
// that reaches us is a full download that came off the wire wrong — a truncated response,
// a connection dropped mid-transfer, a CDN hiccup. The next attempt starts from a cleared
// cache and usually simply works, which is exactly what the one report of this described:
// an error, a few more clicks, an update that installed. The retry is doing by itself what
// the person had to work out to do.
//
// A deny list rather than an allow list, because the transient failures have no bounded
// set of messages — every socket error, timeout and truncation phrases itself differently
// — while the failures that must never be retried are few, named, and known:
//
//   - an invalid signature is the one failure that could be an attack, and quietly trying
//     again until it passes is the worst possible response to it;
//   - a cancelled download was cancelled on purpose;
//   - a disabled web installer and a missing check are configuration, not luck, and will
//     fail identically forever.

export const UPDATE_DOWNLOAD_ATTEMPTS = 3;

/** Long enough for a dropped connection to be worth re-opening, short enough that the
 * progress bar sitting still is not read as a hang. */
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

/** True when this failure should be tried again rather than shown. `attempt` is 1 for the
 * first try, so the last allowed attempt reports instead of retrying. */
export function shouldRetryDownload(message: string, attempt: number): boolean {
  if (attempt >= UPDATE_DOWNLOAD_ATTEMPTS) return false;
  const lower = message.toLowerCase();
  return !NEVER_RETRY.some((phrase) => lower.includes(phrase.toLowerCase()));
}
