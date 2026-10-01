// windowOpenAction: where a window.open from the Gmail page should go. On a real
// notification click Gmail's own handler also opens the thread, and that has to be
// suppressed or the user gets a stray duplicate window.
//
// The Google apps setting has a say here as well: an attachment opened with Sheets arrives
// as a window.open on docs.google.com, and it has to end up wherever the user put Sheets.

import { describe, expect, it } from 'vitest';
import { navigationLeavesApp, windowOpenAction } from '../electron/system/external-links';

const POPOUT = 'https://mail.google.com/mail/u/0/popout?search=all&th=x';
const THREAD = 'https://mail.google.com/mail/u/0/#inbox/abc';
const FULL_MSG = 'https://mail.google.com/mail/u/0/?ui=2&ik=abc&view=lg&permmsgid=msg-f:1&th=2';
const ATTACHMENT =
  'https://mail.google.com/mail/u/0/?ui=2&ik=abc&attid=0.1&permmsgid=msg-f:1&th=2&view=att&disp=safe&realattid=f_x&zw';
const SHEET = 'https://docs.google.com/spreadsheets/d/abc/edit';
const DOC = 'https://docs.google.com/document/d/abc/edit';

const IN_APP = { openInApp: true, alwaysNewWindow: false, excluded: [] as string[] };

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

  it('sends an excluded Google app to the browser, whatever the mode is', () => {
    const prefs = { ...IN_APP, excluded: ['sheets'] };
    expect(windowOpenAction(SHEET, 'app', false, false, prefs)).toBe('open-external');
    expect(windowOpenAction(SHEET, 'window', false, false, prefs)).toBe('open-external');
  });

  it('keeps an app that was not excluded in the app, whichever mode the window is in', () => {
    const prefs = { ...IN_APP, excluded: ['sheets'] };
    expect(windowOpenAction(DOC, 'app', false, false, prefs)).toBe('open-in-app');
    expect(windowOpenAction(DOC, 'window', false, false, prefs)).toBe('open-in-app');
  });

  it('leaves a link alone when it belongs to the app it was clicked in', () => {
    const prefs = { ...IN_APP, openInApp: false };
    expect(windowOpenAction(SHEET, 'app', false, false, prefs, 'sheets')).toBe('open-in-app');
    expect(windowOpenAction(SHEET, 'window', false, false, prefs, 'sheets')).toBe('allow');
    expect(windowOpenAction(DOC, 'app', false, false, { ...IN_APP, excluded: ['docs'] }, 'docs')).toBe(
      'open-in-app',
    );
  });

  it('still sends a link out of one app into an excluded other one to the browser', () => {
    const prefs = { ...IN_APP, excluded: ['sheets'] };
    expect(windowOpenAction(SHEET, 'app', false, false, prefs, 'docs')).toBe('open-external');
    expect(windowOpenAction(SHEET, 'app', false, false, prefs, 'mail')).toBe('open-external');
  });

  it('externalises an excluded app even while a notification click is suppressing popups', () => {
    const prefs = { ...IN_APP, excluded: ['sheets'] };
    expect(windowOpenAction(SHEET, 'app', true, false, prefs)).toBe('open-external');
  });

  it('sends every app to the browser when they are all set to open outside', () => {
    const prefs = { ...IN_APP, openInApp: false };
    expect(windowOpenAction(SHEET, 'app', false, false, prefs)).toBe('open-external');
    expect(windowOpenAction(DOC, 'app', false, false, prefs)).toBe('open-external');
  });

  it('gives an app its own window when that is what the setting asks for', () => {
    const prefs = { ...IN_APP, alwaysNewWindow: true };
    expect(windowOpenAction(SHEET, 'app', false, false, prefs)).toBe('allow');
  });

  it('never lets the setting speak for mail itself', () => {
    const external = { openInApp: false, alwaysNewWindow: false, excluded: [] as string[] };
    expect(windowOpenAction(THREAD, 'app', false, false, external)).toBe('open-in-app');
    expect(windowOpenAction(POPOUT, 'app', false, false, external)).toBe('allow');
    expect(windowOpenAction(FULL_MSG, 'app', false, false, external)).toBe('allow');
  });

  it('keeps its old answers when main has not wired the setting up yet', () => {
    expect(windowOpenAction(SHEET, 'app', false, false)).toBe('open-in-app');
    expect(windowOpenAction(SHEET, 'window', false, false, null)).toBe('allow');
  });
});

// A page that navigates in place instead of opening a window used to escape the setting
// entirely: any google.com host was simply allowed to take over the view.
describe('navigationLeavesApp', () => {
  it('sends a navigation into an excluded app to the browser', () => {
    const prefs = { ...IN_APP, excluded: ['sheets'] };
    expect(navigationLeavesApp(SHEET, prefs, 'drive')).toBe(true);
    expect(navigationLeavesApp(SHEET, prefs, 'mail')).toBe(true);
  });

  it('lets an app walk around inside itself', () => {
    const prefs = { ...IN_APP, excluded: ['sheets'] };
    expect(navigationLeavesApp(SHEET, prefs, 'sheets')).toBe(false);
  });

  it('keeps a navigation the setting has no quarrel with in place', () => {
    expect(navigationLeavesApp(SHEET, IN_APP, 'drive')).toBe(false);
    expect(navigationLeavesApp(THREAD, { ...IN_APP, openInApp: false }, 'mail')).toBe(false);
    expect(navigationLeavesApp('https://accounts.google.com/signin', { ...IN_APP, openInApp: false }, 'mail')).toBe(
      false,
    );
  });

  it('still shows a non-Google URL the door, setting or no setting', () => {
    expect(navigationLeavesApp('https://example.com/x', IN_APP, 'mail')).toBe(true);
    expect(navigationLeavesApp('https://example.com/x', null, 'mail')).toBe(true);
  });

  it('leaves a federated login and a blank page in the app', () => {
    expect(navigationLeavesApp('https://login.microsoftonline.com/x', IN_APP, 'mail')).toBe(false);
    expect(navigationLeavesApp('about:blank', IN_APP, 'mail')).toBe(false);
  });
});
