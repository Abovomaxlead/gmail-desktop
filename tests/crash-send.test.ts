// The whole automatic report, from the crash to the mail: nobody clicks anything, the logs ride
// along, one fault is sent once, and a machine that cannot send yet loses nothing.
//
// The Gmail call and the notification are the two things stubbed. Everything between them --
// the fingerprint, the queue file in userData, the message that is built, the retry -- is the
// real code, because that is where this feature can be wrong in a way nobody would notice: a
// report that never arrives, or forty that do.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCOPES } from '../electron/auth/google-oauth';
import type { CrashEvent } from '../electron/feedback/crash-report';

let userData = '';
const sent: Buffer[] = [];
const notifications: Array<{ kind: string; title: string; body: string; persist: boolean }> = [];
let sendFails = false;
let account: { email: string; scopes: string[] } | null = null;

vi.mock('electron', () => ({
  app: {
    getVersion: () => '1.2.3',
    getPath: () => userData,
  },
}));

// Kept only to prove nothing is raised: a report is sent silently, since who receives it is not
// the user's business and a card about a mail they did not send is not something to act on.
// What they are told about is the failure itself, in the place it happened -- a dead mail view
// says so in that view (windows/view-crash-page.ts).
vi.mock('../electron/toast/toast-presenter', () => ({
  showToast: (input: { kind: string; title: string; body: string; persist: boolean }) => {
    notifications.push(input);
  },
}));

vi.mock('../electron/core/runtime', () => ({
  get profiles() {
    return account ? [{ ref: { kind: 'authuser', index: 0 }, email: account.email }] : [];
  },
  get oauthTokens() {
    return {
      get: (email: string) =>
        account && email === account.email
          ? { accessToken: 'AT', refreshToken: 'RT', expiresAt: 0, scopes: account.scopes }
          : undefined,
    };
  },
  prefs: { getAll: () => ({ reneMode: false }) },
  currentLocale: () => 'nl',
}));

vi.mock('../electron/auth/mailbox-token', () => ({
  withTokenFor: (email: string) =>
    account && email === account.email
      ? <T,>(fn: (token: string) => Promise<T>) => fn('AT')
      : null,
}));

vi.mock('../electron/gmail/gmail-api', () => ({
  sendRawMessage: async (_token: string, raw: Buffer) => {
    if (sendFails) throw new Error('network down');
    sent.push(raw);
    return 'sent-id';
  },
}));

// The drop folder is the same temporary directory here, so a seeded log.jsonl is found the way
// a real one is: beside the saved mail rather than in userData.
vi.mock('../electron/mail/pull/pull-controller', () => ({ mailDropFolder: () => userData }));

vi.mock('../electron/notify/notify-log', () => ({ notifyLog: () => {} }));

interface Controller {
  reportCrash: (event: CrashEvent) => void;
  flushCrashReports: () => Promise<void>;
}

/** Loaded per test rather than imported once, because the controller's queue-in-flight guard
 * and its flush timer are module state: two tests sharing one instance would share those. This
 * is the module-loading boundary itself, which is the one thing a static import cannot do. */
async function load(): Promise<Controller> {
  vi.resetModules();
  return await import('../electron/feedback/crash-controller');
}

const boom = (message = 'Cannot read properties of undefined') => ({
  kind: 'main-exception' as const,
  message,
  stack: 'Error: boom\n    at pullMailDrop (C:\\app\\mail-drop-controller.js:1203:9)',
  at: Date.now(),
});

/** The queue as it is on disk, which is what survives a restart */
function queued(): unknown[] {
  const path = join(userData, 'crash-reports.json');
  if (!existsSync(path)) return [];
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || !('queue' in parsed)) return [];
  return Array.isArray(parsed.queue) ? parsed.queue : [];
}

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'crash-'));
  writeFileSync(join(userData, 'notify.log'), '2026-09-10 [maildrop] a label drag started\n');
  sent.length = 0;
  notifications.length = 0;
  sendFails = false;
  account = { email: 'user@example.com', scopes: SCOPES };
});

afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

