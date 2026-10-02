// The real mail-drop controller, wired to a fake Gmail and to nothing of Electron.
//
// Mocked: Electron itself, core/runtime (three mailboxes, a main window, a manager and the
// drop overlay as recorders), the token and OAuth modules, the overlay view, toasts, the
// notify log, and gmail-api.ts, which becomes the FakeGmail. Everything else the controller
// touches runs for real: the archive and its log.jsonl, the copy journal, the label-job plan,
// copy-failures, job-failures and account-domain. The drop folder is a temporary directory,
// reached the way a chosen folder is (prefs.mailDrop.folder), so mail-folder.ts runs too.
//
// The one thing changed on the way through is the marker sweep's wait between rounds:
// copy-marker-run-sweep.ts takes a `sleep` for exactly this, and without it every copy would
// spend 300ms of real time confirming that its marker label is empty.

import { expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountKey } from '../../electron/accounts/account-ref';
import { IPC } from '../../electron/core/ipc';
import type {
  MailDropCopyResult,
  MailDropCopyStoppedResult,
  MailDropCopyTarget,
  MailDropCopyWarnedResult,
  MailDropItem,
  MailDropPreviewItem,
} from '../../electron/core/ipc';
import type * as GmailApi from '../../electron/gmail/gmail-api';
import type * as RunSweep from '../../electron/mail/copy-marker-run-sweep';
import type { CopyMode } from '../../electron/mail/mail-copy';
import type { Profile } from '../../electron/windows/profile-view-manager';
import { FakeGmail, bare } from './fake-gmail';


//===========================
// Types
//===========================

export type Controller = typeof import('../../electron/mail/mail-drop-controller');

export type CopyAnswer = MailDropCopyResult | MailDropCopyWarnedResult | MailDropCopyStoppedResult;

/** What the panel was given: an open() payload or a preview send, read loosely on purpose */
export interface PreviewPayload {
  items: MailDropPreviewItem[];
  pullRetryId?: string;
  driven?: boolean;
  [key: string]: unknown;
}

/** What a job's closing line carries, mirroring the controller's own JobEndInfo, which is not exported */
export interface JobEndPayload {
  outcome: string;
  label: string;
  done: number;
  total: number;
  batches: number;
  copiedBatches: number;
  targets: string[];
  error?: string;
  failed?: number;
  retryId?: string;
}

interface HarnessState {
  root: string;
  fake: FakeGmail;
  /** Everything the drop overlay was handed, `open` recorded under the channel name 'open'.
   * `delivered` is false for what the real OverlayView drops: a send or update before its first open */
  overlay: Array<{ channel: string; payload: unknown; delivered: boolean }>;
  dropOverlay: unknown;
  dropResults: Array<{ acctKey: string; result: unknown }>;
  dropLocks: unknown[];
  toasts: Array<{ id: string; input: unknown }>;
  dismissed: string[];
  log: string[];
  /** Mailboxes whose token is refused, for a scenario about a mailbox that cannot be reached */
  noToken: Set<string>;
  controller: Controller | null;
}

export interface Harness {
  readonly fake: FakeGmail;
  /** The drop folder, a temporary directory removed by stopHarness */
  readonly root: string;
  readonly controller: Controller;
  readonly state: HarnessState;
  fresh(): Promise<Controller>;
  seedConversations(count: number, labelIds?: string[]): { items: MailDropItem[]; ids: string[]; threadIds: string[] };
  drag(items: MailDropItem[]): Promise<PreviewPayload | null>;
  dragLabel(label: string): Promise<PreviewPayload | null>;
  copy(targets: MailDropCopyTarget[], mode?: CopyMode): Promise<CopyAnswer>;
  retryCopy(retryId: string, mode?: CopyMode): Promise<CopyAnswer>;
  retryPull(retryId: string): ReturnType<Controller['retryFailedPull']>;
  lastPreview(): PreviewPayload | null;
  sent(channel: string): unknown[];
  undelivered(channel: string): unknown[];
  retryJob(retryId: string, mode?: CopyMode): Promise<CopyAnswer>;
  decideJob(jobId: string, choice: 'continue' | 'keep' | 'rollback'): ReturnType<Controller['decideJobRun']>;
  waitFor(done: () => boolean, what: string, maxTurns?: number): Promise<void>;
  waitForJobEnd(maxTurns?: number): Promise<JobEndPayload>;
  drain(): Promise<void>;
  inserts(email: string, messageId: string): number;
  expectLanded(email: string, expected: Record<string, string[]>): void;
  settle(): Promise<void>;
}


