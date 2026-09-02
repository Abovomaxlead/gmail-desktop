import { describe, expect, it, vi } from 'vitest';

/**
 * LABELS_GET serves two callers over one channel
 *
 * The copy window leaves out the mailbox the drag came from; label cleanup, which has no
 * source, must be offered every mailbox. Sharing one answer hid the user's own mailbox from
 * the cleanup dropdown for the rest of the session after a single drag.
 */

const handlers = new Map<string, (event: unknown, arg?: unknown) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, arg?: unknown) => unknown) => {
      handlers.set(channel, fn);
    },
    on: () => {},
  },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  shell: {},
  app: { getAppPath: () => '/app', getPath: () => '/userData', isPackaged: false },
  clipboard: { writeText: () => {} },
  session: { fromPartition: () => ({}) },
}));

const labelsForCopyTargets = vi.fn(async () => ({ accounts: [{ email: 'support@x.nl' }] }));
const labelsForEveryMailbox = vi.fn(async () => ({
  accounts: [{ email: 'luca@x.nl' }, { email: 'support@x.nl' }],
}));

vi.mock('../electron/mail/mail-drop-controller', () => ({
  cancelMailDropPull: () => {},
  closeDropPreview: () => {},
  controlCopyRun: () => {},
  copyToMailboxes: () => {},
  decideJobRun: () => {},
  decideOrphanRun: () => {},
  dropPreviewItems: () => ({}),
  existingForCopyTargets: () => ({}),
  labelsForCopyTargets,
  labelsForEveryMailbox,
  mailDropFolder: () => '/drop',
  mailDropStatus: () => ({}),
  pendingJobDecision: () => null,
  pendingOrphanDecision: () => null,
}));

const { registerIpc } = await import('../electron/core/ipc-handlers');
registerIpc();
const labelsGet = handlers.get('gmail:labels-get');

describe('LABELS_GET', () => {
  it('is registered', () => {
    expect(labelsGet).toBeTypeOf('function');
  });

  it('gives the copy window the targets, with the drag source left out', async () => {
    await expect(labelsGet?.({})).resolves.toEqual({ accounts: [{ email: 'support@x.nl' }] });
    expect(labelsForEveryMailbox).not.toHaveBeenCalled();
  });

  it('gives label cleanup every mailbox when it asks for them', async () => {
    await expect(labelsGet?.({}, { everyMailbox: true })).resolves.toEqual({
      accounts: [{ email: 'luca@x.nl' }, { email: 'support@x.nl' }],
    });
  });
});