describe('an automatic crash report', () => {
  it('goes out without anybody asking, with the logs inside it', async () => {
    const { reportCrash, flushCrashReports } = await load();
    reportCrash(boom());
    await flushCrashReports();

    expect(sent).toHaveLength(1);
    const mail = sent[0].toString('utf8');
    expect(mail).toContain('To: luca.manuel@abovomaxlead.nl');
    expect(mail).toContain('From: user@example.com');
    expect(mail).toContain('Subject: [crash] 1.2.3 main-exception');
    expect(mail).toContain('filename="notify.log"');
    const attachment = mail.split('filename="notify.log"')[1];
    const base64 = attachment.split('\r\n\r\n')[1].split(`\r\n--`)[0].replace(/\r\n/g, '');
    expect(Buffer.from(base64, 'base64').toString('utf8')).toContain('a label drag started');
  });

  it('takes the drag log too, without the mail metadata in it', async () => {
    writeFileSync(
      join(userData, 'log.jsonl'),
      `${JSON.stringify({
        ts: '2026-09-10T09:00:00.000Z',
        account: 'user@example.com',
        threadId: 'thread-1',
        messageId: '<secret-id@mail.gmail.com>',
        from: 'klant@elders.nl',
        to: ['user@example.com'],
        subject: 'Factuur 2026-441',
        file: 'mail.eml',
        bytes: 4096,
      })}\n`,
    );
    const { reportCrash, flushCrashReports } = await load();
    reportCrash(boom());
    await flushCrashReports();

    const mail = sent[0].toString('utf8');
    expect(mail).toContain('filename="log.jsonl"');
    const part = mail.split('filename="log.jsonl"')[1];
    const text = Buffer.from(
      part.split('\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, ''),
      'base64',
    ).toString('utf8');
    // The event survives
    expect(text).toContain('thread-1');
    expect(text).toContain('mail.eml');
    // Whose mail it was does not
    expect(text).not.toContain('Factuur');
    expect(text).not.toContain('klant@elders.nl');
    expect(text).not.toContain('secret-id');
  });

  it('leaves nothing behind in the queue once it has been sent', async () => {
    const { reportCrash, flushCrashReports } = await load();
    reportCrash(boom());
    expect(queued()).toHaveLength(1);
    await flushCrashReports();
    expect(queued()).toHaveLength(0);
  });

  it('says nothing to the user about it', async () => {
    const { reportCrash, flushCrashReports } = await load();
    reportCrash(boom());
    await flushCrashReports();
    expect(sent).toHaveLength(1);
    expect(notifications).toEqual([]);
  });

  it('sends one mail for a fault that fires over and over', async () => {
    const { reportCrash, flushCrashReports } = await load();
    for (let i = 0; i < 20; i++) reportCrash(boom());
    await flushCrashReports();
    expect(sent).toHaveLength(1);
  });

  it('waits for a mailbox rather than losing the report', async () => {
    const { reportCrash, flushCrashReports } = await load();
    account = null;
    reportCrash(boom());
    await flushCrashReports();
    expect(sent).toHaveLength(0);
    expect(queued()).toHaveLength(1);

    account = { email: 'user@example.com', scopes: SCOPES };
    await flushCrashReports();
    expect(sent).toHaveLength(1);
    expect(queued()).toHaveLength(0);
  });

  it('keeps asking by itself once a mailbox turns up, without a restart', async () => {
    vi.useFakeTimers();
    try {
      const { reportCrash, flushCrashReports } = await load();
      account = null;
      reportCrash(boom());
      await flushCrashReports();
      expect(sent).toHaveLength(0);

      // The account is linked while the app keeps running, which nothing else reports
      account = { email: 'user@example.com', scopes: SCOPES };
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);
      expect(sent).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not send as an account whose token predates the send scope', async () => {
    const { reportCrash, flushCrashReports } = await load();
    account = { email: 'user@example.com', scopes: SCOPES.filter((s) => !s.endsWith('gmail.send')) };
    reportCrash(boom());
    await flushCrashReports();
    expect(sent).toHaveLength(0);
    expect(queued()).toHaveLength(1);
  });

  it('keeps a report a failed send left behind, and sends it next time', async () => {
    const { reportCrash, flushCrashReports } = await load();
    sendFails = true;
    reportCrash(boom());
    await flushCrashReports();
    expect(queued()).toHaveLength(1);

    sendFails = false;
    await flushCrashReports();
    expect(sent).toHaveLength(1);
    expect(queued()).toHaveLength(0);
  });

  it('gives up on a report five failures in, so one bad mail is not retried forever', async () => {
    const { reportCrash, flushCrashReports } = await load();
    sendFails = true;
    reportCrash(boom());
    for (let i = 0; i < 5; i++) await flushCrashReports();
    expect(queued()).toHaveLength(0);
  });

  it('reports two different faults apart, and still silently', async () => {
    const { reportCrash, flushCrashReports } = await load();
    reportCrash(boom('Cannot read properties of undefined'));
    reportCrash(boom('label create refused'));
    await flushCrashReports();
    expect(sent).toHaveLength(2);
    expect(notifications).toEqual([]);
  });
});
