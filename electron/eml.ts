// Minimal RFC822/MIME reader: just enough to log a saved message — the main headers
// and a plain-text rendering of the body. Not a general MIME parser; attachments,
// signing and encryption are ignored and only text parts count.
//
// Header values may continue across lines (a continuation starts with a space or
// tab), RFC2047 "=?utf-8?B?...?=" words are decoded, and an unknown charset falls
// back to utf-8. Address lists split only on commas outside quotes and angle
// brackets, so "Vries, A." <a@x> stays one address. Body selection walks depth-first
// for the first non-empty text/plain part, then text/html stripped to text; emptiness
// is what makes it correct, since the epilogue after the closing boundary has no
// Content-Type and would otherwise pass for text/plain and beat the real html part.

export interface EmlHeaders {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  date: string | null;
  messageId: string;
}

const norm = (text: string) => text.replace(/\r\n/g, '\n');

function splitHeadAndBody(text: string): { head: string; body: string } {
  const t = norm(text);
  const i = t.indexOf('\n\n');
  if (i === -1) return { head: t, body: '' };
  return { head: t.slice(0, i), body: t.slice(i + 2) };
}

function unfold(head: string): string[] {
  const out: string[] = [];
  for (const line of head.split('\n')) {
    if (/^[ \t]/.test(line) && out.length > 0) out[out.length - 1] += ' ' + line.trim();
    else out.push(line);
  }
  return out;
}

function headerValue(lines: string[], name: string): string {
  const want = name.toLowerCase() + ':';
  for (const line of lines) {
    if (line.toLowerCase().startsWith(want)) return line.slice(want.length).trim();
  }
  return '';
}

function decodeBytes(buf: Buffer, charset: string): string {
  const cs = (charset || 'utf-8').toLowerCase().replace(/^["']|["']$/g, '');
  if (cs === 'utf-8' || cs === 'utf8' || cs === 'us-ascii' || cs === 'ascii') return buf.toString('utf8');
  try {
    return new TextDecoder(cs).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

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

export function decodeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, charset: string, enc: string, data: string) => {
    if (enc.toUpperCase() === 'B') return decodeBytes(Buffer.from(data, 'base64'), charset);
    return decodeQuotedPrintable(data.replace(/_/g, ' '), charset);
  });
}

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

function paramOf(headerLine: string, name: string): string {
  const m = new RegExp(`${name}\\s*=\\s*("[^"]*"|[^;\\s]+)`, 'i').exec(headerLine);
  return m ? m[1].replace(/^"|"$/g, '') : '';
}

const INVISIBLE = /&(zwnj|zwj|shy|lrm|rlm|#x?200[b-d]|#8203|#173);/gi;

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

function decodeBody(body: string, encoding: string, charset: string): string {
  const enc = encoding.toLowerCase();
  if (enc === 'base64') return decodeBytes(Buffer.from(body, 'base64'), charset);
  if (enc === 'quoted-printable') return decodeQuotedPrintable(body, charset);
  return decodeBytes(Buffer.from(body, 'binary'), charset);
}

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

export function extractPlainText(text: string): string {
  return findText(norm(text), 'plain') ?? findText(norm(text), 'html') ?? '';
}
