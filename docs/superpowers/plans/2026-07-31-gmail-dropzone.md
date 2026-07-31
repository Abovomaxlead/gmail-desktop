# Gmail Dropzone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een dropzone bovenaan de Gmail-view waar je een conversatie naartoe sleept; de app slaat elk bericht op als `.eml` in een instelbare map en schrijft per bericht een regel naar `log.jsonl`.

**Architecture:** De dropzone wordt door de bestaande preload in de Gmail-pagina zelf geïnjecteerd (drag & drop kan niet tussen twee Electron-views). Bij een drop stuurt de pagina `{threadId, authuser, ik}` naar het main-proces, dat met de Gmail-sessiecookies Gmail's eigen "origineel weergeven"-pagina (`view=om`) ophaalt, daaruit de download-links van de originele berichten vist, die als `.eml` wegschrijft en de headers plus de body-tekst naar een JSONL-log appendt.

**Tech Stack:** TypeScript, Electron 31 (`WebContentsView`, `net.request`, `session.fromPartition`), Next.js 14 static export voor de sidebar, Vitest (node-omgeving, geen jsdom), esbuild.

Spec: `docs/superpowers/specs/2026-07-31-gmail-dropzone-design.md`

## Global Constraints

- **Geen git.** Deze map is géén git-repo. Waar dit plan normaal een commit zou doen, eindigt een taak met `npm test` (volledige suite groen). Nooit `git`-commando's draaien.
- **Node >= 22, npm >= 10** (`package.json` `engines`).
- **Tests draaien in de node-omgeving, zonder jsdom** (`vitest.config.ts`). Elke geteste functie moet daarom werken op gewone objecten — nooit `document`, `Element.closest`, `DOMParser` of `window` in getest code.
- **Testbestanden staan in `tests/`** en heten `<module>.test.ts`; ze importeren uit `../electron/<module>`.
- **Pure modules in `electron/` importeren nooit `electron`.** Alleen `main.ts`, `preload.ts`, `profile-view-manager.ts` en `sidebar-preload.ts` mogen dat. Zo blijven de modules onder Vitest importeerbaar.
- **Sessiepartitie is `'persist:google'`** (zie `electron/profile-view-manager.ts:24`).
- **Alle UI-tekst in de sidebar gaat via `renderer/app/strings.ts`**, in beide varianten: `STRINGS_NORMAL` (Engels) en `STRINGS_RENE` (simpel Nederlands, korte woorden). Nooit letterlijke tekst in `SettingsPanel.tsx`.
- **Tekst in de dropzone zelf is Nederlands** en staat hardcoded in `electron/dropzone.ts` — die strip zit in de Gmail-pagina, niet in de sidebar, en heeft geen toegang tot `strings.ts`.
- **De preload draait met `contextIsolation: false`** en deelt dus `window` met de Gmail-pagina.

## File Structure

**Nieuw (puur, getest):**

| Bestand | Verantwoordelijkheid |
|---|---|
| `electron/eml.ts` | RFC822 lezen: headers parsen + body als platte tekst |
| `electron/mail-archive.ts` | Bestandsnamen bouwen, `.eml`'s wegschrijven, JSONL appenden |
| `electron/mail-fetch.ts` | URL's bouwen, om-pagina parsen; plus de `net.request`-wrapper |
| `electron/dropzone.ts` | Strip-HTML/CSS als string + drag-doel-, authuser- en `ik`-herkenning |

**Nieuw (tests):** `tests/eml.test.ts`, `tests/mail-archive.test.ts`, `tests/mail-fetch.test.ts`, `tests/dropzone.test.ts`

**Aangepast:**

| Bestand | Wijziging |
|---|---|
| `electron/ipc.ts` | 5 kanalen erbij + payloadtypes |
| `electron/preload.ts` | Strip injecteren, drag-listeners, resultaat tonen |
| `electron/profile-view-manager.ts` | `onMailDrop`-callback + `sendDropResult()` |
| `electron/main.ts` | Drop afhandelen, map resolven, 3 `ipcMain`-handlers |
| `electron/prefs-store.ts` | `mailDrop.folder` |
| `electron/sidebar-preload.ts` | 3 bridge-methodes |
| `renderer/app/page.tsx` | `Prefs`- en `DesktopBridge`-types, prop doorgeven |
| `renderer/app/SettingsPanel.tsx` | Maprij in sectie Algemeen |
| `renderer/app/strings.ts` | 4 strings × 2 varianten |

---

### Task 1: `electron/eml.ts` — headers en platte tekst uit een `.eml`

**Files:**
- Create: `electron/eml.ts`
- Test: `tests/eml.test.ts`

**Interfaces:**
- Consumes: niets.
- Produces:
  - `interface EmlHeaders { from: string; to: string[]; cc: string[]; subject: string; date: string | null; messageId: string }`
  - `parseHeaders(text: string): EmlHeaders`
  - `extractPlainText(text: string): string`

- [ ] **Step 1: Write the failing test**

Maak `tests/eml.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseHeaders, extractPlainText } from '../electron/eml';

const SIMPLE = [
  'Delivered-To: luca@example.com',
  'Message-ID: <CAF123@mail.gmail.com>',
  'Date: Wed, 29 Jul 2026 10:02:44 +0200',
  'From: Jan de Vries <jan@example.com>',
  'To: Luca Manuel <luca@example.com>, Piet <piet@example.com>',
  'Cc: "Vries, A." <a@example.com>',
  'Subject: Offerte week 31',
  'Content-Type: text/plain; charset="UTF-8"',
  '',
  'Hoi Luca,',
  '',
  'Bijgaand de offerte.',
  '',
].join('\r\n');

describe('parseHeaders', () => {
  it('reads the main headers', () => {
    const h = parseHeaders(SIMPLE);
    expect(h.from).toBe('Jan de Vries <jan@example.com>');
    expect(h.subject).toBe('Offerte week 31');
    expect(h.messageId).toBe('<CAF123@mail.gmail.com>');
    expect(h.date).toBe('2026-07-29T08:02:44.000Z');
  });

  it('splits To and Cc into addresses, ignoring commas inside quotes', () => {
    const h = parseHeaders(SIMPLE);
    expect(h.to).toEqual(['Luca Manuel <luca@example.com>', 'Piet <piet@example.com>']);
    expect(h.cc).toEqual(['"Vries, A." <a@example.com>']);
  });

  it('unfolds a header that continues on the next line', () => {
    const raw = 'Subject: Offerte\r\n week 31 definitief\r\nFrom: a@b.c\r\n\r\nbody';
    expect(parseHeaders(raw).subject).toBe('Offerte week 31 definitief');
  });

  it('decodes RFC2047 base64 and quoted-printable words', () => {
    const b64 = 'Subject: =?utf-8?B?T2ZmZXJ0ZSDigJQgd2VlayAzMQ==?=\r\n\r\nx';
    expect(parseHeaders(b64).subject).toBe('Offerte — week 31');
    const qp = 'Subject: =?utf-8?Q?Caf=C3=A9_bezoek?=\r\n\r\nx';
    expect(parseHeaders(qp).subject).toBe('Café bezoek');
  });

  it('returns null for a missing or unparseable Date', () => {
    expect(parseHeaders('From: a@b.c\r\n\r\nx').date).toBeNull();
    expect(parseHeaders('Date: gisteren\r\n\r\nx').date).toBeNull();
  });

  it('is case-insensitive on header names and defaults missing fields', () => {
    const h = parseHeaders('sUbJeCt: Hallo\r\n\r\nx');
    expect(h.subject).toBe('Hallo');
    expect(h.from).toBe('');
    expect(h.to).toEqual([]);
    expect(h.cc).toEqual([]);
    expect(h.messageId).toBe('');
  });
});

describe('extractPlainText', () => {
  it('returns the body of a plain text message', () => {
    expect(extractPlainText(SIMPLE)).toBe('Hoi Luca,\n\nBijgaand de offerte.');
  });

  it('decodes quoted-printable, including soft line breaks', () => {
    const raw = [
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Caf=C3=A9 met een hele lange regel die door=',
      'loopt.',
      '',
    ].join('\r\n');
    expect(extractPlainText(raw)).toBe('Café met een hele lange regel die doorloopt.');
  });

  it('decodes base64', () => {
    const raw = [
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('Hallo wereld', 'utf8').toString('base64'),
      '',
    ].join('\r\n');
    expect(extractPlainText(raw)).toBe('Hallo wereld');
  });

  it('decodes iso-8859-1 and falls back to utf-8 for an unknown charset', () => {
    const latin = Buffer.concat([
      Buffer.from('Content-Type: text/plain; charset=iso-8859-1\r\n\r\nCaf', 'ascii'),
      Buffer.from([0xe9]),
    ]).toString('binary');
    expect(extractPlainText(latin)).toBe('Café');
    expect(extractPlainText('Content-Type: text/plain; charset=klingon\r\n\r\nHoi')).toBe('Hoi');
  });

  it('picks the text/plain part of a multipart/alternative message', () => {
    const raw = [
      'Content-Type: multipart/alternative; boundary="B1"',
      '',
      '--B1',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>HTML versie</p>',
      '--B1',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Tekst versie',
      '--B1--',
      '',
    ].join('\r\n');
    expect(extractPlainText(raw)).toBe('Tekst versie');
  });

  it('finds text/plain nested inside a multipart/mixed wrapper', () => {
    const raw = [
      'Content-Type: multipart/mixed; boundary="OUT"',
      '',
      '--OUT',
      'Content-Type: multipart/alternative; boundary="IN"',
      '',
      '--IN',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Genest',
      '--IN--',
      '--OUT--',
      '',
    ].join('\r\n');
    expect(extractPlainText(raw)).toBe('Genest');
  });

  it('falls back to html stripped to text when there is no text/plain part', () => {
    const raw = [
      'Content-Type: text/html; charset=utf-8',
      '',
      '<style>p{color:red}</style><p>Hoi&nbsp;Luca</p><br><div>Tot &amp; met vrijdag</div>',
      '',
    ].join('\r\n');
    expect(extractPlainText(raw)).toBe('Hoi Luca\n\nTot & met vrijdag');
  });

  it('returns an empty string for a message with no body', () => {
    expect(extractPlainText('Subject: leeg\r\n\r\n')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/eml.test.ts`