//===========================
// Constants
//===========================

export const SOURCE = 'bron@abovomaxlead.nl';
export const TARGET_A = 'doel@abovomaxlead.nl';
export const TARGET_B = 'tweede@abovomaxlead.nl';

const PROFILES: Profile[] = [SOURCE, TARGET_A, TARGET_B].map((email, index) => ({
  ref: { kind: 'authuser', index },
  kind: 'authuser',
  email,
  name: email.split('@')[0],
  avatarUrl: '',
  color: '#000000',
}));

const SOURCE_KEY = accountKey(PROFILES[0].ref);


//===========================
// Module state
//===========================

let current: HarnessState | null = null;

/** The real gmail-api module the latest mock factory saw, bound into every new fake */
let lastReal: typeof GmailApi | null = null;


//===========================
// Mocks
//===========================

vi.mock('electron', () => ({
  app: {
    getPath: () => state().root,
    getAppPath: () => state().root,
    getVersion: () => '0.0.0-test',
  },
  session: { fromPartition: () => ({}) },
}));

vi.mock('../../electron/core/runtime', () => ({
  get mainWindow() {
    return { isDestroyed: () => false, isMinimized: () => false, restore() {}, show() {}, focus() {} };
  },
  get manager() {
    return {
      sendDropResult: (acctKey: string, result: unknown) => state().dropResults.push({ acctKey, result }),
      sendDropLock: (lock: unknown) => state().dropLocks.push(lock),
      sendDropProgress: () => {},
      activeKey: () => SOURCE_KEY,
      withHiddenView: async () => {},
    };
  },
  get prefs() {
    return { getAll: () => ({ mailDrop: { folder: state().root }, reneMode: false }) };
  },
  get recentLabels() {
    return { remember: () => {} };
  },
  // Only handed on to forceRefresh, which is mocked; it has to be there for a copy to start
  get oauthTokens() {
    return {};
  },
  get messageIndex() {
    return null;
  },
  get dropOverlay() {
    return state().dropOverlay;
  },
  setDropOverlay: (v: unknown) => {
    state().dropOverlay = v;
  },
  profiles: PROFILES,
  keyOf: (p: Profile) => accountKey(p.ref),
  currentLocale: () => 'nl',
  currentlyDark: () => false,
}));

vi.mock('../../electron/auth/mailbox-token', () => {
  const tokenOf = (email: string): string | null =>
    state().fake.mailboxes.has(email) && !state().noToken.has(email) ? state().fake.tokenFor(email) : null;
  return {
    isDelegatedMailbox: () => false,
    mailboxToken: async (email: string) => {
      const token = tokenOf(email);
      return token ? { ok: true, token } : { ok: false, error: 'Verbinding verlopen' };
    },
    withMailboxToken: async (email: string) => {
      const token = tokenOf(email);
      return token ? <T>(fn: (t: string) => Promise<T>) => fn(token) : null;
    },
    delegatedTokenFor: async () => ({ ok: false, error: 'Relay voor gedelegeerde postvakken niet ingesteld' }),
    forgetDelegatedToken: () => {},
    mailboxRefusedText: () => 'Verbinding verlopen',
  };
});

vi.mock('../../electron/auth/oauth-config', () => ({
  oauthConfig: () => ({ clientId: 'test-client', clientSecret: 'test-secret' }),
  delegatedTokenUrl: () => null,
}));

vi.mock('../../electron/auth/oauth-flow', () => ({
  forceRefresh: async () => null,
  accessTokenFor: async () => null,
}));

vi.mock('../../electron/auth/oauth-health-check', () => ({
  markRefreshFailed: () => {},
  clearRefreshFailure: () => {},
}));

