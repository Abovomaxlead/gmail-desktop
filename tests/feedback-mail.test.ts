// Building the feedback mail: what the user typed, and what we add underneath it.

import { describe, it, expect } from 'vitest';
import {
  FEEDBACK_TO,
  LOG_LINES,
  MESSAGE_CHARS,
  feedbackMail,
} from '../electron/feedback/feedback-mail';

const INPUT = {
  text: 'dragging a conversation does nothing',
  version: '1.0.0',
  platform: 'win32',
  osRelease: '10.0.26200',
  mailboxCount: 3,
  log: '',
  includeDiagnostics: false,
};

describe('feedbackMail', () => {
  it('refuses a message with nothing in it', () => {
    expect(feedbackMail({ ...INPUT, text: '   \n  ' })).toBeNull();
  });

  it('addresses the mail and names the version in the subject', () => {
    const mail = feedbackMail(INPUT);
    expect(mail?.to).toBe(FEEDBACK_TO);
    expect(mail?.subject).toBe('Feedback Gmail Desktop 1.0.0');
  });

  it('sends the message on its own when diagnostics are off', () => {
    expect(feedbackMail(INPUT)?.body).toBe('dragging a conversation does nothing');
  });

  it('puts the message first and the diagnostics under a separator', () => {
    const body = feedbackMail({ ...INPUT, includeDiagnostics: true })?.body ?? '';
    expect(body.indexOf('dragging a conversation')).toBe(0);
    expect(body).toContain('1.0.0');
    expect(body).toContain('10.0.26200');
    expect(body).toContain('3');
    expect(body.indexOf('1.0.0')).toBeGreaterThan(body.indexOf('dragging'));
  });

  it('names the platform in words rather than in node spelling', () => {
    const win = feedbackMail({ ...INPUT, includeDiagnostics: true })?.body ?? '';
    expect(win).toContain('Windows');
    expect(win).not.toContain('win32');
    const mac =
      feedbackMail({ ...INPUT, platform: 'darwin', includeDiagnostics: true })?.body ?? '';
    expect(mac).toContain('macOS');
  });

  it('keeps only the last log lines', () => {
    const log = Array.from({ length: LOG_LINES + 10 }, (_, i) => `line ${i}`).join('\n');
    const body = feedbackMail({ ...INPUT, log, includeDiagnostics: true })?.body ?? '';
    expect(body).toContain(`line ${LOG_LINES + 9}`);
    expect(body).not.toContain('line 0\n');
    expect(body.match(/^line \d+$/gm)?.length).toBe(LOG_LINES);
  });

  it('trims a log whose lines are long, keeping the end', () => {
    const log = `${'x'.repeat(5000)}\nthe last thing that happened`;
    const body = feedbackMail({ ...INPUT, log, includeDiagnostics: true })?.body ?? '';
    expect(body).toContain('the last thing that happened');
    expect(body.length).toBeLessThan(2500);
  });

  it('leaves the log out entirely when there is none', () => {
    const body = feedbackMail({ ...INPUT, log: '   \n', includeDiagnostics: true })?.body ?? '';
    expect(body).not.toContain('update.log');
  });

  it('cuts a pasted-in wall of text, and says that it did', () => {
    const mail = feedbackMail({ ...INPUT, text: 'x'.repeat(MESSAGE_CHARS + 500) });
    expect(mail?.body.length).toBeLessThan(MESSAGE_CHARS + 100);
    expect(mail?.body).toContain('shortened');
  });

  it('leaves a message that fits exactly as it was typed', () => {
    const text = 'x'.repeat(MESSAGE_CHARS);
    expect(feedbackMail({ ...INPUT, text })?.body).toBe(text);
  });

  it('cuts the log at a line boundary rather than mid-word', () => {
    const log = `${'x'.repeat(3000)}\nthe last thing that happened`;
    const body = feedbackMail({ ...INPUT, log, includeDiagnostics: true })?.body ?? '';
    expect(body).toContain('the last thing that happened');
    expect(body).not.toContain('xxx');
  });

  it('never carries diagnostics the user did not ask for', () => {
    const body = feedbackMail({ ...INPUT, log: 'secret line', includeDiagnostics: false })?.body;
    expect(body).not.toContain('secret line');
    expect(body).not.toContain('Windows');
  });
});
