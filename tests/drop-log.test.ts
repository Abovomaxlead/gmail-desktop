// What the drag log may carry into a report nobody read before it left: the event, never the
// mail. log.jsonl holds `from`, `to`, `cc` and `subject` of everything ever dragged, and older
// versions of the app wrote the whole mail body into it as well.

import { describe, expect, it } from 'vitest';
import { pruneDropLog } from '../electron/feedback/drop-log';

const line = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    ts: '2026-09-10T09:00:00.000Z',
    account: 'user@example.com',
    threadId: 'thread-1',
    messageId: '<abc@mail.gmail.com>',
    from: 'klant@elders.nl',
    to: ['user@example.com'],
    cc: ['collega@elders.nl'],
    subject: 'Factuur 2026-441',
    file: 'mail.eml',
    bytes: 4096,
    ...over,
  });

describe('pruneDropLog', () => {
  it('keeps what describes the event', () => {
    const kept = JSON.parse(pruneDropLog(line()));
    expect(kept).toEqual({
      ts: '2026-09-10T09:00:00.000Z',
      account: 'user@example.com',
      threadId: 'thread-1',
      file: 'mail.eml',
      bytes: 4096,
    });
  });

  it('drops every field that describes the mail itself', () => {
    const text = pruneDropLog(line());
    for (const secret of ['Factuur', 'klant@elders.nl', 'collega@elders.nl', 'abc@mail.gmail.com'])
      expect(text).not.toContain(secret);
  });

  it('keeps what a failed drag left behind, which is the whole point', () => {
    const kept = JSON.parse(pruneDropLog(line({ error: 'geen token voor dit postvak' })));
    expect(kept.error).toBe('geen token voor dit postvak');
  });

  it('keeps a copy entry, which names the mailbox and the labels a copy went to', () => {
    const copy = { to: 'other@x.nl', labels: ['Klanten/Acme'], ok: false, error: '429' };
    expect(JSON.parse(pruneDropLog(line({ copy }))).copy).toEqual(copy);
  });

  it('never passes a line it could not parse through', () => {
    // Versions before the cleanup wrote a `body` field with the whole mail text in it, and
    // those lines are still on the share
    const broken = '{"ts":"x","body":"Beste meneer, hierbij de gevraagde';
    const text = pruneDropLog(broken);
    expect(text).not.toContain('Beste meneer');
    expect(text).toContain('unreadable line left out');
  });

  it('drops a field a later version adds until somebody names it', () => {
    expect(pruneDropLog(line({ newField: 'whatever' }))).not.toContain('whatever');
  });

  it('takes the end of the log, which is where the crash is', () => {
    const many = Array.from({ length: 50 }, (_, i) => line({ threadId: `t${i}` })).join('\n');
    const kept = pruneDropLog(many, 3).split('\n');
    expect(kept).toHaveLength(3);
    expect(kept[2]).toContain('t49');
  });

  it('is empty for a log with nothing in it', () => {
    expect(pruneDropLog('\n\n')).toBe('');
  });
});
