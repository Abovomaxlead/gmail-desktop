// What a log may say once it is leaving the machine. The direction that matters is one-way:
// a line that keeps too little is a worse bug report, a line that keeps too much is a leak.

import { describe, it, expect } from 'vitest';
import { HIDDEN, REDACTED, redactLog, redactLogLine } from '../electron/feedback/log-redact';

describe('redactLogLine — credentials', () => {
  it('masks a Google access token wherever it turns up', () => {
    const line = redactLogLine('[oauth] refresh failed with ya29.a0AfB_byC-9xQlong_token_here');
    expect(line).not.toContain('ya29.');
    expect(line).toContain(REDACTED);
    expect(line).toContain('[oauth] refresh failed with');
  });

  it('masks a refresh token', () => {
    expect(redactLogLine('token store holds 1//04xSdLm-9QqTgYIARAAGAQSNwF')).not.toContain('1//04');
  });

  it('masks a client secret by its shape and by its name', () => {
    expect(redactLogLine('client_secret=GOCSPX-abcdefghijklmnop')).toBe(
      `client_secret=${REDACTED}`,
    );
    expect(redactLogLine('using GOCSPX-abcdefghijklmnop for the exchange')).toContain(REDACTED);
  });

  it('masks a JWT', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl';
    expect(redactLogLine(`id_token ${jwt} accepted`)).not.toContain('eyJ');
  });

  it('masks the value of any key that names a secret', () => {
    for (const line of [
      'access_token=1234567890abcdefgh',
      'refresh_token: 1234567890abcdefgh',
      'Authorization: Bearer 1234567890abcdefgh',
      'api_key="1234567890abcdefgh"',
      'password=1234567890abcdefgh',
      'code=4/0AeanS0Zx9Kq-1234567890',
    ]) {
      const out = redactLogLine(line);
      expect(out, line).toContain(REDACTED);
      expect(out, line).not.toContain('1234567890');
    }
  });

  it('leaves a short value alone, because that is a status and not a secret', () => {
    expect(redactLogLine('[gmail] insert failed, code=404')).toBe(
      '[gmail] insert failed, code=404',
    );
  });
});

describe('redactLogLine — mail content', () => {
  it('hides the subject Gmail put in the notification', () => {
    const line = redactLogLine(
      '2026-09-01T08:00:00.000Z [notify] raise web jan@example.com src=w1:2 subject="Factuur 2026-114 staat klaar" persist=true silent=false',
    );
    expect(line).not.toContain('Factuur');
    expect(line).toContain(`subject="${HIDDEN}"`);
    // The rest of the line is the diagnostic and stays: which mailbox, which source, what the
    // settings said.
    expect(line).toContain('jan@example.com');
    expect(line).toContain('src=w1:2');
    expect(line).toContain('persist=true');
  });

  it('hides a toast title, which is the sender', () => {
    const line = redactLogLine('[toast] stack draws "Jan de Vries"');
    expect(line).toBe(`[toast] stack draws "${HIDDEN}"`);
  });

  it('hides every quoted run on a toast line', () => {
    const line = redactLogLine('[toast] no stack at all to show "Jan de Vries" in — falling back');
    expect(line).not.toContain('Jan');
    expect(line).toContain('falling back');
  });

  it('keeps label names, which are not mail content and are the whole diagnostic', () => {
    const line = '[maildrop] label "Klanten/2026" opgesomd: 1832 gesprekken in 4 label(s), 3.1s';
    expect(redactLogLine(line)).toBe(line);
  });

  it('keeps counts, timings and mailbox addresses', () => {
    const line = '[maildrop] copy klaar: 79 gekopieerd, 3 overgeslagen naar support@example.com';
    expect(redactLogLine(line)).toBe(line);
  });
});

describe('redactLog', () => {
  it('answers an empty log with an empty log', () => {
    expect(redactLog('')).toBe('');
  });

  it('keeps the shape of the file, line for line', () => {
    const log = 'first\n[toast] stack draws "Jan"\nthird\n';
    expect(redactLog(log)).toBe(`first\n[toast] stack draws "${HIDDEN}"\nthird\n`);
  });

  it('leaves nothing sensitive behind in a whole file', () => {
    const log = [
      '2026-09-01T08:00:00.000Z [notify] raise web a@b.nl src=w1:1 subject="Betaalherinnering"',
      '2026-09-01T08:00:01.000Z [toast] stack draws "Boekhouding B.V."',
      '2026-09-01T08:00:02.000Z [oauth] token refresh with ya29.a0AfB_byCabcdefgh',
      '2026-09-01T08:00:03.000Z [maildrop] label "Klanten" opgesomd: 12 gesprekken',
    ].join('\n');
    const out = redactLog(log);
    for (const secret of ['Betaalherinnering', 'Boekhouding', 'ya29.']) {
      expect(out, secret).not.toContain(secret);
    }
    expect(out).toContain('[maildrop] label "Klanten"');
    expect(out.split('\n')).toHaveLength(4);
  });
});

describe('redactLog — records that run over several lines', () => {
  it('reads a continuation line as part of the record above it', () => {
    const log = [
      '2026-09-01T08:00:00.000Z [toast] page says [warning] a message that goes on:',
      '  "Boekhouding B.V." was the title it was drawing',
      '2026-09-01T08:00:01.000Z [maildrop] label "Klanten" opgesomd: 12 gesprekken',
    ].join('\n');
    const out = redactLog(log).split('\n');
    expect(out[1]).not.toContain('Boekhouding');
    expect(out[1]).toContain(HIDDEN);
    // And the record after it starts over: a label is not a toast title.
    expect(out[2]).toContain('label "Klanten"');
  });

  it('does not spread the toast rule over the records that follow', () => {
    const log = [
      '2026-09-01T08:00:00.000Z [toast] stack draws "Jan"',
      '2026-09-01T08:00:01.000Z [maildrop] label "Klanten/2026" gelezen',
      '2026-09-01T08:00:02.000Z [opruimen] label "Archief" leeggemaakt',
    ].join('\n');
    const out = redactLog(log).split('\n');
    expect(out[1]).toContain('"Klanten/2026"');
    expect(out[2]).toContain('"Archief"');
  });
});