vi.mock('../../electron/windows/overlay-view', () => ({
  OverlayView: class {
    // The real view exists only from the first open on, and drops whatever reaches it before
    private created = false;
    open(payload: unknown): void {
      this.created = true;
      state().overlay.push({ channel: 'open', payload, delivered: true });
    }
    update(payload: unknown): void {
      state().overlay.push({ channel: 'update', payload, delivered: this.created });
    }
    send(channel: string, payload: unknown): void {
      state().overlay.push({ channel, payload, delivered: this.created });
    }
    close(): void {
      state().overlay.push({ channel: 'close', payload: null, delivered: this.created });
    }
    raise(): void {}
    isOpen(): boolean {
      return true;
    }
  },
}));

vi.mock('../../electron/toast/toast-presenter', () => ({
  showToast: (input: unknown) => {
    const id = `toast-${state().toasts.length + 1}`;
    state().toasts.push({ id, input });
    return id;
  },
  dismissShownToast: (id: string) => {
    state().dismissed.push(id);
  },
}));

vi.mock('../../electron/notify/notify-log', () => ({
  notifyLog: (line: string) => {
    state().log.push(line);
  },
}));

vi.mock('../../electron/gmail/gmail-api', async (importOriginal) => {
  const real = await importOriginal<typeof GmailApi>();
  lastReal = real;
  state().fake.bind(real);
  // Looked up per call, so a fake replaced between tests is the one that answers
  const api = state().fake.api();
  const live = Object.fromEntries(
    Object.keys(api).map((name) => [
      name,
      (...args: unknown[]) => (state().fake.api() as Record<string, (...a: unknown[]) => unknown>)[name](...args),
    ]),
  );
  return { ...real, ...live };
});

vi.mock('../../electron/mail/copy-marker-run-sweep', async (importOriginal) => {
  const real = await importOriginal<typeof RunSweep>();
  const noWait = async (): Promise<void> => {};
  return {
    ...real,
    sweepRunMarkers: (...[runId, markers, mode, deps, onProgress]: Parameters<typeof real.sweepRunMarkers>) =>
      real.sweepRunMarkers(runId, markers, mode, { ...deps, sleep: noWait }, onProgress),
  };
});


//===========================
// Exported functions
//===========================

/**
 * Starts a test on an empty drop folder, three empty mailboxes and a freshly imported controller
 *
 * @returns the harness
 */
export async function startHarness(): Promise<Harness> {
  const fake = new FakeGmail([SOURCE, TARGET_A, TARGET_B]);
  if (lastReal) fake.bind(lastReal);
  current = {
    root: mkdtempSync(join(tmpdir(), 'maildrop-harness-')),
    fake,
    overlay: [],
    dropOverlay: null,
    dropResults: [],
    dropLocks: [],
    toasts: [],
    dismissed: [],
    log: [],
    noToken: new Set(),
    controller: null,
  };
  await fresh();
  return harness(current);
}

/**
 * Ends a test: drains what the controller left running, then removes the drop folder
 */
export async function stopHarness(): Promise<void> {
  if (!current) return;
  try {
    await drain();
  } finally {
    rmSync(current.root, { recursive: true, force: true });
    current = null;
  }
}


//===========================
// Helper functions
//===========================

function state(): HarnessState {
  if (!current) throw new Error('controller harness: startHarness() has not run');
  return current;
}

/**
 * Imports the controller anew, as an app restart would find it: same disk, no module state
 *
 * @returns the new controller
 * @private
 */
async function fresh(): Promise<Controller> {
  vi.resetModules();
  const s = state();
  s.dropOverlay = null;
  s.controller = await import('../../electron/mail/mail-drop-controller');
  return s.controller;
}

/**
 * Lets every promise the controller left running without awaiting it come to rest
 *
 * The fake answers without timers, so what is left after a drag is a chain of microtasks and
 * the odd file write; a few turns of the event loop see all of it through.
 *
 * @private
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise<void>((r) => setImmediate(r));
}

/**
 * Turns the event loop until a condition holds, failing loudly when it never does
 *
 * Macrotask turns rather than microtasks, so the file writes and reads the controller hands to
 * the threadpool get to finish between two looks.
 *
 * @param done
 * @param what named in the failure
 * @param maxTurns the hard cap
 * @private
 */
