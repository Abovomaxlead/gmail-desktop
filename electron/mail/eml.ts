// Minimal RFC822/MIME reader: the main headers and a plain-text body, which is all a log
// line needs. Not a general parser — attachments, signing and encryption are ignored.
//
// Header values may continue across lines, RFC2047 encoded words are decoded, and an
// unknown charset falls back to utf-8.



//===========================
// Types
//===========================

export interface EmlHeaders {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  date: string | null;
  messageId: string;
}


//===========================
// Constants
//===========================

const INVISIBLE = /&(zwnj|zwj|shy|lrm|rlm|#x?200[b-d]|#8203|#173);/gi;


//===========================
// Exported functions
//===========================

/**
 * Reads the main headers out of a message
 *
 * @param text the raw RFC822 source
 * @returns the headers, decoded and with address lists split
 */
export function parseHeaders(text: string): EmlHeaders {
  const lines = unfold(splitHeadAndBody(text).head);
  const get = (n: string) => decodeWords(headerValue(lines, n));
  const raw = headerValue(lines, 'date');
  const ms = raw ? Date.parse(raw) : NaN;
  return {
    from: get('from'),
    to: splitAddresses(get('to')),
    cc: splitAddresses(get('cc')),
    subject: get('subject'),
    date: Number.isNaN(ms) ? null : new Date(ms).toISOString(),
    messageId: headerValue(lines, 'message-id'),
  };
}

/**
 * Renders a message body as plain text
 *
 * Walks depth-first for the first non-empty text/plain part, then falls back to
 * text/html stripped to text. Emptiness is what makes it correct: the epilogue after
 * the closing boundary has no Content-Type and would otherwise pass for text/plain and
 * beat the real html part.
 *
 * @param text the raw RFC822 source
 * @returns the text, or an empty string when no text part is usable
 */
export function extractPlainText(text: string): string {
  return findText(norm(text), 'plain') ?? findText(norm(text), 'html') ?? '';
}

/**
 * Decodes RFC2047 encoded words inside a header value
 *
 * @param s
 * @returns the value with every encoded word decoded
 */
export function decodeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, charset: string, enc: string, data: string) => {
    if (enc.toUpperCase() === 'B') return decodeBytes(Buffer.from(data, 'base64'), charset);
    return decodeQuotedPrintable(data.replace(/_/g, ' '), charset);
  });
}

/**
 * Strips HTML down to readable text
 *
 * @param html
 * @returns the text, entities resolved and blank runs collapsed
 */
