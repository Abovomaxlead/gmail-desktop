// What a card raised from Gmail's own page says.
//
// The page only says the sender's name and the subject. The card leads with the sender's
// address, shows the first lines of the mail and names the inbox it arrived in -- which takes
// an API lookup first. A lookup that finds nothing must still raise the card, and an agenda
// reminder, which arrives the same way, is no mail and gets none of it.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { MessageMeta } from '../electron/gmail/gmail-api';

const state = vi.hoisted(() => ({
  toasts: [] as Array<Record<string, unknown>>,
  inbox: [] as MessageMeta[],
  hidden: {} as { hiddenSender?: string; hiddenSubject?: string },
}));

vi.mock('electron', () => ({ shell: { openPath: vi.fn(), showItemInFolder: vi.fn() } }));
vi.mock('../electron/core/runtime', () => ({
  currentLocale: () => 'nl',
  idxOfKey: () => 0,
  keyOf: () => 'u0',
  mainWindow: null,
  manager: null,
  prefs: { getAll: () => ({ reneMode: false }) },
  profiles: [],
  setSettingsPanelOpen: vi.fn(),
  settingsPanelOpen: false,
}));
vi.mock('../electron/notify/notify-gating', () => ({
  hiddenNotificationText: () => state.hidden,
  playNotificationSound: vi.fn(),
}));
vi.mock('../electron/notify/notification-policy', () => ({
  notificationPersist: () => true,
  notificationSilent: () => true,
}));
vi.mock('../electron/toast/toast-presenter', () => ({
  showToast: (t: Record<string, unknown>) => state.toasts.push(t),
  toastAccountFor: (email: string) => ({ key: 'u0', email, label: email, color: '#000', avatarUrl: '' }),
}));
vi.mock('../electron/auth/mailbox-token', () => ({
  withTokenFor: () => async (fn: (t: string) => unknown) => fn('token'),
}));
vi.mock('../electron/gmail/gmail-api', () => ({
  fetchRecentInboxIds: async () => state.inbox.map((m) => m.id),
  fetchMessageMeta: async (_t: string, id: string) => state.inbox.find((m) => m.id === id) ?? null,
  fetchThreadInboxMeta: async (_t: string, threadId: string) =>
    state.inbox.filter((m) => m.threadId === threadId),
  archiveMessage: vi.fn(),
  markMessageRead: vi.fn(),
}));
vi.mock('../electron/push/mail-sync-controller', () => ({ syncRunnerFor: () => undefined }));
vi.mock('../electron/compose/compose-window', () => ({ openFullThreadWindow: vi.fn() }));
vi.mock('../electron/system/session-setup', () => ({
  forgetDownloadClickPath: vi.fn(),
  takeDownloadClickAction: vi.fn(),
}));
vi.mock('../electron/windows/surface-opener', () => ({ openSurfaceForAccount: vi.fn() }));

const { showWebNotification } = await import('../electron/toast/toast-activation');

const profile = { email: 'robbin@abovomaxlead.nl', ref: { kind: 'authuser', index: 0 } } as never;
const view = (url: string) => ({ id: 7, isDestroyed: () => false, getURL: () => url }) as never;
const MAIL_VIEW = 'https://mail.google.com/mail/u/0/#inbox';
const page = { id: 'p1', title: 'René Kok', body: 'Re: Recystel feed url merchant center' };

const rene: MessageMeta = {
  id: 'm1',
  threadId: 't1',
  from: 'René Kok <rene@recystel.nl>',
  subject: 'Re: Recystel feed url merchant center',
  internalDate: 1,
  messageId: '<m1@x>',
  snippet: 'Hoi Robbin, de feed url staat nu goed in merchant center.',
};

beforeEach(() => {
  state.toasts = [];
  state.inbox = [];
  state.hidden = {};
});

describe('a card raised from the Gmail page', () => {
  it('leads with the sender address, then subject, preview and the inbox it arrived in', async () => {
    state.inbox = [rene];
    await showWebNotification(profile, view(MAIL_VIEW), page);
    expect(state.toasts[0]).toMatchObject({
      title: 'rene@recystel.nl',
      body: 'Re: Recystel feed url merchant center',
      preview: 'Hoi Robbin, de feed url staat nu goed in merchant center.',
      inbox: 'robbin@abovomaxlead.nl',
    });
  });

  it('still goes up with what the page said when the lookup finds nothing', async () => {
    await showWebNotification(profile, view(MAIL_VIEW), page);
    expect(state.toasts).toHaveLength(1);
    expect(state.toasts[0]).toMatchObject({ title: 'René Kok', inbox: 'robbin@abovomaxlead.nl' });
    expect(state.toasts[0]).not.toHaveProperty('preview');
  });

  it('keeps the mail text off the card when the subject is hidden', async () => {
    state.inbox = [rene];
    state.hidden = { hiddenSubject: 'Nieuwe mail' };
    await showWebNotification(profile, view(MAIL_VIEW), page);
    expect(state.toasts[0]).toMatchObject({ title: 'rene@recystel.nl', body: 'Nieuwe mail' });
    expect(state.toasts[0]).not.toHaveProperty('preview');
  });

  it('keeps the address off the card when the sender is hidden', async () => {
    state.inbox = [rene];
    state.hidden = { hiddenSender: 'Iemand' };
    await showWebNotification(profile, view(MAIL_VIEW), page);
    expect(state.toasts[0]).toMatchObject({ title: 'Iemand' });
  });

  it('gives an agenda reminder no inbox line and no mail lookup', async () => {
    state.inbox = [rene];
    await showWebNotification(profile, view('https://calendar.google.com/calendar/u/0/r'), {
      id: 'p2',
      title: 'Overleg Recystel',
      body: '14:00 – 14:30',
    });
    expect(state.toasts[0]).toMatchObject({ title: 'Overleg Recystel', body: '14:00 – 14:30' });
    expect(state.toasts[0]).not.toHaveProperty('inbox');
    expect(state.toasts[0]).not.toHaveProperty('preview');
  });
});
