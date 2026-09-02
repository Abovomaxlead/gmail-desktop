// What of an update failure the user is shown.
//
// electron-updater's `err.message` is written for a log, not for a panel. A missing
// latest.yml carries the request line, a sentence about authentication tokens and the whole
// response header set as JSON -- about twenty lines, which the Updates section rendered
// verbatim. Nothing is lost by cutting it down: autoUpdater.logger writes update.log, and
// the headers and the stack are still there in full.
//
// The first line is the message; everything after it is evidence. That holds for every
// failure this app has actually seen -- "No published versions on GitHub", the latest.yml
// 404, a sha512 mismatch -- so the rule is the first line and nothing cleverer.


//===========================
// Constants
//===========================

/** Where a single line is cut. Long enough for the latest.yml message, which names a full
 * release URL and is the longest real one, and short enough that no panel is ever filled by
 * one error. */
export const UPDATE_ERROR_MAX_CHARS = 300;

// electron-updater re-wraps its own errors on the way out, so the prefix arrives doubled:
// the log shows "Error: Error: No published versions on GitHub".
const ERROR_PREFIX = /^(?:Error:\s*)+/;

/** The two ways GitHub answers "there is nothing here to update to". The first is the stable
 * channel looking at /releases/latest while every release so far is a prerelease -- exactly
 * what happens when the prerelease switch goes off on a beta build. The second is a repo with
 * no releases at all. Both arrive as errors from electron-updater although neither is a
 * failure the user can do anything about, so the controller reports them as a state of their
 * own instead of as a failed check. */
export const NO_RELEASE_ERROR =
  /please ensure a production release exists|no published versions on github/i;


//===========================
// Exported functions
//===========================

/**
 * The one line of an update failure worth putting in front of the user
 *
 * @param message electron-updater's own text, headers and stack included
 * @returns the first meaningful line, without its Error prefixes and capped; an empty string
 *   when there is nothing to say, so a caller never renders "undefined"
 */
export function updateErrorText(message: string): string {
  const lines = (message ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length === 0) return '';
  const first = lines[0].replace(ERROR_PREFIX, '').trim();
  // A message that was nothing but its prefix leaves an empty first line, so the next one
  // is the message -- which is also what a bare stack trace falls back to.
  const text = first === '' ? (lines[1] ?? '') : first;
  return cap(text);
}


//===========================
// Helper functions
//===========================

/**
 * Cuts a line that is too long to show
 *
 * @param text
 * @returns the text, or its first UPDATE_ERROR_MAX_CHARS with an ellipsis
 * @private
 */
function cap(text: string): string {
  if (text.length <= UPDATE_ERROR_MAX_CHARS) return text;
  return `${text.slice(0, UPDATE_ERROR_MAX_CHARS)}…`;
}