export function htmlToText(html: string): string {
  return (
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(INVISIBLE, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/gi, '&')
      .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}


//===========================
// Helper functions
//===========================

const norm = (text: string) => text.replace(/\r\n/g, '\n');

/**
 * Splits a message or part at its blank line
 *
 * @param text
 * @returns the header block and the body
 * @private
 */
function splitHeadAndBody(text: string): { head: string; body: string } {
  const t = norm(text);
  const i = t.indexOf('\n\n');
  if (i === -1) return { head: t, body: '' };
  return { head: t.slice(0, i), body: t.slice(i + 2) };
}

/**
 * Joins header continuation lines onto the header they belong to
 *
 * @param head the header block
 * @returns one entry per header
 * @private
 */
function unfold(head: string): string[] {
  const out: string[] = [];
  for (const line of head.split('\n')) {
    if (/^[ \t]/.test(line) && out.length > 0) out[out.length - 1] += ' ' + line.trim();
    else out.push(line);
  }
  return out;
}

/**
 * Reads one header's value
 *
 * @param lines unfolded headers
 * @param name matched case-insensitively
 * @returns the value, or an empty string when the header is absent
 * @private
 */
function headerValue(lines: string[], name: string): string {
  const want = name.toLowerCase() + ':';
  for (const line of lines) {
    if (line.toLowerCase().startsWith(want)) return line.slice(want.length).trim();
  }
  return '';
}

/**
 * Decodes bytes in a named charset
 *
 * @param buf
 * @param charset an unknown one falls back to utf-8
 * @returns the text
 * @private
 */
function decodeBytes(buf: Buffer, charset: string): string {
  const cs = (charset || 'utf-8').toLowerCase().replace(/^["']|["']$/g, '');
  if (cs === 'utf-8' || cs === 'utf8' || cs === 'us-ascii' || cs === 'ascii') return buf.toString('utf8');
  try {
    return new TextDecoder(cs).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

/**
 * Decodes a quoted-printable body or encoded word
 *
 * @param s
 * @param charset
 * @returns the text, soft line breaks removed
 * @private
 */
function decodeQuotedPrintable(s: string, charset: string): string {
  const noSoftBreaks = s.replace(/=\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < noSoftBreaks.length; i++) {
    const c = noSoftBreaks[i];
    if (c === '=' && /^[0-9a-f]{2}$/i.test(noSoftBreaks.slice(i + 1, i + 3))) {
      bytes.push(parseInt(noSoftBreaks.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      for (const b of Buffer.from(c, 'binary')) bytes.push(b);
    }
  }
  return decodeBytes(Buffer.from(bytes), charset);
}


/**
 * Splits a header's address list
 *
 * @param value
 * @returns the addresses, empties dropped
 * @private
 */
function splitAddresses(value: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  let inAngle = false;
  for (const c of value) {
    if (c === '"') inQuote = !inQuote;
    else if (c === '<' && !inQuote) inAngle = true;
    else if (c === '>' && !inQuote) inAngle = false;
    if (c === ',' && !inQuote && !inAngle) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out.filter((a) => a.length > 0);
}

/**
 * Reads a parameter off a structured header line
 *
 * @param headerLine
 * @param name the parameter name, matched case-insensitively
 * @returns the value with quotes stripped, or an empty string
 * @private
 */
function paramOf(headerLine: string, name: string): string {
  const m = new RegExp(`${name}\\s*=\\s*("[^"]*"|[^;\\s]+)`, 'i').exec(headerLine);
  return m ? m[1].replace(/^"|"$/g, '') : '';
}

/**
 * Decodes a part's body according to its transfer encoding
 *
 * @param body
 * @param encoding
 * @param charset
 * @returns the text
 * @private
 */
function decodeBody(body: string, encoding: string, charset: string): string {
  const enc = encoding.toLowerCase();
  if (enc === 'base64') return decodeBytes(Buffer.from(body, 'base64'), charset);
  if (enc === 'quoted-printable') return decodeQuotedPrintable(body, charset);
  return decodeBytes(Buffer.from(body, 'binary'), charset);
}

/**
 * Walks a part depth-first for the first non-empty body of the wanted type
 *
 * @param part
 * @param want
 * @returns the text, or null when this part has none
 * @private
 */
function findText(part: string, want: 'plain' | 'html'): string | null {
  const { head, body } = splitHeadAndBody(part);
  const lines = unfold(head);
  const ctype = headerValue(lines, 'content-type');
  const enc = headerValue(lines, 'content-transfer-encoding');
  const charset = paramOf(ctype, 'charset') || 'utf-8';

  if (/^multipart\//i.test(ctype)) {
    const boundary = paramOf(ctype, 'boundary');
    if (!boundary) return null;
    const chunks = body.split(
      new RegExp(`^--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(--)?[ \t]*$`, 'm'),
    );
    for (const chunk of chunks.slice(1)) {
      if (chunk === undefined || chunk === '--') continue;
      const found = findText(chunk.replace(/^\n/, ''), want);
      if (found !== null) return found;
    }
    return null;
  }

  const isPlain = !ctype || /^text\/plain/i.test(ctype);
  const isHtml = /^text\/html/i.test(ctype);
  if (want === 'plain' && !isPlain) return null;
  if (want === 'html' && !isHtml) return null;
  const decoded = decodeBody(body, enc, charset);
  const out = want === 'html' ? htmlToText(decoded) : decoded.trim();
  return out === '' ? null : out;
}
