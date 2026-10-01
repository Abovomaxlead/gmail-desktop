// The RFC 822 message a crash report is sent as.
//
// Pure and apart from the sending, so the one thing that has to be exactly right about an
// automatic mail -- that it is a well-formed message with the logs actually inside it -- is
// provable without a network or a mailbox.
//
// Why a raw message rather than the compose URL feedback-mail.ts builds: an automatic report is
// not read by the person it happened to, so there is no compose window to open, and the 8 KB a
// Gmail URL holds is nowhere near a log. A raw message has no such ceiling, and it carries the
// logs as attachments, which is where a hundred kilobytes of log belongs.
//
// Everything is base64: a stack trace and a log are full of the characters quoted-printable
// exists to escape, and base64 has no line-length trap. The boundary is hex with a `-` in it,
// which base64 cannot contain, so no part can ever contain the boundary that ends it.

import { randomBytes } from 'node:crypto';

//===========================
// Types
//===========================

/** One file inside the message. `text` is already redacted -- this module never decides what
 * may leave the machine, see log-redact.ts. */
export interface MailAttachment {
  filename: string;
  text: string;
}

export interface RawMailInput {
  from: string;
  to: string;
  subject: string;
  body: string;
  attachments?: MailAttachment[];
  /** Injectable so a test gets the same bytes twice */
  boundary?: string;
  date?: Date;
}


//===========================
// Constants
//===========================

/** Where base64 lines are wrapped. RFC 2045 allows up to 76 characters and Gmail is not
 * forgiving about longer ones. */
const BASE64_LINE = 76;

const CRLF = '\r\n';


//===========================
// Exported functions
//===========================

/**
 * Builds the message to hand to Gmail's send endpoint
 *
 * @param input the headers, the body, and whatever rides along
 * @returns the whole message as bytes, CRLF line endings throughout
 */
export function buildRawMail(input: RawMailInput): Buffer {
  const boundary = input.boundary ?? `----gmail-desktop-${randomBytes(12).toString('hex')}`;
  const attachments = input.attachments ?? [];
  const date = input.date ?? new Date();
  const head = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodeHeaderWord(input.subject)}`,
    `Date: ${date.toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    'This is a MIME message.',
    '',
  ];

  const parts = [
    part(boundary, ['Content-Type: text/plain; charset="UTF-8"'], input.body),
    ...attachments.map((a) =>
      part(
        boundary,
        [
          `Content-Type: text/plain; charset="UTF-8"; name="${asciiName(a.filename)}"`,
          `Content-Disposition: attachment; filename="${asciiName(a.filename)}"`,
        ],
        a.text,
      ),
    ),
  ];

  return Buffer.from(
    `${head.join(CRLF)}${parts.join('')}--${boundary}--${CRLF}`,
    'utf8',
  );
}

/**
 * A header value that may hold anything, written the way a header may
 *
 * Left alone when it is plain ASCII, because an encoded word where none is needed makes a
 * subject unreadable in every mail client's list view.
 *
 * @param text
 * @returns the value, base64 encoded-word when it has to be
 */
export function encodeHeaderWord(text: string): string {
  const flat = text.replace(/[\r\n]+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex
  if (!/[^\x20-\x7e]/.test(flat)) return flat;
  return `=?UTF-8?B?${Buffer.from(flat, 'utf8').toString('base64')}?=`;
}


//===========================
// Helper functions
//===========================

/**
 * One part of the message, headers and base64 content
 *
 * @param boundary
 * @param headers the part's own, without the transfer encoding
 * @param text
 * @returns the part, starting with its boundary line
 * @private
 */
function part(boundary: string, headers: string[], text: string): string {
  const lines = [`--${boundary}`, ...headers, 'Content-Transfer-Encoding: base64', ''];
  return `${lines.join(CRLF)}${CRLF}${wrap(Buffer.from(text, 'utf8').toString('base64'))}${CRLF}`;
}

/**
 * Base64 broken into lines a mail server accepts
 *
 * @param base64
 * @returns the same characters with CRLF every BASE64_LINE
 * @private
 */
function wrap(base64: string): string {
  const lines: string[] = [];
  for (let at = 0; at < base64.length; at += BASE64_LINE) {
    lines.push(base64.slice(at, at + BASE64_LINE));
  }
  return lines.join(CRLF);
}

/**
 * A filename a header can carry without quoting rules
 *
 * @param name
 * @returns the name with anything but plain characters replaced, never empty
 * @private
 */
function asciiName(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9._-]/g, '_');
  return clean === '' ? 'attachment.txt' : clean;
}
