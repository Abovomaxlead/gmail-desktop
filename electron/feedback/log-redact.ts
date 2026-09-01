// What may leave the machine when a log rides along with a feedback mail.
//
// The logs are written for whoever fixes the bug, so they name mailboxes, labels, counts,
// timings and ids -- and that is exactly what makes them worth sending. Two things in them are
// nobody's business but the user's: anything that could be used to sign in as them, and the
// content of their mail. Both are masked here, and the rest goes as it was written.
//
// Masked, not dropped. A line that says a notification was drawn is a diagnostic even with the
// title taken out of it, and dropping the line would lose the event as well as the text. So
// every rule replaces a span inside a line and keeps the line.
//
// Pure and beside the mail builder rather than inside it: this is the one part of feedback where
// being wrong is not a cosmetic problem, so it is a module a test can hold on its own.

//===========================
// Constants
//===========================

export const REDACTED = '[redacted]';
export const HIDDEN = '[hidden]';

const SECRET_KEY_NAMES = [
  'access[_-]?token',
  'refresh[_-]?token',
  'id[_-]?token',
  'client[_-]?secret',
  'api[_-]?key',
  'authorization',
  'bearer',
  'token',
  'secret',
  'password',
  'passwd',
  'pwd',
  'code',
].join('|');

/** Value-carrying keys, masked whatever they are attached to. The value has to be twelve
 * characters or more before it counts: `code=404` is an HTTP status and belongs in a bug report,
 * while a `code=` of forty characters is the OAuth authorization code and does not. */
const SECRET_KEYS = new RegExp(
  `\\b(${SECRET_KEY_NAMES})\\b(["']?\\s*(?:[:=]|=>)\\s*["']?|\\s+)([A-Za-z0-9._~+/-]{12,}={0,2})`,
  'gi',
);

/** Shapes that are a credential wherever they turn up, named or not: a Google access token, a
 * refresh token, an OAuth client secret, and any JWT. An exception dumped into the log carries
 * these inside a URL or a response body, where no key precedes them. */
const SECRET_SHAPES: RegExp[] = [
  /\bya29\.[A-Za-z0-9._~+/-]{8,}={0,2}/g,
  /\b1\/\/[A-Za-z0-9._~+/-]{10,}/g,
  /\bGOCSPX-[A-Za-z0-9._~+/-]{6,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g,
];

/** What Gmail put in the notification, which is the mail's own first line. Quoted by the logger
 * with JSON.stringify, so the closing quote is the one that is not escaped. */
const SUBJECT = /\bsubject=(?:"(?:[^"\\]|\\.)*"|[^\s]+)/gi;

/** A toast's title is the sender's name and its card text is the subject, and both reach the log
 * inside quotes. Only on toast lines: a quoted run elsewhere is a label name, and a maildrop log
 * without label names cannot be read at all. */
const TOAST_LINE = /\[toast\]/;
const QUOTED = /"(?:[^"\\]|\\.)*"/g;

/** The start of a record: a stamp, if the log has one, and then the `[something]` every line
 * begins with. What does not match is a continuation -- a console message with newlines in it
 * arrives as bare lines, and the page that produces those is the one drawing the toasts. */
const RECORD_HEAD = /^(?:\S+\s+)?\[[a-z-]+[^\]]*\]/i;


//===========================
// Exported functions
//===========================

/**
 * Masks the credentials and the mail content in one log line
 *
 * @param line one line, without its newline
 * @param quoted treat quoted runs as mail content even when this line names no toast, which is
 *   how the second line of a console message with newlines in it is handled
 * @returns {string} the line, with every sensitive span replaced by a marker
 */
export function redactLogLine(line: string, quoted: boolean = false): string {
  let out = line.replace(SECRET_KEYS, (_m, key: string, sep: string) => `${key}${sep}${REDACTED}`);
  for (const shape of SECRET_SHAPES) out = out.replace(shape, REDACTED);
  out = out.replace(SUBJECT, `subject="${HIDDEN}"`);
  if (quoted || TOAST_LINE.test(out)) out = out.replace(QUOTED, `"${HIDDEN}"`);
  return out;
}

/**
 * Masks a whole log file
 *
 * Line by line, but not each line on its own: a record can run over several lines, and only its
 * first says which part of the app wrote it. A line that does not open a record is read as
 * belonging to the one above it.
 *
 * @param text the file as it was read, or an empty string when there was none
 * @returns {string} the same text with the same line breaks, every line redacted
 */
export function redactLog(text: string): string {
  if (text === '') return '';
  let toast = false;
  return text
    .split('\n')
    .map((line) => {
      if (RECORD_HEAD.test(line)) toast = TOAST_LINE.test(line);
      return redactLogLine(line, toast);
    })
    .join('\n');
}