async function waitFor(done: () => boolean, what: string, maxTurns = 500): Promise<void> {
  for (let turn = 0; turn < maxTurns; turn++) {
    if (done()) return;
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  if (done()) return;
  throw new Error(`controller harness: ${what} not reached after ${maxTurns} turns`);
}

/**
 * Lets whatever the controller left running finish before the test lets go of its folder
 *
 * Waits for the drop lock to be released, then gives the event loop twenty more turns for the
 * writes and scans nobody awaits. A copy the test did not await is the test's own to await
 *
 * @private
 */
async function drain(): Promise<void> {
  const s = state();
  const unlocked = (): boolean => {
    const locks = s.dropLocks as Array<{ locked?: boolean }>;
    return locks.length === 0 || locks[locks.length - 1]?.locked === false;
  };
  await waitFor(unlocked, 'the drop lock released');
  for (let i = 0; i < 20; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

/**
 * Builds the helper object over one test's state
 *
 * @param s
 * @returns the harness
 * @private
 */
function harness(s: HarnessState): Harness {
  const controller = (): Controller => {
    if (!s.controller) throw new Error('controller harness: no controller imported');
    return s.controller;
  };
  const lastPreview = (): PreviewPayload | null => {
    for (let i = s.overlay.length - 1; i >= 0; i--) {
      const { channel, payload, delivered } = s.overlay[i];
      if (delivered && (channel === 'open' || channel === IPC.MAIL_DROP_PREVIEW)) return payload as PreviewPayload;
    }
    return null;
  };
  return {
    fake: s.fake,
    root: s.root,
    state: s,
    get controller() {
      return controller();
    },
    fresh,
    seedConversations: (count, labelIds = ['INBOX']) => {
      const items: MailDropItem[] = [];
      const ids: string[] = [];
      const threadIds: string[] = [];
      for (let i = 1; i <= count; i++) {
        const threadId = `thread-${i}`;
        const subject = `Mail ${i}`;
        const [messageId] = s.fake.seedThread(SOURCE, threadId, [{ messageId: `<mail-${i}@harness.test>`, subject }], labelIds);
        items.push({ threadId, subject });
        ids.push(messageId);
        threadIds.push(threadId);
      }
      return { items, ids, threadIds };
    },
    drag: async (items) => {
      await controller().handleMailDrop(SOURCE_KEY, { items, authuser: '0', ik: 'ik-harness' });
      await settle();
      return lastPreview();
    },
    dragLabel: async (label) => {
      await controller().handleMailDrop(SOURCE_KEY, { items: [], authuser: '0', ik: 'ik-harness', label });
      await settle();
      return lastPreview();
    },
    copy: (targets, mode = 'check') => controller().copyToMailboxes({ targets, mode }),
    retryCopy: (retryId, mode = 'check') => controller().retryFailedCopy({ retryId, mode }),
    retryPull: (retryId) => controller().retryFailedPull({ retryId }),
    lastPreview,
    sent: (channel) => s.overlay.filter((o) => o.delivered && o.channel === channel).map((o) => o.payload),
    undelivered: (channel) => s.overlay.filter((o) => !o.delivered && o.channel === channel).map((o) => o.payload),
    retryJob: (retryId, mode = 'check') => controller().retryFailedJob({ retryId, mode }),
    decideJob: (jobId, choice) => controller().decideJobRun(jobId, choice),
    waitFor,
    waitForJobEnd: async (maxTurns) => {
      const ends = (): JobEndPayload[] =>
        s.overlay
          .filter((o) => o.channel === IPC.MAIL_DROP_COPY_PROGRESS)
          .map((o) => (o.payload as { jobEnd?: JobEndPayload }).jobEnd)
          .filter((e): e is JobEndPayload => e !== undefined);
      await waitFor(() => ends().length > 0, 'a job end on the copy progress channel', maxTurns);
      return ends()[ends().length - 1];
    },
    drain,
    inserts: (email, messageId) => s.fake.inserts(email, messageId),
    expectLanded: (email, expected) => {
      const wanted = new Map(Object.entries(expected).map(([id, labels]) => [bare(id), labels]));
      for (const id of new Set([...s.fake.knownMessageIds(), ...wanted.keys()])) {
        const copies = s.fake.stored(email, id);
        const labels = wanted.get(id);
        expect(copies.length, `${email} holds ${id} ${copies.length} time(s)`).toBe(labels ? 1 : 0);
        if (labels) expect([...copies[0].labelIds].sort(), `labels of ${id} in ${email}`).toEqual([...labels].sort());
      }
    },
    settle,
  };
}