Expected: FAIL — `Failed to resolve import "../electron/eml"`.

- [ ] **Step 3: Write the implementation**

Maak `electron/eml.ts`:

```ts
// Minimale RFC822/MIME-lezer: precies genoeg om een opgeslagen bericht te
// kunnen loggen — de belangrijkste headers en een platte-tekstweergave van de
// body. Geen algemene MIME-parser: bijlagen, ondertekening en versleuteling
// worden genegeerd, alleen tekstdelen tellen mee.

export interface EmlHeaders {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  date: string | null; // ISO 8601, of null als de Date-header ontbreekt/onleesbaar is
  messageId: string;
}

const norm = (text: string) => text.replace(/\r\n/g, '\n');

function splitHeadAndBody(text: string): { head: string; body: string } {
  const t = norm(text);
  const i = t.indexOf('\n\n');
  if (i === -1) return { head: t, body: '' };
  return { head: t.slice(0, i), body: t.slice(i + 2) };
}

// Headers mogen over meerdere regels lopen: een vervolgregel begint met een
// spatie of tab en hoort bij de vorige.
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
    // Onbekende charset: utf-8 is de minst schadelijke gok.
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
      // Al gedecodeerde tekens kunnen zelf uit meerdere bytes bestaan.
      for (const b of Buffer.from(c, 'binary')) bytes.push(b);
    }
  }
  return decodeBytes(Buffer.from(bytes), charset);
}

// RFC2047: "=?utf-8?B?...?=" en "=?utf-8?Q?...?=" in headerwaarden.
export function decodeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, charset: string, enc: string, data: string) => {
    if (enc.toUpperCase() === 'B') return decodeBytes(Buffer.from(data, 'base64'), charset);
    return decodeQuotedPrintable(data.replace(/_/g, ' '), charset);
  });
}

// Splitst een adreslijst op komma's die buiten aanhalingstekens en punthaken
// staan — "Vries, A." <a@x> is één adres, geen twee.
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

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeBody(body: string, encoding: string, charset: string): string {
  const enc = encoding.toLowerCase();
  if (enc === 'base64') return decodeBytes(Buffer.from(body, 'base64'), charset);
  if (enc === 'quoted-printable') return decodeQuotedPrintable(body, charset);
  return decodeBytes(Buffer.from(body, 'binary'), charset);
}

// Zoekt diepte-eerst naar het eerste text/plain-deel. Levert dat niets op, dan
// het eerste text/html-deel, tot tekst gestript.
function findText(part: string, want: 'plain' | 'html'): string | null {
  const { head, body } = splitHeadAndBody(part);
  const lines = unfold(head);
  const ctype = headerValue(lines, 'content-type');
  const enc = headerValue(lines, 'content-transfer-encoding');
  const charset = paramOf(ctype, 'charset') || 'utf-8';

  if (/^multipart\//i.test(ctype)) {
    const boundary = paramOf(ctype, 'boundary');
    if (!boundary) return null;
    const chunks = body.split(new RegExp(`^--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(--)?[ \t]*$`, 'm'));
    // Het eerste stuk is de preamble vóór de eerste boundary — die telt niet mee.
    for (const chunk of chunks.slice(1)) {
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
  return want === 'html' ? htmlToText(decoded) : decoded.trim();
}

export function extractPlainText(text: string): string {
  return findText(norm(text), 'plain') ?? findText(norm(text), 'html') ?? '';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/eml.test.ts`
Expected: PASS — 15 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: alle bestaande tests plus de nieuwe zijn groen. (Geen commit: dit is geen git-repo.)

---

### Task 2: `electron/mail-archive.ts` — bestandsnamen, `.eml` wegschrijven, JSONL appenden

**Files:**
- Create: `electron/mail-archive.ts`
- Test: `tests/mail-archive.test.ts`

**Interfaces:**
- Consumes: `EmlHeaders` uit `electron/eml.ts` (Task 1).
- Produces:
  - `interface SavedMessage { raw: Buffer; headers: EmlHeaders }`
  - `interface LogRecord { ts: string; account: string; threadId: string; messageId?: string; from?: string; to?: string[]; cc?: string[]; subject?: string; date?: string | null; file?: string; bytes?: number; body?: string; error?: string }`
  - `safeName(s: string, fallback?: string): string`
  - `displayName(address: string): string`
  - `threadFolderName(dropIso: string, first: EmlHeaders): string`
  - `messageFileName(index: number, h: EmlHeaders, fallbackIso: string): string`
  - `writeThread(root: string, dropIso: string, messages: SavedMessage[]): string[]` — geeft paden relatief aan `root`, met `/` als scheidingsteken
  - `appendLog(root: string, records: LogRecord[]): void`

- [ ] **Step 1: Write the failing test**

