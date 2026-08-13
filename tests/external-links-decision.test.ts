// windowOpenAction: where a window.open from the Gmail page should go. On a real
// notification click Gmail's own handler also opens the thread, and that has to be
// suppressed or the user gets a stray duplicate window.

import { describe, expect, it } from 'vitest';
import { windowOpenAction } from '../electron/system/external-links';

const POPOUT = 'https://mail.google.com/mail/u/0/popout?search=all&th=x';
const THREAD = 'https://mail.google.com/mail/u/0/#inbox/abc';
const FULL_MSG = 'https://mail.google.com/mail/u/0/?ui=2&ik=abc&view=lg&permmsgid=msg-f:1&th=2';
const ATTACHMENT =
  'https://mail.google.com/mail/u/0/?ui=2&ik=abc&attid=0.1&permmsgid=msg-f:1&th=2&view=att&disp=safe&realattid=f_x&zw';

describe('windowOpenAction', () => {
  it('sends non-Google URLs to the external browser regardless of state', () => {
    expect(windowOpenAction('https://example.com/x', 'app', false, false)).toBe('open-external');
    expect(windowOpenAction('https://example.com/x', 'window', true, false)).toBe('open-external');
  });

  it('suppresses in-app popups right after a handled notification click', () => {
    expect(windowOpenAction(THREAD, 'window', true, false)).toBe('suppress');
    expect(windowOpenAction(THREAD, 'app', true, false)).toBe('suppress');
  });

  it('opens in-app popups in place in app mode', () => {
    expect(windowOpenAction(THREAD, 'app', false, false)).toBe('open-in-app');
  });

  it('allows the separate window in window mode', () => {
    expect(windowOpenAction(THREAD, 'window', false, false)).toBe('allow');
    expect(windowOpenAction('https://accounts.google.com/signin', 'window', false, false)).toBe('allow');
  });

  it('suppresses Gmail’s own auto pop-out during a notification click (either mode)', () => {
    expect(windowOpenAction(POPOUT, 'app', true, false)).toBe('suppress');
    expect(windowOpenAction(POPOUT, 'window', true, false)).toBe('suppress');
  });

  it('allows the pop-out the app deliberately triggers', () => {
    expect(windowOpenAction(POPOUT, 'window', true, true)).toBe('allow');
    expect(windowOpenAction(POPOUT, 'app', true, true)).toBe('allow');
  });

  it('allows a manual pop-out click when nothing is being suppressed', () => {
    expect(windowOpenAction(POPOUT, 'app', false, false)).toBe('allow');
    expect(windowOpenAction(POPOUT, 'window', false, false)).toBe('allow');
  });

  it('opens a blank/opener-driven popup as a real window, never handing about: to the OS', () => {
    expect(windowOpenAction('about:blank', 'app', false, false)).toBe('allow');
    expect(windowOpenAction('about:blank', 'window', false, false)).toBe('allow');
    expect(windowOpenAction('', 'app', false, false)).toBe('allow');
    expect(windowOpenAction('about:blank#foo', 'window', false, false)).toBe('allow');
    expect(windowOpenAction('about:blank', 'app', true, false)).toBe('allow');
  });

  it('always opens the "View entire message" reader as its own window', () => {
    expect(windowOpenAction(FULL_MSG, 'app', false, false)).toBe('allow');
    expect(windowOpenAction(FULL_MSG, 'window', false, false)).toBe('allow');
  });

  it('always opens an attachment externally, never in a view', () => {
    expect(windowOpenAction(ATTACHMENT, 'app', false, false)).toBe('open-external');
    expect(windowOpenAction(ATTACHMENT, 'window', false, false)).toBe('open-external');
    expect(windowOpenAction(ATTACHMENT, 'app', true, false)).toBe('open-external');
  });

  it('opens a download of the attachment bytes externally too', () => {
    expect(
      windowOpenAction(
        'https://mail-attachment.googleusercontent.com/attachment/u/0/?ui=2&ik=abc&view=att&disp=attd',
        'app',
        false,
        false,
      ),
    ).toBe('open-external');
  });
});
