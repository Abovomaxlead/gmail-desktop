// Which mail a notification click opens.
//
// The click asks the Gmail API which message the card was about and gets an exact answer
// back: a message id, and the id of the conversation it sits in. Only the conversation was
// ever passed on. A conversation is opened by an id that belongs to its *first* message,
// so Gmail was handed the oldest mail in the thread and unfolded it — "click a new mail,
// read an old one", which is the bug this file holds shut.
//
// Everything around the decision is faked down to the two things worth asserting: which
// thread the mail view is sent to, and which message it is told to show there.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { MessageMeta } from '../electron/gmail/gmail-api';

const state = vi.hoisted(() => ({
  openMailThread: vi.fn(),
  popOutThread: vi.fn(async () => true),
  markNotificationClickHandled: vi.fn(),
  openMailSearch: vi.fn(() => true),
  showAccount: vi.fn(),
  openFullThreadWindow: vi.fn(),
  notificationOpen: 'inline' as 'inline' | 'window',
  inbox: [] as MessageMeta[],
  tokenFor: (async (fn: (t: string) => unknown) => fn('token')) as unknown,
}));

vi.mock('electron', () => ({ shell: { openPath: vi.fn(), showItemInFolder: vi.fn() } }));

vi.mock('../electron/core/runtime', () => ({
  authRef: (index: number) => ({ kind: 'authuser', index }),
  idxOfKey: (key: string) => (key === 'u0' ? 0 : null),
  isQuitting: false,
  keyOf: (p: { ref: { index: number } }) => `u${p.ref.index}`,
  mainWindow: {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { send: vi.fn() },
  },
  manager: {
    openMailThread: state.openMailThread,
    popOutThread: state.popOutThread,
    markNotificationClickHandled: state.markNotificationClickHandled,
    openMailSearch: state.openMailSearch,
  },
  prefs: { getAll: () => ({ notificationOpen: state.notificationOpen }) },
  profiles: [{ email: 'luca@example.com', ref: { kind: 'authuser', index: 0 } }],
  setDetectionStarted: vi.fn(),
  setSettingsPanelOpen: vi.fn(),
  settingsPanelOpen: false,
}));

vi.mock('../electron/windows/view-surfaces', () => ({ showAccount: state.showAccount }));
vi.mock('../electron/compose/compose-window', () => ({
  openFullThreadWindow: state.openFullThreadWindow,
}));
vi.mock('../electron/system/session-setup', () => ({
  forgetDownloadClickPath: vi.fn(),
  takeDownloadClickAction: vi.fn(),
}));
vi.mock('../electron/auth/mailbox-token', () => ({
  withTokenFor: () => state.tokenFor as never,
}));
vi.mock('../electron/gmail/gmail-api', () => ({
  fetchRecentInboxIds: async () => state.inbox.map((m) => m.id),
  fetchMessageMeta: async (_t: string, id: string) =>
    state.inbox.find((m) => m.id === id) ?? null,
  archiveMessage: vi.fn(),
  markMessageRead: vi.fn(),
}));

const { activateToast, rememberWebNotifySource } = await import(
  '../electron/toast/toast-activation'
);

/** The conversation: an opening mail, and the reply the card was raised for. Gmail names
 * the thread after the first of the two. */
const THREAD = '1a01f12d2ec28372';
const REPLY = '1a01f14e87dea294';

const meta = (id: string, threadId: string, subject: string, date: number): MessageMeta => ({
  id,
  threadId,
  from: 'Bakkerij De Vries <info@example.com>',
  subject,
  internalDate: date,
  messageId: `<${id}@mail.example.com>`,
});

const account = {
  key: 'u0',
  email: 'luca@example.com',
  label: 'luca',
  color: '#000',
  avatarUrl: '',
};

function webNotifyToast(subject: string) {
  rememberWebNotifySource('src-1', {
    wc: { isDestroyed: () => false, send: vi.fn() } as never,
    pageId: 'page-1',
    email: 'luca@example.com',
    notified: { sender: 'Bakkerij De Vries', subject },
  });
  return { id: 't1', kind: 'mail' as const, title: 'x', body: subject, account, webNotifyId: 'src-1' };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  state.notificationOpen = 'inline';
  state.inbox = [
    meta(REPLY, THREAD, 'Re: Radiocommercial AI', 1_700_000_200_000),
    meta(THREAD, THREAD, 'Radiocommercial AI', 1_700_000_100_000),
  ];
});

describe('a clicked notification opens the mail it was about', () => {
  it('sends the view to the conversation and to the reply inside it', async () => {
    activateToast(webNotifyToast('Re: Radiocommercial AI'));
    await flush();

    expect(state.openMailThread).toHaveBeenCalledWith('u0', THREAD, REPLY);
  });

  it('does not fall back to the id of the conversation, which is the oldest mail', async () => {
    activateToast(webNotifyToast('Re: Radiocommercial AI'));
    await flush();

    const [, threadId, messageId] = state.openMailThread.mock.calls[0];
    expect(threadId).toBe(THREAD);
    expect(messageId).not.toBe(threadId);
  });

  // The one case where the two ids are the same mail, and nothing is lost by saying so.
  it('names the opening mail when that is the one that arrived', async () => {
    state.inbox = [meta(THREAD, THREAD, 'Radiocommercial AI', 1_700_000_100_000)];

    activateToast(webNotifyToast('Radiocommercial AI'));
    await flush();

    expect(state.openMailThread).toHaveBeenCalledWith('u0', THREAD, THREAD);
  });

  it('asks the page instead when the API recognises nothing, and opens no thread itself', async () => {
    activateToast(webNotifyToast('A subject no message carries'));
    await flush();

    expect(state.openMailThread).not.toHaveBeenCalled();
  });

  it('carries the message into the pop-out, and into the window that stands in for it', async () => {
    state.notificationOpen = 'window';
    state.popOutThread.mockResolvedValueOnce(false);

    activateToast(webNotifyToast('Re: Radiocommercial AI'));
    await flush();

    expect(state.popOutThread).toHaveBeenCalledWith('u0', THREAD, 'Re: Radiocommercial AI', REPLY);
    expect(state.openFullThreadWindow).toHaveBeenCalledWith(0, THREAD, REPLY);
  });

  it('passes on the message id a push notification already carried', async () => {
    activateToast({
      id: 't2',
      kind: 'mail',
      title: 'Bakkerij De Vries',
      body: 'Re: Radiocommercial AI',
      account,
      threadId: THREAD,
      messageId: REPLY,
    });
    await flush();

    expect(state.openMailThread).toHaveBeenCalledWith('u0', THREAD, REPLY);
  });
});
