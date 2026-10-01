// Whether a mailto: that arrives before the app can compose survives a second one.
//
// A cold start with a mailto: in argv, followed by a second-instance mailto: before
// detection has finished, used to overwrite the first slot silently -- see
// dist/audit/core-infra.md, "A second mailto: before the app is ready destroys the first".

import { describe, expect, it, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  composed: [] as Array<{ index: number; to: string }>,
  ready: false,
}));

vi.mock('electron', () => ({
  app: { getAppPath: () => '/app', getPath: () => '/userData' },
}));

vi.mock('../electron/core/runtime', () => ({
  authIdx: (p: { ref: { index: number } }) => p.ref.index,
  currentLocale: () => 'nl',
  mainWindow: null,
  manager: { activeKey: () => (state.ready ? 'u0' : null) },
  pendingMailtos: [] as string[],
  prefs: { getAll: () => ({ reneMode: false }), getAccount: () => ({}) },
  profiles: [{ ref: { kind: 'authuser', index: 0 }, kind: 'authuser', email: 'a@example.nl' }],
}));

vi.mock('../electron/compose/compose-window', () => ({
  openCompose: (index: number, _title: string, fields?: { to: string }) =>
    state.composed.push({ index, to: fields?.to ?? '' }),
}));

vi.mock('../electron/compose/compose-account-window', () => ({
  openComposeAccountWindow: vi.fn(),
  resizeAndShowComposeAccountWindow: vi.fn(),
}));

const { dispatchMailto, flushPendingMailto } = await import(
  '../electron/compose/mailto-controller'
);
const { pendingMailtos } = await import('../electron/core/runtime');

beforeEach(() => {
  state.composed = [];
  state.ready = false;
  pendingMailtos.length = 0;
});

describe('a mailto: that arrives before the app can compose', () => {
  it('keeps both when a second one arrives before the first is released', async () => {
    await dispatchMailto('mailto:first@example.nl');
    await dispatchMailto('mailto:second@example.nl');
    expect(pendingMailtos).toEqual(['mailto:first@example.nl', 'mailto:second@example.nl']);
    expect(state.composed).toEqual([]);

    state.ready = true;
    flushPendingMailto();
    await Promise.resolve();

    expect(state.composed.map((c) => c.to)).toEqual(['first@example.nl', 'second@example.nl']);
    expect(pendingMailtos).toEqual([]);
  });

  it('leaves the queue alone while nothing can compose yet', async () => {
    await dispatchMailto('mailto:first@example.nl');
    flushPendingMailto();
    expect(state.composed).toEqual([]);
    expect(pendingMailtos).toEqual(['mailto:first@example.nl']);
  });
});
