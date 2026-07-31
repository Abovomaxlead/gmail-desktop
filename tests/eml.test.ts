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

  // De vorm van een echte Gmail-mail met een bijlage: geen text/plain-deel, een
  // boundary die zelf met -- begint, en lege regels ná de sluit-boundary. Die
  // epiloog heeft geen Content-Type en mag niet als leeg tekstdeel gelden — dan
  // wint hij van de html en blijft de body leeg.
  it('falls back to the html part when a multipart message has no text/plain', () => {
    const raw = [
      'Content-Type: multipart/related; type="text/html";',
      '\tboundary="--_NmP-abc123-Part_1"',
      '',
      '----_NmP-abc123-Part_1',
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      '<p>Hoi Luca,</p><p>Hier is de commercial=2E</p>',
      '----_NmP-abc123-Part_1',
      'Content-Type: audio/mpeg; name="commercial.mp3"',
      'Content-Transfer-Encoding: base64',
      '',
      'AAAAAAAA',
      '----_NmP-abc123-Part_1--',
      '',
      '',
    ].join('\r\n');
    expect(extractPlainText(raw)).toBe('Hoi Luca,\n\nHier is de commercial.');
  });

  it('ignores an empty part instead of letting it win from a filled one', () => {
    const raw = [
      'Content-Type: multipart/mixed; boundary="B"',
      '',
      '--B',
      'Content-Type: text/plain; charset=utf-8',
      '',
      '',
      '--B',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Wel inhoud',
      '--B--',
      '',
    ].join('\r\n');
    expect(extractPlainText(raw)).toBe('Wel inhoud');
  });

  it('strips the invisible spacer entities mail templates use', () => {
    const raw = [
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Klaar om te downloaden.&zwnj; &zwnj; &#8203;</p>',
      '',
    ].join('\r\n');
    expect(extractPlainText(raw)).toBe('Klaar om te downloaden.');
  });

  it('decodes numeric entities and flattens the indentation html leaves behind', () => {
    const raw = [
      'Content-Type: text/html; charset=utf-8',
      '',
      '<table><tr><td>',
      '        Prijs: &#8364;96',
      '   </td></tr><tr><td>   Tot ziens   </td></tr></table>',
      '',
    ].join('\r\n');
    expect(extractPlainText(raw)).toBe('Prijs: €96\n\nTot ziens');
  });

  it('returns an empty string for a message with no body', () => {
    expect(extractPlainText('Subject: leeg\r\n\r\n')).toBe('');
  });
});
