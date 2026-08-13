// The toast stack lives in its own window, so the dark class the main document carries
// never reaches it — which is why the cards drew light under a dark theme. Which theme to
// draw therefore travels with the state, resolved by main, because main is the only side
// that knows both halves of the answer: the user's three-way choice and, when that choice
// is "system", what the system currently says.
//
// A resolved boolean rather than the choice itself, so the page has no theme logic of its
// own to drift from the main window's. And it has to reach a stack that is already up: a
// card raised in daylight must not stay white when the theme flips under it, which is what
// refresh() is for.

import { describe, expect, it } from 'vitest';
import { ToastController, type ToastInput } from '../electron/toast/toast-controller';
import type { ToastWindow } from '../electron/toast/toast-window';
import type { ToastState } from '../renderer/lib/toast';
import { IPC } from '../electron/core/ipc';

function mailInput(): ToastInput {
  return { kind: 'mail', title: 'Sender', body: 'Subject', persist: true };
}

function harness(dark: () => boolean) {
  const sent: ToastState[] = [];
  const window = {
    send: (channel: string, payload: unknown) => {
      if (channel === IPC.TOAST_STATE) sent.push(payload as ToastState);
    },
    setInteractive: () => undefined,
    wouldOverflow: () => false,
    applySize: () => undefined,
    reposition: () => undefined,
    hide: () => undefined,
    destroy: () => undefined,
    applyZoom: () => undefined,
    isBroken: () => false,
    noteAlive: () => undefined,
  } as unknown as ToastWindow;
  const controller = new ToastController({
    window,
    locale: () => 'nl',
    reneMode: () => false,
    dark,
    now: () => 0,
    onActivate: () => undefined,
    onActivateSummary: () => undefined,
    onAction: () => undefined,
  });
  return { controller, sent };
}

describe('the theme the toast window draws in', () => {
  it('travels with the stack', () => {
    const h = harness(() => true);
    h.controller.show(mailInput());
    expect(h.sent.at(-1)?.dark).toBe(true);
  });

  it('is light when the resolver says so', () => {
    const h = harness(() => false);
    h.controller.show(mailInput());
    expect(h.sent.at(-1)?.dark).toBe(false);
  });

  it('is read again on refresh, so a theme change reaches the cards already on screen', () => {
    let dark = false;
    const h = harness(() => dark);
    h.controller.show(mailInput());
    expect(h.sent.at(-1)?.dark).toBe(false);
    dark = true;
    h.controller.refresh();
    expect(h.sent.at(-1)?.dark).toBe(true);
  });
});