Maak `tests/mail-archive.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  safeName,
  displayName,
  threadFolderName,
  messageFileName,
  writeThread,
  appendLog,
} from '../electron/mail-archive';
import type { EmlHeaders } from '../electron/eml';

const root = () => mkdtempSync(join(tmpdir(), 'maildrop-'));

const headers = (over: Partial<EmlHeaders> = {}): EmlHeaders => ({
  from: 'Jan de Vries <jan@example.com>',
  to: ['luca@example.com'],
  cc: [],
  subject: 'Offerte week 31',
  date: '2026-07-29T08:02:44.000Z',
  messageId: '<CAF123@mail.gmail.com>',
  ...over,
});

describe('safeName', () => {
  it('strips characters Windows forbids in a filename', () => {
    expect(safeName('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
  });
  it('collapses whitespace and trims trailing dots and spaces', () => {
    expect(safeName('  veel    ruimte  ...  ')).toBe('veel ruimte');
  });
  it('truncates to 60 characters', () => {
    expect(safeName('x'.repeat(200))).toHaveLength(60);
  });
  it('returns the fallback when nothing is left', () => {
    expect(safeName('///', 'onbekend')).toBe('onbekend');
    expect(safeName('')).toBe('onbekend');
  });
  it('keeps non-ascii characters', () => {
    expect(safeName('Café — offerte 🎉')).toBe('Café — offerte 🎉');
  });
});

describe('displayName', () => {
  it('takes the name in front of the angle brackets', () => {
    expect(displayName('Jan de Vries <jan@example.com>')).toBe('Jan de Vries');
  });
  it('unquotes a quoted name', () => {
    expect(displayName('"Vries, A." <a@example.com>')).toBe('Vries, A.');
  });
  it('falls back to the bare address', () => {
    expect(displayName('jan@example.com')).toBe('jan@example.com');
    expect(displayName('<jan@example.com>')).toBe('jan@example.com');
  });
  it('returns an empty string for an empty address', () => {
    expect(displayName('')).toBe('');
  });
});

describe('name building', () => {
  it('builds the thread folder from the drop time and the first message', () => {
    expect(threadFolderName('2026-07-31T12:32:10.412Z', headers())).toBe(
      '2026-07-31_1232_Jan de Vries_Offerte week 31',
    );
  });
  it('builds a message name from the message own date, numbered from 01', () => {
    expect(messageFileName(0, headers(), '2026-07-31T12:32:10.412Z')).toBe(
      '01_2026-07-29_0802_Jan de Vries_Offerte week 31.eml',
    );
  });
  it('uses the drop time when the message has no date', () => {
    expect(messageFileName(1, headers({ date: null }), '2026-07-31T12:32:10.412Z')).toBe(
      '02_2026-07-31_1232_Jan de Vries_Offerte week 31.eml',
    );
  });
  it('falls back for a missing sender and subject', () => {
    expect(messageFileName(0, headers({ from: '', subject: '' }), '2026-07-31T12:32:10.412Z')).toBe(
      '01_2026-07-29_0802_onbekend_geen onderwerp.eml',
    );
  });
});

describe('writeThread', () => {
  it('writes every message into one folder and returns relative paths', () => {
    const dir = root();
    const paths = writeThread(dir, '2026-07-31T12:32:10.412Z', [
      { raw: Buffer.from('EEN'), headers: headers() },
      { raw: Buffer.from('TWEE'), headers: headers({ subject: 'RE: Offerte week 31' }) },
    ]);
    expect(paths).toEqual([
      '2026-07-31_1232_Jan de Vries_Offerte week 31/01_2026-07-29_0802_Jan de Vries_Offerte week 31.eml',
      '2026-07-31_1232_Jan de Vries_Offerte week 31/02_2026-07-29_0802_Jan de Vries_RE Offerte week 31.eml',
    ]);
    expect(readFileSync(join(dir, paths[0]), 'utf8')).toBe('EEN');
    expect(readFileSync(join(dir, paths[1]), 'utf8')).toBe('TWEE');
  });

  it('uses a folder even for a single message', () => {
    const dir = root();
    writeThread(dir, '2026-07-31T12:32:10.412Z', [{ raw: Buffer.from('X'), headers: headers() }]);
    expect(readdirSync(dir)).toEqual(['2026-07-31_1232_Jan de Vries_Offerte week 31']);
  });

  it('suffixes the folder when the name is already taken', () => {
    const dir = root();
    mkdirSync(join(dir, '2026-07-31_1232_Jan de Vries_Offerte week 31'));
    const paths = writeThread(dir, '2026-07-31T12:32:10.412Z', [
      { raw: Buffer.from('X'), headers: headers() },
    ]);
    expect(paths[0].startsWith('2026-07-31_1232_Jan de Vries_Offerte week 31-2/')).toBe(true);
  });

  it('creates the root folder when it does not exist yet', () => {
    const dir = join(root(), 'nog', 'niet', 'bestaand');
    const paths = writeThread(dir, '2026-07-31T12:32:10.412Z', [
      { raw: Buffer.from('X'), headers: headers() },
    ]);
    expect(readFileSync(join(dir, paths[0]), 'utf8')).toBe('X');
  });
});

describe('appendLog', () => {
  it('writes one JSON object per line', () => {
    const dir = root();
    appendLog(dir, [
      { ts: '2026-07-31T12:32:10.412Z', account: 'a@b.c', threadId: 't1', subject: 'Een' },
      { ts: '2026-07-31T12:32:10.412Z', account: 'a@b.c', threadId: 't1', subject: 'Twee' },
    ]);
    const lines = readFileSync(join(dir, 'log.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).subject).toBe('Twee');
  });

  it('appends without touching existing lines', () => {
    const dir = root();
    writeFileSync(join(dir, 'log.jsonl'), '{"ts":"eerder"}\n', 'utf8');
    appendLog(dir, [{ ts: 'nu', account: 'a@b.c', threadId: 't1' }]);
    const lines = readFileSync(join(dir, 'log.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(lines[0]).ts).toBe('eerder');
    expect(JSON.parse(lines[1]).ts).toBe('nu');
  });

  it('escapes newlines in the body so one record stays one line', () => {
    const dir = root();
    appendLog(dir, [{ ts: 'nu', account: 'a@b.c', threadId: 't1', body: 'regel1\nregel2' }]);
    const lines = readFileSync(join(dir, 'log.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).body).toBe('regel1\nregel2');
  });

  it('does nothing for an empty record list', () => {
    const dir = root();
    appendLog(dir, []);
    expect(readdirSync(dir)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mail-archive.test.ts`
Expected: FAIL — `Failed to resolve import "../electron/mail-archive"`.

- [ ] **Step 3: Write the implementation**

Maak `electron/mail-archive.ts`:

```ts
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EmlHeaders } from './eml';

export interface SavedMessage {
  raw: Buffer;
  headers: EmlHeaders;
}

// Eén regel in log.jsonl. Bij een fout ontbreken file/bytes/body en staat er
// `error` in, met wat er wél bekend was.
export interface LogRecord {
  ts: string;
  account: string;
  threadId: string;
  messageId?: string;
  from?: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  date?: string | null;
  file?: string;
  bytes?: number;
  body?: string;
  error?: string;
}

const MAX_NAME = 60;

export function safeName(s: string, fallback = 'onbekend'): string {
  const cleaned = (s || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME)
    // Windows accepteert geen naam die op een punt of spatie eindigt.
    .replace(/[. ]+$/, '');
  return cleaned || fallback;
}

export function displayName(address: string): string {
  const a = (address || '').trim();
  if (!a) return '';
  const lt = a.indexOf('<');
  if (lt === -1) return a;
  const name = a.slice(0, lt).trim().replace(/^"|"$/g, '');
  if (name) return name;
  return a.slice(lt + 1).replace(/>.*$/, '').trim();
}

// "2026-07-29T08:02:44.000Z" -> { date: "2026-07-29", time: "0802" }, in UTC —
// dezelfde tijdzone als de ISO-stempel in het log, zodat map en logregel matchen.
function stamp(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    time: `${p(d.getUTCHours())}${p(d.getUTCMinutes())}`,
  };
}

export function threadFolderName(dropIso: string, first: EmlHeaders): string {
  const { date, time } = stamp(dropIso);
  const who = safeName(displayName(first.from));
  const what = safeName(first.subject, 'geen onderwerp');
  return `${date}_${time}_${who}_${what}`;
}

export function messageFileName(index: number, h: EmlHeaders, fallbackIso: string): string {
  const { date, time } = stamp(h.date ?? fallbackIso);
  const who = safeName(displayName(h.from));
  const what = safeName(h.subject, 'geen onderwerp');
  return `${String(index + 1).padStart(2, '0')}_${date}_${time}_${who}_${what}.eml`;
}

function uniqueDir(root: string, name: string): string {
  if (!existsSync(join(root, name))) return name;
  for (let n = 2; n < 1000; n++) {
    if (!existsSync(join(root, `${name}-${n}`))) return `${name}-${n}`;
  }
  return `${name}-${Date.now()}`;
}

export function writeThread(root: string, dropIso: string, messages: SavedMessage[]): string[] {
  if (messages.length === 0) return [];
  mkdirSync(root, { recursive: true });
  const folder = uniqueDir(root, threadFolderName(dropIso, messages[0].headers));
  mkdirSync(join(root, folder), { recursive: true });
  return messages.map((m, i) => {
    const file = messageFileName(i, m.headers, dropIso);
    writeFileSync(join(root, folder, file), m.raw);
    return `${folder}/${file}`;
  });
}

export function appendLog(root: string, records: LogRecord[]): void {
  if (records.length === 0) return;
  mkdirSync(root, { recursive: true });
  appendFileSync(join(root, 'log.jsonl'), records.map((r) => JSON.stringify(r) + '\n').join(''), 'utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mail-archive.test.ts`
Expected: PASS — 17 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: alles groen.

---

### Task 3: `electron/mail-fetch.ts` — URL's bouwen, om-pagina parsen, originelen ophalen

