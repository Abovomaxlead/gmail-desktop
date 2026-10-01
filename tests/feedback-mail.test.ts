// Building the feedback mail: what the user typed, and what we add underneath it.

import { describe, it, expect } from 'vitest';
import {
  BODY_BUDGET,
  FEEDBACK_TO,
  LOG_LINES,
  MESSAGE_CHARS,
  URL_MAX,
  encodedLength,
  feedbackMail,
} from '../electron/feedback/feedback-mail';

const INPUT = {
  text: 'dragging a conversation does nothing',
  version: '1.0.0',
  platform: 'win32',
  osRelease: '10.0.26200',
  mailboxCount: 3,
  logs: [],
  includeDiagnostics: false,
};

const notify = (text: string) => [{ name: 'notify.log', text }];

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

  it('carries every log it is given, each under its own name', () => {
    const body =
      feedbackMail({
        ...INPUT,
        logs: [
          { name: 'notify.log', text: 'a notification was drawn' },
          { name: 'update.log', text: 'checking for an update' },
        ],
        includeDiagnostics: true,
      })?.body ?? '';
    expect(body).toContain('notify.log, most recent lines:');
    expect(body).toContain('a notification was drawn');
    expect(body).toContain('update.log, most recent lines:');
    expect(body).toContain('checking for an update');
  });

  it('keeps the end of the log rather than its start', () => {
    const log = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const body =
      feedbackMail({ ...INPUT, logs: notify(log), includeDiagnostics: true })?.body ?? '';
    expect(body).toContain('line 39');
    expect(body).toContain('line 0');
  });

  it('caps how many lines one log may spend, however short they are', () => {
    const log = Array.from({ length: LOG_LINES + 50 }, (_, i) => `l${i}`).join('\n');
    const body =
      feedbackMail({ ...INPUT, logs: notify(log), includeDiagnostics: true })?.body ?? '';
    expect(body).toContain(`l${LOG_LINES + 49}`);
    expect(body).not.toContain('\nl0\n');
    expect(body.match(/^l\d+$/gm)?.length).toBeLessThanOrEqual(LOG_LINES);
  });

  it('carries far more of the log than a line of it', () => {
    // The whole point of the change: what used to arrive was twenty lines and 1,500 characters.
    const log = Array.from({ length: 400 }, (_, i) => `${i} [maildrop] label listed`).join('\n');
    const body =
      feedbackMail({ ...INPUT, logs: notify(log), includeDiagnostics: true })?.body ?? '';
    expect(body.match(/\[maildrop\]/g)?.length).toBeGreaterThan(100);
  });

  it('never builds a body that Google would refuse', () => {
    const log = Array.from({ length: 2000 }, (_, i) => `${i} ${'ë'.repeat(60)}`).join('\n');
    const mail = feedbackMail({
      ...INPUT,
      text: 'x'.repeat(MESSAGE_CHARS),
      logs: [
        { name: 'notify.log', text: log },
        { name: 'update.log', text: log },
      ],
      includeDiagnostics: true,
    });
    expect(encodedLength(mail?.body ?? '')).toBeLessThanOrEqual(BODY_BUDGET);
    expect(encodedLength(mail?.body ?? '') + 600).toBeLessThanOrEqual(URL_MAX);
  });

  it('cuts a message that only overruns once it is encoded', () => {
    // Every newline is three characters in a URL, so this is inside MESSAGE_CHARS and far
    // outside the budget. It used to open a Google error page instead of a compose window.
    const text = 'a\n'.repeat(MESSAGE_CHARS / 2);
    const mail = feedbackMail({ ...INPUT, text });
    expect(encodedLength(mail?.body ?? '')).toBeLessThanOrEqual(BODY_BUDGET);
    expect(mail?.body).toContain('shortened');
  });

  it('gives the user their words before the log', () => {
    const log = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n');
    const text = 'the drag hangs on a big label, every time, since the update';
    const body = feedbackMail({ ...INPUT, text, logs: notify(log), includeDiagnostics: true })?.body ?? '';
    expect(body.indexOf(text)).toBe(0);
  });

  it('says so when it could not carry the whole log', () => {
    const log = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n');
    const body =
      feedbackMail({ ...INPUT, logs: notify(log), includeDiagnostics: true })?.body ?? '';
    expect(body).toContain('left out');
  });

  it('does not starve the second log for the first', () => {
    const long = Array.from({ length: 2000 }, (_, i) => `first ${i}`).join('\n');
    const body =
      feedbackMail({
        ...INPUT,
        logs: [
          { name: 'notify.log', text: long },
          { name: 'update.log', text: 'the updater said something' },
        ],
        includeDiagnostics: true,
      })?.body ?? '';
    expect(body).toContain('the updater said something');
  });

  it('never asks for a file, because it does not write one', () => {
    const body = feedbackMail({ ...INPUT, includeDiagnostics: true })?.body ?? '';
    expect(body).not.toMatch(/attach|bijlage|\.txt/i);
  });

  it('leaves the log out entirely when there is none', () => {
    const body =
      feedbackMail({ ...INPUT, logs: notify('   \n'), includeDiagnostics: true })?.body ?? '';
    expect(body).not.toContain('notify.log');
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
    const log = `${'x'.repeat(9000)}\nthe last thing that happened`;
    const body =
      feedbackMail({ ...INPUT, logs: notify(log), includeDiagnostics: true })?.body ?? '';
    expect(body).toContain('the last thing that happened');
    expect(body).not.toContain('xxx');
  });

  it('never carries diagnostics the user did not ask for', () => {
    const body = feedbackMail({
      ...INPUT,
      logs: notify('secret line'),
      includeDiagnostics: false,
    })?.body;
    expect(body).not.toContain('secret line');
    expect(body).not.toContain('Windows');
  });
});
