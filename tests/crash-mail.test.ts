// The message a crash report is sent as: a well-formed multipart mail with the logs actually
// inside it, which is the one thing that cannot be checked after the fact when nobody read it
// before it left.

import { describe, expect, it } from 'vitest';
import { buildRawMail, encodeHeaderWord } from '../electron/feedback/crash-mail';

const BOUNDARY = '----gmail-desktop-testboundary';

const build = (over: Partial<Parameters<typeof buildRawMail>[0]> = {}): string =>
  buildRawMail({
    from: 'user@example.com',
    to: 'dev@example.com',
    subject: 'a crash',
    body: 'what happened',
    attachments: [{ name: 'notify.log', text: 'line one\nline two' }].map((a) => ({
      filename: a.name,
      text: a.text,
    })),
    boundary: BOUNDARY,
    date: new Date(Date.parse('2026-09-10T09:00:00.000Z')),
    ...over,
  }).toString('utf8');

/** One part's decoded content, by the name in its Content-Disposition, or the body part when
 * no name is given. */
function partContent(mail: string, filename?: string): string {
  const parts = mail.split(`--${BOUNDARY}`).slice(1, -1);
  const wanted = parts.find((p) =>
    filename ? p.includes(`filename="${filename}"`) : !p.includes('Content-Disposition'),
  );
  const at = wanted?.indexOf('\r\n\r\n') ?? -1;
  if (!wanted || at === -1) return '';
  return Buffer.from(wanted.slice(at + 4).trim().replace(/\r\n/g, ''), 'base64').toString('utf8');
}

describe('buildRawMail', () => {
  it('addresses the mail and declares its own structure', () => {
    const mail = build();
    expect(mail).toContain('From: user@example.com');
    expect(mail).toContain('To: dev@example.com');
    expect(mail).toContain('MIME-Version: 1.0');
    expect(mail).toContain(`Content-Type: multipart/mixed; boundary="${BOUNDARY}"`);
  });

  it('ends the message with the closing boundary', () => {
    expect(build().trimEnd().endsWith(`--${BOUNDARY}--`)).toBe(true);
  });

  it('separates the headers from the body with a blank line', () => {
    const mail = build();
    expect(mail.slice(0, mail.indexOf('\r\n\r\n'))).not.toContain(`--${BOUNDARY}`);
  });

  it('uses CRLF, which is what a mail server counts lines by', () => {
    expect(build().split('\n').every((l) => l === '' || l.endsWith('\r'))).toBe(true);
  });

  it('carries the body so it decodes back to what went in', () => {
    expect(partContent(build({ body: 'stack:\n  at boom()' }))).toBe('stack:\n  at boom()');
  });

  it('carries an attachment so it decodes back byte for byte', () => {
    const log = Array.from({ length: 500 }, (_, i) => `2026-09-10 line ${i}`).join('\n');
    const mail = build({ attachments: [{ filename: 'notify.log', text: log }] });
    expect(partContent(mail, 'notify.log')).toBe(log);
  });

  it('names the attachment so a mail client offers it as a file', () => {
    expect(build()).toContain('Content-Disposition: attachment; filename="notify.log"');
  });

  it('wraps base64 at 76 characters, which is as long as a line may be', () => {
    const mail = build({ attachments: [{ filename: 'notify.log', text: 'x'.repeat(5000) }] });
    expect(mail.split('\r\n').every((l) => l.length <= 76)).toBe(true);
  });

  it('survives a body the boundary could never appear in', () => {
    const mail = build({ body: `--${BOUNDARY}\r\nnot a real part` });
    expect(mail.split(`--${BOUNDARY}`)).toHaveLength(4);
    expect(partContent(mail)).toBe(`--${BOUNDARY}\r\nnot a real part`);
  });

  it('takes a message with nothing attached', () => {
    const mail = build({ attachments: [] });
    expect(mail).not.toContain('Content-Disposition');
    expect(partContent(mail)).toBe('what happened');
  });

  it('keeps a filename a header cannot quote out of the header', () => {
    const mail = build({ attachments: [{ filename: 'notify "odd".log', text: 'x' }] });
    expect(mail).toContain('filename="notify__odd_.log"');
  });
});

describe('encodeHeaderWord', () => {
  it('leaves a plain subject alone, so a mail list stays readable', () => {
    expect(encodeHeaderWord('[crash] 1.0.0 main-exception')).toBe('[crash] 1.0.0 main-exception');
  });

  it('encodes a subject with anything else in it', () => {
    const encoded = encodeHeaderWord('kopiëren mislukt');
    expect(encoded.startsWith('=?UTF-8?B?')).toBe(true);
    const body = encoded.slice('=?UTF-8?B?'.length, -'?='.length);
    expect(Buffer.from(body, 'base64').toString('utf8')).toBe('kopiëren mislukt');
  });

  it('never lets a newline into a header', () => {
    expect(encodeHeaderWord('first\r\nInjected: header')).toBe('first Injected: header');
  });
});