De "origineel weergeven"-pagina van Gmail (`view=om`) bevat per bericht een
download-link (`view=att…&disp=comp`). Bij een conversatie met meerdere
berichten kan die pagina óf meteen alle links bevatten, óf alleen de link van
één bericht plus verwijzingen (`permmsgid=msg-f:…`) naar de andere. Beide
vormen worden afgevangen: eerst de links van de threadpagina, daarna voor elke
nog niet gedekte `permmsgid` diens eigen om-pagina.

**Files:**
- Create: `electron/mail-fetch.ts`
- Test: `tests/mail-fetch.test.ts`

**Interfaces:**
- Consumes: niets.
- Produces:
  - `interface DropPayload { threadId: string; authuser: string; ik: string }`
  - `interface FetchedMessage { raw?: Buffer; error?: string }`
  - `omUrl(p: DropPayload & { permMsgId?: string }): string`
  - `parseOriginalLinks(html: string, authuser: string): string[]`
  - `parsePermMsgIds(html: string): string[]`
  - `fetchThreadEmls(ses: Session, p: DropPayload): Promise<FetchedMessage[]>`

- [ ] **Step 1: Write the failing test**

Maak `tests/mail-fetch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { omUrl, parseOriginalLinks, parsePermMsgIds } from '../electron/mail-fetch';

describe('omUrl', () => {
  it('builds the show-original url for a thread', () => {
    expect(omUrl({ authuser: '2', ik: 'abc123', threadId: '18f2a' })).toBe(
      'https://mail.google.com/mail/u/2/?ik=abc123&view=om&th=18f2a',
    );
  });
  it('adds permmsgid when given, url-encoded', () => {
    expect(omUrl({ authuser: '0', ik: 'abc', threadId: 't', permMsgId: 'msg-f:123' })).toBe(
      'https://mail.google.com/mail/u/0/?ik=abc&view=om&th=t&permmsgid=msg-f%3A123',
    );
  });
});

describe('parseOriginalLinks', () => {
  it('finds download-original links and makes them absolute', () => {
    const html = `<a href="?view=att&amp;th=18f2a&amp;attid=0&amp;disp=comp&amp;safe=1&amp;zw">Download</a>`;
    expect(parseOriginalLinks(html, '2')).toEqual([
      'https://mail.google.com/mail/u/2/?view=att&th=18f2a&attid=0&disp=comp&safe=1&zw',
    ]);
  });

  it('keeps an already absolute link as is', () => {
    const html = `<a href="https://mail.google.com/mail/u/0/?view=att&amp;th=x&amp;disp=comp">Download</a>`;
    expect(parseOriginalLinks(html, '0')).toEqual([
      'https://mail.google.com/mail/u/0/?view=att&th=x&disp=comp',
    ]);
  });

  it('returns every link in page order without duplicates', () => {
    const html = `
      <a href="?view=att&amp;th=a&amp;disp=comp">1</a>
      <a href="?view=att&amp;th=b&amp;disp=comp">2</a>
      <a href="?view=att&amp;th=a&amp;disp=comp">1 nogmaals</a>`;
    expect(parseOriginalLinks(html, '0')).toEqual([
      'https://mail.google.com/mail/u/0/?view=att&th=a&disp=comp',
      'https://mail.google.com/mail/u/0/?view=att&th=b&disp=comp',
    ]);
  });

  it('ignores attachment links that are not the original message', () => {
    const html = `<a href="?view=att&amp;th=a&amp;attid=0.1&amp;disp=inline">plaatje</a>`;
    expect(parseOriginalLinks(html, '0')).toEqual([]);
  });

  it('returns an empty list for html without links', () => {
    expect(parseOriginalLinks('<html><body>niets</body></html>', '0')).toEqual([]);
  });
});

describe('parsePermMsgIds', () => {
  it('collects message ids in page order without duplicates', () => {
    const html = `permmsgid=msg-f%3A111 ... permmsgid=msg-f:222 ... permmsgid=msg-f:111`;
    expect(parsePermMsgIds(html)).toEqual(['msg-f:111', 'msg-f:222']);
  });
  it('returns an empty list when there are none', () => {
    expect(parsePermMsgIds('<html></html>')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mail-fetch.test.ts`
Expected: FAIL — `Failed to resolve import "../electron/mail-fetch"`.

- [ ] **Step 3: Write the implementation**

Maak `electron/mail-fetch.ts`. Let op: `Session` wordt alleen als **type**
geïmporteerd (`import type`), zodat dit bestand onder Vitest importeerbaar
blijft; `net` wordt lui geladen in de functie die 'm nodig heeft.

```ts
import type { Session } from 'electron';

export interface DropPayload {
  threadId: string;
  authuser: string;
  ik: string;
}

export interface FetchedMessage {
  raw?: Buffer;
  error?: string;
}

const BASE = 'https://mail.google.com/mail/u';

export function omUrl(p: DropPayload & { permMsgId?: string }): string {
  const perm = p.permMsgId ? `&permmsgid=${encodeURIComponent(p.permMsgId)}` : '';
  return `${BASE}/${p.authuser}/?ik=${p.ik}&view=om&th=${p.threadId}${perm}`;
}

const unescapeHtml = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

// De "Origineel downloaden"-link op de om-pagina: view=att met disp=comp. Een
// inline bijlage (disp=inline / disp=safe) is een plaatje, geen bericht.
export function parseOriginalLinks(html: string, authuser: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/href\s*=\s*"([^"]+)"/gi)) {
    const href = unescapeHtml(m[1]);
    if (!/[?&]view=att\b/.test(href) || !/[?&]disp=comp\b/.test(href)) continue;
    const abs = href.startsWith('http') ? href : `${BASE}/${authuser}/${href.replace(/^\.?\//, '')}`;
    if (!out.includes(abs)) out.push(abs);
  }
  return out;
}

