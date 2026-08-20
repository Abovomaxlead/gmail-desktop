// Many small Gmail reads in one HTTP request. Split off from gmail-api.ts because it is all
// string work and testable without a network.
//
// Why this is the lever that matters: a drag of a hundred rows was measured at roughly 742
// requests over 47 seconds while using about a third of the quota it was allowed. It was never
// short of budget, it was short of round trips. A batch does not buy a single quota unit -- n
// calls in a batch count as n calls -- it buys the waiting.
//
// What cannot go in one: media uploads. `messages.insert` goes to the upload endpoint with
// `uploadType=multipart`, and Google's own libraries refuse those inside a batch. That leg is
// bandwidth anyway -- the mail's bytes go up once per target mailbox whatever wraps them -- so
// there was nothing to win there. This is for the reading.
//
// Two things about the answer are easy to get wrong. The parts may come back in any order, so
// each request names itself with a Content-ID and the answer is matched on that name. And each
// part is a whole HTTP response of its own, status included: one part failing says nothing
// about the others, and reading a 404 part as data would be worse than not batching at all.


//===========================
// Types
//===========================

/** One answer out of a batch: its request's name, the status that part came back with, and
 * the parsed body when there was one to parse. */
export interface BatchPart {
  id: string;
  status: number;
  json: unknown;
}


//===========================
// Constants
//===========================

/** The Gmail-only batch endpoint. The global `www.googleapis.com/batch` was switched off in
 * 2020; per-API paths like this one stayed. */
export const BATCH_URL = 'https://gmail.googleapis.com/batch/gmail/v1';

/** Google allows a hundred calls in a batch and advises against more than fifty. */
export const BATCH_LIMIT = 50;

/** For `format=raw`, where a part is a whole mail with its attachments. Fifty of those is a
 * response of hundreds of megabytes against a thirty second timeout, so these go in small
 * groups: the round trips still collapse by an order of magnitude. */
export const RAW_BATCH_LIMIT = 10;

const CRLF = '\r\n';


//===========================
// Exported functions
//===========================

/**
 * The path form an inner request needs
 *
 * @param url a full Gmail API URL, or a path already
 * @returns the path with its query, since a batch part may not carry the host
 */
export function batchPath(url: string): string {
  if (url.startsWith('/')) return url;
  const at = url.indexOf('/', url.indexOf('://') + 3);
  return at === -1 ? url : url.slice(at);
}

/**
 * Wraps a set of reads into one multipart body
 *
 * No Authorization on the parts: the outer request's headers apply to every one of them, and
 * repeating the token per part would only make the request bigger.
 *
 * @param paths the inner requests, already in path form
 * @param boundary
 * @returns the body to POST
 */
export function batchBody(paths: string[], boundary: string): string {
  const parts = paths.map(
    (path, i) =>
      `--${boundary}${CRLF}` +
      `Content-Type: application/http${CRLF}` +
      `Content-ID: <${i}>${CRLF}${CRLF}` +
      `GET ${path} HTTP/1.1${CRLF}${CRLF}`,
  );
  return parts.join('') + `--${boundary}--${CRLF}`;
}

/**
 * Reads the boundary out of the answer's content type
 *
 * @param contentType
 * @returns the boundary, empty when this is not a multipart answer — which is how a batch that
 *   was refused outright arrives, and the caller has to treat that as the whole batch failing
 */
export function boundaryFrom(contentType: string | undefined | null): string {
  const match = /boundary="?([^";]+)"?/i.exec(contentType ?? '');
  return match ? match[1].trim() : '';
}

/**
 * Takes the answer apart into one entry per inner request
 *
 * @param body the multipart body Google answered with
 * @param boundary from boundaryFrom
 * @returns one part per answer that could be read, in the order they arrived; a part whose
 *   status is an error keeps a null body, so a caller cannot mistake it for data
 */
export function parseBatchBody(body: string, boundary: string): BatchPart[] {
  if (!body || !boundary) return [];
  const out: BatchPart[] = [];
  for (const chunk of body.split(`--${boundary}`)) {
    const part = readPart(chunk);
    if (part) out.push(part);
  }
  return out;
}


/**
 * Whether a batch answered so badly that the one-by-one path is worth taking instead
 *
 * A safety valve, not an optimisation: if Google's multipart answer turns out not to parse the
 * way this file expects, every part comes back empty and nothing else in the app would notice.
 * Falling back then costs the requests batching was meant to save and gets the right answer.
 *
 * @param answers what requestBatch made of the reply
 * @returns true when answers were asked for and none arrived
 */
export function batchLooksBroken(answers: Array<unknown | null>): boolean {
  return answers.length > 0 && answers.every((a) => a === null);
}


//===========================
// Helper functions
//===========================

/**
 * Reads one part: its name, then the HTTP response inside it
 *
 * @param chunk one piece of the split body
 * @returns {null} for the preamble, the closing marker, and anything without a status line
 * @private
 */
function readPart(chunk: string): BatchPart | null {
  const id = /Content-ID:\s*<?(?:response-)?([^>\s]+)>?/i.exec(chunk)?.[1] ?? '';
  if (!id) return null;

  // The part's own headers end at the first blank line; what follows is a whole HTTP response,
  // whose headers end at the next one. Everything after that is the body, blank lines and all.
  const afterPartHeaders = splitOnce(chunk);
  if (afterPartHeaders === null) return null;
  const status = Number(/^HTTP\/[\d.]+\s+(\d{3})/m.exec(afterPartHeaders)?.[1] ?? 0);
  if (!status) return null;

  const body = splitOnce(afterPartHeaders);
  let json: unknown = null;
  if (status < 400 && body !== null) {
    try {
      json = JSON.parse(body.trim());
    } catch {
      json = null;
    }
  }
  return { id, status, json };
}

/**
 * What comes after the first blank line
 *
 * @param text
 * @returns {null} when there is no blank line at all
 * @private
 */
function splitOnce(text: string): string | null {
  const at = text.search(/\r?\n\r?\n/);
  if (at === -1) return null;
  return text.slice(at).replace(/^\r?\n\r?\n/, '');
}