export function parsePermMsgIds(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/permmsgid=(msg-[a-z]-?(?:%3A|:)[0-9]+)/gi)) {
    const id = decodeURIComponent(m[1]);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

async function get(ses: Session, url: string): Promise<Buffer> {
  // Lui geladen: dit bestand moet ook onder Vitest (zonder Electron) te
  // importeren zijn voor de pure functies hierboven.
  const { net } = require('electron') as typeof import('electron');
  return await new Promise<Buffer>((resolve, reject) => {
    const req = net.request({ url, session: ses, useSessionCookies: true });
    req.on('response', (res) => {
      const status = res.statusCode;
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        if (status < 200 || status >= 300) reject(new Error(`HTTP ${status}`));
        else resolve(Buffer.concat(chunks));
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

// Haalt de originelen van alle berichten in de conversatie op. Levert per
// bericht óf `raw`, óf `error` — één mislukt bericht laat de rest doorgaan.
export async function fetchThreadEmls(ses: Session, p: DropPayload): Promise<FetchedMessage[]> {
  const page = (await get(ses, omUrl(p))).toString('utf8');
  const links = parseOriginalLinks(page, p.authuser);
  // Berichten waarvan de threadpagina alleen een verwijzing bevat: hun eigen
  // om-pagina heeft de download-link wel.
  for (const permMsgId of parsePermMsgIds(page)) {
    if (links.some((l) => l.includes(encodeURIComponent(permMsgId)) || l.includes(permMsgId))) continue;
    try {
      const sub = (await get(ses, omUrl({ ...p, permMsgId }))).toString('utf8');
      for (const l of parseOriginalLinks(sub, p.authuser)) if (!links.includes(l)) links.push(l);
    } catch {
      // Eén onbereikbaar deelbericht mag de rest niet blokkeren.
    }
  }
  const out: FetchedMessage[] = [];
  for (const link of links) {
    try {
      out.push({ raw: await get(ses, link) });
    } catch (e) {
      out.push({ error: (e as Error).message });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mail-fetch.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: alles groen.

---

### Task 4: `electron/dropzone.ts` — strip-HTML plus drag-, authuser- en `ik`-herkenning

**Files:**
- Create: `electron/dropzone.ts`
- Test: `tests/dropzone.test.ts`

**Interfaces:**
- Consumes: niets.
- Produces:
  - `const DROPZONE_ID = 'gmd-dropzone'`
  - `const DROPZONE_CSS: string`
  - `interface DragNode { getAttribute(name: string): string | null; parentElement: DragNode | null }`
  - `threadIdFromDragTarget(el: DragNode | null): string | null`
  - `authuserFromPath(pathname: string): string`
  - `ikFromPage(win: { GLOBALS?: unknown }, html: string): string | null`
  - `resultText(r: { ok: boolean; count: number; total: number; error?: string }): string`

- [ ] **Step 1: Write the failing test**

Maak `tests/dropzone.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  threadIdFromDragTarget,
  authuserFromPath,
  ikFromPage,
  resultText,
  DROPZONE_ID,
  DROPZONE_CSS,
} from '../electron/dropzone';

// Minimale namaak-DOM: de functie mag alleen getAttribute en parentElement
// gebruiken, want de tests draaien zonder jsdom.
function node(attrs: Record<string, string>, parent: any = null): any {
  return { getAttribute: (n: string) => attrs[n] ?? null, parentElement: parent };
}

describe('threadIdFromDragTarget', () => {
  it('finds the id on the element itself', () => {
    expect(threadIdFromDragTarget(node({ 'data-legacy-thread-id': '18f2a' }))).toBe('18f2a');
  });
  it('walks up to an ancestor that carries the id', () => {
    const row = node({ 'data-legacy-thread-id': '18f2a' });
    const span = node({}, node({}, row));
    expect(threadIdFromDragTarget(span)).toBe('18f2a');
  });
  it('returns null when no ancestor has one', () => {
    expect(threadIdFromDragTarget(node({}, node({})))).toBeNull();
    expect(threadIdFromDragTarget(null)).toBeNull();
  });
  it('ignores an empty attribute value', () => {
    expect(threadIdFromDragTarget(node({ 'data-legacy-thread-id': '' }))).toBeNull();
  });
  it('stops after a sane number of levels instead of looping forever', () => {
    const self: any = { getAttribute: () => null, parentElement: null };
    self.parentElement = self; // cyclus
    expect(threadIdFromDragTarget(self)).toBeNull();
  });
});

describe('authuserFromPath', () => {
  it('reads the authuser slot from the path', () => {
    expect(authuserFromPath('/mail/u/2/')).toBe('2');
    expect(authuserFromPath('/mail/u/0/#inbox')).toBe('0');
  });
  it('defaults to 0 when the path has no slot', () => {
    expect(authuserFromPath('/mail/')).toBe('0');
    expect(authuserFromPath('')).toBe('0');
  });
});

describe('ikFromPage', () => {
  it('prefers GLOBALS[9]', () => {
    const globals = new Array(12).fill(null);
    globals[9] = 'a1b2c3';
    expect(ikFromPage({ GLOBALS: globals }, '')).toBe('a1b2c3');
  });
  it('falls back to an ik parameter in the page html', () => {
    expect(ikFromPage({}, '<a href="/mail/u/0/?ik=deadbeef&view=om">x</a>')).toBe('deadbeef');
  });
  it('ignores a GLOBALS entry that is not a token', () => {
    const globals = new Array(12).fill(null);
    globals[9] = { not: 'a token' };
    expect(ikFromPage({ GLOBALS: globals }, '?ik=cafe01&')).toBe('cafe01');
  });
  it('returns null when neither is available', () => {
    expect(ikFromPage({}, '<html></html>')).toBeNull();
  });
});

describe('resultText', () => {
  it('reports a full success', () => {
    expect(resultText({ ok: true, count: 3, total: 3 })).toBe('3 berichten opgeslagen');
  });
  it('uses the singular for one message', () => {
    expect(resultText({ ok: true, count: 1, total: 1 })).toBe('1 bericht opgeslagen');
  });
  it('reports a partial success', () => {
    expect(resultText({ ok: true, count: 2, total: 3 })).toBe('2 van 3 opgeslagen');
  });
  it('reports the error', () => {
    expect(resultText({ ok: false, count: 0, total: 0, error: 'HTTP 404' })).toBe('Mislukt: HTTP 404');
  });
});

describe('constants', () => {
  it('scopes every css rule to the dropzone id', () => {
    const selectors = DROPZONE_CSS.split('}').map((b) => b.split('{')[0].trim()).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(0);
    for (const s of selectors) expect(s).toContain(`#${DROPZONE_ID}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dropzone.test.ts`
Expected: FAIL — `Failed to resolve import "../electron/dropzone"`.

- [ ] **Step 3: Write the implementation**

Maak `electron/dropzone.ts`:

```ts
// De dropzone leeft in de Gmail-pagina zelf: drag & drop werkt niet tussen twee
// Electron-views, dus een aparte overlay-view zou nooit een sleep uit de
// berichtenlijst kunnen ontvangen. Dit bestand bevat alleen de pure delen; het
// ophangen aan de DOM staat in preload.ts.

export const DROPZONE_ID = 'gmd-dropzone';

// Alle regels zijn op #gmd-dropzone gescoped zodat Gmail's eigen stylesheet er
// niet bij kan en wij niets van Gmail raken.
export const DROPZONE_CSS = `
#${DROPZONE_ID} {
  position: fixed; top: 0; left: 0; right: 0; height: 56px;
  display: none; align-items: center; justify-content: center;
  box-sizing: border-box; margin: 8px;
  font: 500 14px/1.2 Roboto, Arial, sans-serif; color: #1a73e8;
  background: rgba(232, 240, 254, 0.97);
  border: 2px dashed #1a73e8; border-radius: 12px;
  z-index: 2147483647; pointer-events: none;
}
#${DROPZONE_ID}[data-state="armed"] { display: flex; pointer-events: auto; }
#${DROPZONE_ID}[data-state="over"] { display: flex; pointer-events: auto; background: #d2e3fc; }
#${DROPZONE_ID}[data-state="done"] { display: flex; color: #188038; border-color: #188038; background: rgba(230, 244, 234, 0.97); }
#${DROPZONE_ID}[data-state="failed"] { display: flex; color: #c5221f; border-color: #c5221f; background: rgba(252, 232, 230, 0.97); }
`;

export const DROPZONE_LABEL = 'Sleep hier om de mail op te slaan';

export interface DragNode {
  getAttribute(name: string): string | null;
  parentElement: DragNode | null;
}

// Gmail markeert elke rij in de berichtenlijst met data-legacy-thread-id. De
// sleep begint vaak op een span diep in die rij, dus lopen we omhoog. Geen
// Element.closest: de tests draaien zonder DOM.
export function threadIdFromDragTarget(el: DragNode | null): string | null {
  let cur = el;
  for (let depth = 0; cur && depth < 30; depth++) {
    const id = cur.getAttribute('data-legacy-thread-id');
    if (id) return id;
    const next: DragNode | null = cur.parentElement;
    if (next === cur) break;
    cur = next;
  }
  return null;
}

export function authuserFromPath(pathname: string): string {
  return (/\/mail\/u\/(\d+)/.exec(pathname || '') ?? [])[1] ?? '0';
}

// `ik` is Gmail's per-sessie requesttoken; zonder dat token weigert de
// origineel-weergeven-URL. Gmail zet 'm in GLOBALS[9]; als dat verandert
// blijft de token nog te vinden in een willekeurige Gmail-URL op de pagina.
export function ikFromPage(win: { GLOBALS?: unknown }, html: string): string | null {
  const g = win.GLOBALS;
  if (Array.isArray(g) && typeof g[9] === 'string' && /^[0-9a-f]{4,}$/i.test(g[9])) return g[9];
  const m = /[?&]ik=([0-9a-f]{4,})/i.exec(html || '');
  return m ? m[1] : null;
}

export function resultText(r: { ok: boolean; count: number; total: number; error?: string }): string {
  if (!r.ok) return `Mislukt: ${r.error ?? 'onbekende fout'}`;
  if (r.count < r.total) return `${r.count} van ${r.total} opgeslagen`;
  return `${r.count} bericht${r.count === 1 ? '' : 'en'} opgeslagen`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dropzone.test.ts`
Expected: PASS — 16 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: alles groen.

---

### Task 5: `mailDrop.folder` in de prefs

Een lege string betekent "gebruik de standaardmap". De store mag `app.getPath`
niet aanroepen (hij importeert `electron` niet), dus main resolvet dat.

**Files:**
- Modify: `electron/prefs-store.ts`
- Test: `tests/prefs-store.test.ts` (nieuw bestand — er is er nog geen)

**Interfaces:**
- Consumes: niets.
- Produces:
  - `interface MailDropPrefs { folder: string }` — veld `mailDrop` op `Prefs`
  - `PrefsStore.setMailDropFolder(folder: string): void`

- [ ] **Step 1: Write the failing test**

Maak `tests/prefs-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrefsStore } from '../electron/prefs-store';

const newStore = () => new PrefsStore(join(mkdtempSync(join(tmpdir(), 'prefs-')), 'prefs.json'));

describe('PrefsStore mailDrop', () => {
  it('defaults to an empty folder (meaning: use the default location)', () => {
    expect(newStore().getAll().mailDrop).toEqual({ folder: '' });
  });

  it('persists a chosen folder across instances', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'prefs-')), 'prefs.json');
    new PrefsStore(path).setMailDropFolder('D:\\Mail');
    expect(new PrefsStore(path).getAll().mailDrop.folder).toBe('D:\\Mail');
  });

  it('keeps other prefs intact when the folder changes', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'prefs-')), 'prefs.json');
    const store = new PrefsStore(path);
    store.setTheme('dark');
    store.setMailDropFolder('D:\\Mail');
    expect(store.getAll().theme).toBe('dark');
  });

  it('ignores a non-string folder in a hand-edited file', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'prefs-')), 'prefs.json');
    writeFileSync(path, JSON.stringify({ mailDrop: { folder: 42 } }), 'utf8');
    expect(new PrefsStore(path).getAll().mailDrop.folder).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/prefs-store.test.ts`
Expected: FAIL — `store.setMailDropFolder is not a function` (en `mailDrop` is `undefined`).

- [ ] **Step 3: Write the implementation**

In `electron/prefs-store.ts`, boven `export interface Prefs`:

```ts
// Waar gesleepte mail wordt opgeslagen. Leeg = de standaardmap, die main
// bepaalt (deze module kent `app` niet).
export interface MailDropPrefs {
  folder: string;
}
```

Voeg in `interface Prefs` toe, na `accounts`:

```ts
  mailDrop: MailDropPrefs;
```

Voeg in `DEFAULT_PREFS` toe, na `accounts: {},`:

```ts
  mailDrop: { folder: '' },
```

Voeg in `getAll()` toe in het teruggegeven object, na de `accounts`-regel:

```ts
        mailDrop: {
          folder: typeof raw.mailDrop?.folder === 'string' ? raw.mailDrop.folder : '',
        },
```

Voeg als methode toe, na `setReneMode`:

```ts
  setMailDropFolder(folder: string): void {
    this.write({ ...this.getAll(), mailDrop: { folder } });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/prefs-store.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: alles groen.

---

### Task 6: IPC-kanalen en de injectie in de Gmail-pagina

Na deze taak verschijnt de strip echt bij het slepen en stuurt hij een drop weg;
main doet er nog niets mee (dat is Task 7).

**Files:**
- Modify: `electron/ipc.ts`
- Modify: `electron/preload.ts:128-203` (het `typeof document !== 'undefined'`-blok)

**Interfaces:**
- Consumes: `DROPZONE_ID`, `DROPZONE_CSS`, `DROPZONE_LABEL`, `threadIdFromDragTarget`, `authuserFromPath`, `ikFromPage`, `resultText` uit `electron/dropzone.ts` (Task 4).
- Produces:
  - `IPC.MAIL_DROP = 'mail:drop'` — Gmail-view → main, payload `MailDropPayload`
  - `IPC.MAIL_DROP_RESULT = 'mail:drop-result'` — main → Gmail-view, payload `MailDropResult`
  - `IPC.MAIL_DROP_FOLDER_GET = 'maildrop:folder-get'` — sidebar invoke → `string`
  - `IPC.MAIL_DROP_FOLDER_PICK = 'maildrop:folder-pick'` — sidebar invoke → `string`
  - `IPC.MAIL_DROP_FOLDER_OPEN = 'maildrop:folder-open'` — sidebar send
  - `interface MailDropPayload { threadId: string; authuser: string; ik: string }`
  - `interface MailDropResult { ok: boolean; count: number; total: number; error?: string }`

- [ ] **Step 1: Add the IPC channels**

In `electron/ipc.ts`, in het `IPC`-object bij "Gmail view -> main", na de
`ACCOUNT_IDENTITY`-regel:

```ts
  MAIL_DROP: 'mail:drop', // send(MailDropPayload) — mail gesleept naar de dropzone
```

Bij "renderer (sidebar) -> main", na `SET_DEFAULT_MAIL`:

```ts
  MAIL_DROP_FOLDER_GET: 'maildrop:folder-get', // invoke() -> string (opgeloste map)
  MAIL_DROP_FOLDER_PICK: 'maildrop:folder-pick', // invoke() -> string (nieuwe map, of de oude bij annuleren)
  MAIL_DROP_FOLDER_OPEN: 'maildrop:folder-open', // send() — map in Verkenner openen
```

Bij "main -> renderer (sidebar)", na `NOTIFY_ALLOWED`:

```ts
  MAIL_DROP_RESULT: 'mail:drop-result', // main -> mail view: send(MailDropResult)
```

Onderaan het bestand, boven de `export type`-regel:

```ts
// Payload van IPC.MAIL_DROP: wat de Gmail-pagina weet op het moment van de drop.
export interface MailDropPayload {
  threadId: string;
  authuser: string;
  ik: string;
}

// Payload van IPC.MAIL_DROP_RESULT. `total` is het aantal gevonden berichten in
// de conversatie, `count` hoeveel daarvan zijn opgeslagen.
export interface MailDropResult {
  ok: boolean;
  count: number;
  total: number;
  error?: string;
}
```

- [ ] **Step 2: Run the type check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: geen fouten.

- [ ] **Step 3: Inject the dropzone from the preload**

In `electron/preload.ts`, bovenaan bij de bestaande imports:

```ts
import {
  DROPZONE_ID,
  DROPZONE_CSS,
  DROPZONE_LABEL,
  threadIdFromDragTarget,
  authuserFromPath,
  ikFromPage,
  resultText,
  type DragNode,
} from './dropzone';
import type { MailDropPayload, MailDropResult } from './ipc';
```

En pas de `IPC`-import aan zodat die ook de types dekt — die regel wordt:

```ts
import { IPC, type NotifyState } from './ipc';
```

(die staat er al; niets te doen als hij ongewijzigd is)

Voeg in hetzelfde bestand, vóór het `if (typeof document !== 'undefined')`-blok,
deze functie toe:

```ts
// Hangt de dropzone in de Gmail-pagina. Alleen mail.google.com: dezelfde
// preload draait ook in de agenda-view, waar niets te slepen valt.
function installDropzone(send: (p: MailDropPayload) => void): (r: MailDropResult) => void {
  const style = document.createElement('style');
  style.textContent = DROPZONE_CSS;
  const zone = document.createElement('div');
  zone.id = DROPZONE_ID;
  zone.textContent = DROPZONE_LABEL;
  zone.setAttribute('data-state', 'idle');

  const attach = () => {
    if (!document.documentElement.contains(style)) document.documentElement.appendChild(style);
    if (!document.documentElement.contains(zone)) document.documentElement.appendChild(zone);
  };
  attach();
  // Gmail's SPA vervangt soms hele takken van de DOM; dan hangen we 'm terug.
  new MutationObserver(attach).observe(document.documentElement, { childList: true });

  let dragThreadId: string | null = null;
  let clearTimer: ReturnType<typeof setTimeout> | null = null;
  const setState = (s: string) => zone.setAttribute('data-state', s);
  const reset = () => {
    dragThreadId = null;
    zone.textContent = DROPZONE_LABEL;
    setState('idle');
  };

  document.addEventListener(
    'dragstart',
    (e) => {
      dragThreadId = threadIdFromDragTarget(e.target as unknown as DragNode | null);
      if (!dragThreadId) return;
      if (clearTimer) clearTimeout(clearTimer);
      zone.textContent = DROPZONE_LABEL;
      setState('armed');
    },
    true,
  );
  document.addEventListener('dragend', () => { if (dragThreadId) reset(); }, true);

  zone.addEventListener('dragover', (e) => {
    if (!dragThreadId) return;
    e.preventDefault();
    setState('over');
  });
  zone.addEventListener('dragleave', () => {
    if (dragThreadId) setState('armed');
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const threadId = dragThreadId;
    // Niet-mail (tekst, een bestand): negeren, strip verdwijnt zonder melding.
    if (!threadId) return reset();
    dragThreadId = null;
    zone.textContent = 'Bezig met opslaan…';
    setState('armed');
    send({
      threadId,
      authuser: authuserFromPath(location.pathname),
      ik: ikFromPage(window as unknown as { GLOBALS?: unknown }, document.documentElement.innerHTML) ?? '',
    });
  });

  return (r: MailDropResult) => {
    zone.textContent = resultText(r);
    setState(r.ok ? 'done' : 'failed');
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(reset, 2000);
  };
}
```

Roep hem aan binnen `start()` in het Electron-blok, direct na de
`rerouteServiceWorkerNotifications(...)`-aanroep:

```ts
    if (location.hostname === 'mail.google.com') {
      const showResult = installDropzone((p) => ipcRenderer.send(IPC.MAIL_DROP, p));
      ipcRenderer.on(IPC.MAIL_DROP_RESULT, (_e: unknown, r: MailDropResult) => showResult(r));
    }
```

- [ ] **Step 4: Build and check the type of the whole thing**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build:main`
Expected: geen fouten; `dist-electron/preload.js` wordt geschreven.

- [ ] **Step 5: Verify the existing preload tests still pass**

Run: `npm test`
Expected: alles groen — met name `tests/preload-report.test.ts` en
`tests/preload-identity.test.ts`, die `electron/preload.ts` onder Node
importeren. Faalt dat met een fout over `document` of `electron`, dan staat
`installDropzone` per ongeluk buiten de guard of wordt hij op moduleniveau
aangeroepen.

---

### Task 7: Main-proces — drop afhandelen, opslaan en loggen

**Files:**
- Modify: `electron/profile-view-manager.ts:42-65` (constructor), `:89-97` (ipc-message), en een nieuwe methode
- Modify: `electron/main.ts:611-675` (constructie van `ProfileViewManager`) en het `ipcMain`-blok rond `:892-983`

**Interfaces:**
- Consumes: `parseHeaders`, `extractPlainText` (Task 1); `writeThread`, `appendLog`, `LogRecord`, `SavedMessage` (Task 2); `fetchThreadEmls` (Task 3); `PrefsStore.setMailDropFolder` (Task 5); `IPC.MAIL_DROP*`, `MailDropPayload`, `MailDropResult` (Task 6).
- Produces:
  - `ProfileViewManager` constructor krijgt als laatste parameter `onMailDrop: (accountKey: string, payload: MailDropPayload) => void` (standaard een no-op)
  - `ProfileViewManager.sendDropResult(accountKey: string, result: MailDropResult): void`
  - `main.ts`: `mailDropFolder(): string` en `handleMailDrop(accountKey, payload): Promise<void>`

- [ ] **Step 1: Extend ProfileViewManager**

In `electron/profile-view-manager.ts`, pas de import van `ipc` aan:

```ts
import { IPC, type NotifyState, type MailDropPayload, type MailDropResult } from './ipc';
```

Voeg als laatste constructorparameter toe, ná `getUiScale`:

```ts
    // Een mail is naar de dropzone in deze view gesleept.
    private readonly onMailDrop: (accountKey: string, payload: MailDropPayload) => void = () => {},
```

Voeg in de `ipc-message`-handler toe, binnen het bestaande
`if (surface === 'mail') {`-blok, na de `ACCOUNT_IDENTITY`-regel:

```ts
        else if (channel === IPC.MAIL_DROP) this.onMailDrop(acctKey, args[0] as MailDropPayload);
```

Voeg een methode toe, direct na `pushNotifyAllowed`:

```ts
  sendDropResult(accountKey: string, result: MailDropResult): void {
    const wc = this.views.get(viewKey(accountKey, 'mail'))?.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.send(IPC.MAIL_DROP_RESULT, result);
  }
```

- [ ] **Step 2: Wire the handler in main**

In `electron/main.ts`, bij de bestaande imports uit `electron` moeten `session`,
`dialog` en `shell` beschikbaar zijn — voeg ze toe aan de bestaande
`import { ... } from 'electron';` als ze er nog niet staan.

Voeg deze imports toe bij de andere lokale imports:

```ts
import { parseHeaders, extractPlainText } from './eml';
import { writeThread, appendLog, type LogRecord, type SavedMessage } from './mail-archive';
import { fetchThreadEmls } from './mail-fetch';
import type { MailDropPayload } from './ipc';
```

Voeg deze twee functies toe boven `function createWindow()`:

```ts
// Lege pref = de standaardmap. PrefsStore kent `app` niet, dus dat wordt hier
// opgelost.
function mailDropFolder(): string {
  return (
    prefs?.getAll().mailDrop.folder ||
    join(app.getPath('documents'), 'Gmail Desktop', 'Mail')
  );
}

async function handleMailDrop(acctKey: string, payload: MailDropPayload): Promise<void> {
  const ts = new Date().toISOString();
  const account = profiles.find((p) => keyOf(p) === acctKey)?.email ?? '';
  const root = mailDropFolder();
  const fail = (error: string, total = 0) => {
    // Het log is best-effort: is de map onschrijfbaar, dan blijft alleen de
    // melding in de strip over.
    try {
      appendLog(root, [{ ts, account, threadId: payload.threadId, error }]);
    } catch {
      /* map niet schrijfbaar */
    }
    manager?.sendDropResult(acctKey, { ok: false, count: 0, total, error });
  };

  if (!payload?.threadId) return;
  if (!payload.ik) return fail('Kon Gmail-token niet lezen');

  let fetched;
  try {
    fetched = await fetchThreadEmls(session.fromPartition('persist:google'), payload);
  } catch (e) {
    return fail(`Ophalen mislukt (${(e as Error).message})`);
  }
  if (fetched.length === 0) return fail('Geen origineel gevonden');

  const ok: SavedMessage[] = [];
  const failedRecords: LogRecord[] = [];
  for (const f of fetched) {
    if (f.raw) ok.push({ raw: f.raw, headers: parseHeaders(f.raw.toString('utf8')) });
    else failedRecords.push({ ts, account, threadId: payload.threadId, error: f.error ?? 'onbekende fout' });
  }
  if (ok.length === 0) return fail(fetched[0]?.error ?? 'Geen bericht opgehaald', fetched.length);

  let files: string[];
  try {
    files = writeThread(root, ts, ok);
  } catch {
    return fail(`Kan niet schrijven naar ${root}`, fetched.length);
  }

  const records: LogRecord[] = ok.map((m, i) => ({
    ts,
    account,
    threadId: payload.threadId,
    messageId: m.headers.messageId,
    from: m.headers.from,
    to: m.headers.to,
    cc: m.headers.cc,
    subject: m.headers.subject,
    date: m.headers.date,
    file: files[i],
    bytes: m.raw.length,
    body: extractPlainText(m.raw.toString('utf8')),
  }));
  try {
    appendLog(root, [...records, ...failedRecords]);
  } catch {
    /* map niet schrijfbaar; de bestanden staan er wel */
  }
  manager?.sendDropResult(acctKey, { ok: true, count: ok.length, total: fetched.length });
}
```

Voeg als laatste argument van `new ProfileViewManager(...)` toe, ná de
`() => (prefs?.getAll().reneMode ? RENE_ZOOM_FACTOR : 1),`-regel:

```ts
    (acctKey, payload) => void handleMailDrop(acctKey, payload),
```

- [ ] **Step 3: Add the three settings channels**

Voeg toe in het `ipcMain`-blok, na de `ipcMain.on(IPC.SET_DEFAULT_MAIL, ...)`-handler:

```ts
  ipcMain.handle(IPC.MAIL_DROP_FOLDER_GET, () => mailDropFolder());
  ipcMain.handle(IPC.MAIL_DROP_FOLDER_PICK, async () => {
    const current = mailDropFolder();
    if (!mainWindow || mainWindow.isDestroyed()) return current;
    const res = await dialog.showOpenDialog(mainWindow, {
      defaultPath: current,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return current;
    prefs?.setMailDropFolder(res.filePaths[0]);
    return res.filePaths[0];
  });
  ipcMain.on(IPC.MAIL_DROP_FOLDER_OPEN, () => {
    const dir = mailDropFolder();
    // De map bestaat pas na de eerste drop; maak hem aan zodat Verkenner iets
    // te openen heeft.
    mkdirSync(dir, { recursive: true });
    void shell.openPath(dir);
  });
```

Zorg dat `mkdirSync` uit `node:fs` geïmporteerd is in `main.ts`; voeg het
anders toe aan de bestaande `node:fs`-import.

- [ ] **Step 4: Type check and build**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build:main`
Expected: geen fouten.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: alles groen.

---

### Task 8: Instelling voor de map in de sidebar

**Files:**
- Modify: `electron/sidebar-preload.ts:17-69`
- Modify: `renderer/app/strings.ts` (interface + beide varianten)
- Modify: `renderer/app/page.tsx:58-66` (`Prefs`), `:68-…` (`DesktopBridge`)
- Modify: `renderer/app/SettingsPanel.tsx:174-…` (props) en de sectie Algemeen rond `:318-342`

**Interfaces:**
- Consumes: `IPC.MAIL_DROP_FOLDER_GET|PICK|OPEN` (Task 6).
- Produces:
  - `window.desktop.getMailDropFolder(): Promise<string>`
  - `window.desktop.pickMailDropFolder(): Promise<string>`
  - `window.desktop.openMailDropFolder(): void`
  - Strings `mailDropFolder`, `mailDropHint`, `mailDropChoose`, `mailDropOpen`

- [ ] **Step 1: Extend the bridge**

In `electron/sidebar-preload.ts`, binnen het object dat aan
`contextBridge.exposeInMainWorld('desktop', {...})` wordt meegegeven, na
`setDefaultMail`:

```ts
  getMailDropFolder: (): Promise<string> => ipcRenderer.invoke(IPC.MAIL_DROP_FOLDER_GET),
  pickMailDropFolder: (): Promise<string> => ipcRenderer.invoke(IPC.MAIL_DROP_FOLDER_PICK),
  openMailDropFolder: (): void => ipcRenderer.send(IPC.MAIL_DROP_FOLDER_OPEN),
```

- [ ] **Step 2: Add the strings**

In `renderer/app/strings.ts`, in `interface UiStrings` na `notDefaultMail: string;`:

```ts
  mailDropFolder: string;
  mailDropHint: string;
  mailDropChoose: string;
  mailDropOpen: string;
```

In `STRINGS_NORMAL`, bij de overeenkomstige plek:

```ts
  mailDropFolder: 'Saved mail folder',
  mailDropHint: 'Mail you drag into the strip at the top of Gmail is saved here as .eml, with a log.jsonl next to it',
  mailDropChoose: 'Choose…',
  mailDropOpen: 'Open',
```

In `STRINGS_RENE`:

```ts
  mailDropFolder: 'Waar de mailtjes komen',
  mailDropHint: 'Sleep een mailtje naar de balk boven Gmail. Dan komt hij hier te staan.',
  mailDropChoose: 'Kies map',
  mailDropOpen: 'Laat zien',
```

- [ ] **Step 3: Extend the renderer types**

In `renderer/app/page.tsx`, in `export interface Prefs` na `accounts: Record<string, AccountPref>;`:

```ts
  mailDrop: { folder: string };
```

In `interface DesktopBridge`, na de `setDefaultMail`-regel:

```ts
  getMailDropFolder(): Promise<string>;
  pickMailDropFolder(): Promise<string>;
  openMailDropFolder(): void;
```

- [ ] **Step 4: Add the settings row**

In `renderer/app/SettingsPanel.tsx`, bij de bestaande `useState`-aanroepen in
de component:

```ts
  const [mailDropFolder, setMailDropFolder] = useState('');
```

En bij de bestaande `useEffect`-aanroepen — het paneel wordt gemonteerd
wanneer het opengaat, dus dit laadt bij elke opening opnieuw:

```ts
  useEffect(() => {
    void window.desktop?.getMailDropFolder().then(setMailDropFolder);
  }, []);
```

Voeg in de sectie Algemeen, direct ná de `theme`-rij (het `<div>` dat op
`{S.theme}` volgt en op `</div>` eindigt), deze rij toe:

```tsx
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <span className="text-sm">{S.mailDropFolder}</span>
              <span className="truncate text-xs text-neutral-400" title={mailDropFolder}>
                {mailDropFolder}
              </span>
              <span className="text-xs text-neutral-400">{S.mailDropHint}</span>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => void window.desktop?.pickMailDropFolder().then(setMailDropFolder)}
                className="rounded bg-neutral-200 px-3 py-1 text-sm hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700"
              >
                {S.mailDropChoose}
              </button>
              <button
                onClick={() => window.desktop?.openMailDropFolder()}
                className="rounded bg-neutral-200 px-3 py-1 text-sm hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700"
              >
                {S.mailDropOpen}
              </button>
            </div>
          </div>
```

- [ ] **Step 5: Build the renderer and the main bundles**

Run: `npm run build`
Expected: de Next.js-export en esbuild slagen zonder typefouten. Faalt het op
een ontbrekende string in `STRINGS_RENE` of `STRINGS_NORMAL`, dan is een van de
vier strings in maar één variant gezet.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: alles groen.

---

### Task 9: Verifiëren tegen een echt Gmail-account

Dit is de taak waarin het risico uit de spec wordt afgerekend: `view=om` en de
`ik`-token zijn interne Gmail-mechanismen, geen API. Pas hier blijkt of het
werkt — en of een conversatie met meerdere berichten er ook echt meerdere
oplevert.

**Files:**
- Modify (alleen als een controle faalt): `electron/mail-fetch.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Start the app**

Run: `npm run build && npm start`
Expected: de app opent en een Gmail-account is ingelogd.

- [ ] **Step 2: Drag a single-message conversation onto the strip**

Sleep een rij uit de inbox naar boven. Verwacht: de strip verschijnt zodra de
sleep begint, licht op als je erboven hangt, toont daarna "1 bericht
opgeslagen".

Controleer in `Documenten\Gmail Desktop\Mail`: er staat één map met daarin één
`.eml`, en een `log.jsonl` met één regel. Open het `.eml` (bijvoorbeeld in
Kladblok): het begint met headers en bevat de volledige brontekst.

- [ ] **Step 3: Check the log record**

Run: `Get-Content "$env:USERPROFILE\Documents\Gmail Desktop\Mail\log.jsonl" -Tail 1 | ConvertFrom-Json | Format-List`
Expected: `from`, `subject`, `date`, `file`, `bytes` en `body` zijn gevuld;
`body` is leesbare platte tekst zonder HTML-tags of `=3D`-resten.

- [ ] **Step 4: Drag a conversation with three or more messages**

Verwacht: "3 berichten opgeslagen", drie `.eml`'s in één map, drie logregels.

Komt er maar één bericht terug, dan levert `view=om` blijkbaar geen links naar
de andere berichten. Noteer dat en pak het gericht aan: open de om-pagina van
die thread handmatig in een browser met dezelfde URL die `omUrl()` bouwt, kijk
in de paginabron welke vorm de verwijzingen naar de andere berichten hebben, en
pas `parsePermMsgIds`/`parseOriginalLinks` aan met een test die die echte
paginabron als invoer gebruikt. Vervalt die route helemaal, meld het dan — dan
is de keuze uit de spec (alle berichten) niet haalbaar en moet die heroverwogen
worden, niet stilzwijgend versmald.

- [ ] **Step 5: Check the error path**

Zet in de instellingen de map op een pad dat niet schrijfbaar is (bijvoorbeeld
`C:\Windows\System32\gmd-test`) en sleep een mail.
Expected: de strip wordt rood met "Mislukt: Kan niet schrijven naar …". De app
crasht niet. Zet de map daarna terug.

- [ ] **Step 6: Check the second account and the calendar view**

Wissel naar een tweede account en sleep daar een mail: dat moet net zo werken,
met het juiste `account`-veld in het log. Open daarna de agenda-view: daar hoort
geen strip te verschijnen (de injectie is op `mail.google.com` gefilterd).

- [ ] **Step 7: Note it in the changelog**

Voeg in `CHANGELOG.md` bovenaan onder de nieuwste (unreleased) versie een regel
toe in de stijl van de bestaande regels, bijvoorbeeld:

```markdown
- Dropzone bovenaan Gmail: sleep een conversatie naar de balk om alle berichten als `.eml` op te slaan, met een `log.jsonl` met afzender, onderwerp, datum en de body-tekst. De map is instelbaar bij Instellingen → Algemeen.
```

- [ ] **Step 8: Run the full suite one last time**

Run: `npm test`
Expected: alles groen.
