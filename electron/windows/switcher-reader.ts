// Reads Gmail's account switcher without the user seeing it happen.
//
// The delegated mailbox's web URL exists in exactly one place: the ogs.google.com widget that
// Gmail builds when the account menu is opened. No API returns it and no URL shape can be
// constructed from the address, so it has to be read out of a rendered page.
//
// It used to be read out of the *live* mail view: the avatar was clicked there, the menu
// popped open in front of whoever was reading their mail, and it was clicked shut up to eight
// seconds later. Adding a mailbox looked like the app taking over the mouse. So the page is
// loaded again in a window that is never shown, on the same session, and the menu is opened
// there instead. Nothing on screen moves.
//
// The cost is a second Gmail page per read, which is why reads are serialised and why the
// window is destroyed on every exit path, successful or not.

import { BrowserWindow } from 'electron';
import { SESSION_PARTITION } from '../core/session-partition';
import { notifyLog } from '../notify/notify-log';


//===========================
// Constants
//===========================

// Gmail's chrome is drawn well after load fires, and the avatar is what opens the widget, so
// the click is retried rather than tried once.
const CLICK_TRIES = 20;
const CLICK_INTERVAL_MS = 500;

// The widget frame is built after the click, and lazily. Twenty times four hundred is eight
// seconds, the same budget the live view had.
const FRAME_TRIES = 20;
const FRAME_INTERVAL_MS = 400;

// A whole read, load included. Gmail took twelve to twenty seconds to become clickable in a
// hidden window on a warm session, so this is generous on purpose: the alternative to waiting
// is a mailbox that keeps its "open it once in Gmail" row.
const READ_TIMEOUT_MS = 60_000;

// Opens the account menu. The avatar is the only anchor whose aria-label carries an address,
// which is what makes this independent of Google's markup churn and of the interface language.
const AVATAR_CLICK_JS = `(() => {
  var re = /@[a-z0-9.-]+\\.[a-z]{2,}/i;
  var a = Array.from(document.querySelectorAll('a[aria-label]'))
    .find(function (x) { return re.test(x.getAttribute('aria-label') || ''); });
  if (a) { a.click(); return true; }
  return false;
})()`;


//===========================
// Types
//===========================

export interface SwitcherEntry {
  email: string;
  href: string;
}


//===========================
// Module state
//===========================

// One read at a time. Two accounts asked back to back would otherwise each load their own
// Gmail, and the caller walks accounts in a loop.
let queue: Promise<unknown> = Promise.resolve();


//===========================
// Exported functions
//===========================

/**
 * Reads the delegated entries out of one account's switcher, invisibly
 *
 * @param authuser the account's multi-login index, as in /mail/u/<n>/
 * @param scrapeJs runs inside the switcher frame and answers with the entries
 * @returns what the switcher held, or nothing when the widget never appeared
 */
export function readSwitcher(authuser: number, scrapeJs: string): Promise<SwitcherEntry[]> {
  const run = queue.then(() => readOnce(authuser, scrapeJs));
  // The queue must survive a failed read, or every later read is rejected with the old error.
  queue = run.catch(() => undefined);
  return run;
}


//===========================
// Helper functions
//===========================

/**
 * Loads Gmail in a hidden window and reads the switcher there
 *
 * @param authuser
 * @param scrapeJs
 * @returns the entries the widget held
 * @private
 */
async function readOnce(authuser: number, scrapeJs: string): Promise<SwitcherEntry[]> {
  const win = new BrowserWindow({
    show: false,
    // Gmail decides what to draw from the viewport, and its narrow layout has no avatar to
    // click, so the hidden window gets a desktop-sized one.
    width: 1280,
    height: 900,
    webPreferences: {
      partition: SESSION_PARTITION,
      contextIsolation: true,
      sandbox: true,
      // A window that is never shown is a background window, and Chromium throttles those
      // timers -- which is the same as never finishing.
      backgroundThrottling: false,
    },
  });
  const started = Date.now();
  const left = (): number => READ_TIMEOUT_MS - (Date.now() - started);
  try {
    await win.loadURL(`https://mail.google.com/mail/u/${authuser}/`);
    let opened = false;
    for (let i = 0; i < CLICK_TRIES && !opened && left() > 0; i++) {
      opened = (await win.webContents.executeJavaScript(AVATAR_CLICK_JS).catch(() => false)) === true;
      if (!opened) await waitMs(CLICK_INTERVAL_MS);
    }
    if (!opened) {
      notifyLog(`[delegated] switcher u/${authuser}: no account menu to open after ${Date.now() - started}ms`);
      return [];
    }
    for (let i = 0; i < FRAME_TRIES && left() > 0; i++) {
      await waitMs(FRAME_INTERVAL_MS);
      const entries = await entriesFromFrames(win, scrapeJs);
      if (entries.length > 0) return entries;
    }
    notifyLog(`[delegated] switcher u/${authuser}: widget gave nothing in ${Date.now() - started}ms`);
    return [];
  } catch (e) {
    notifyLog(`[delegated] switcher u/${authuser} could not be read: ${(e as Error).message}`);
    return [];
  } finally {
    // Never left behind: a hidden window nobody destroys holds a whole Gmail page for the rest
    // of the session, and there is no window to close it from.
    if (!win.isDestroyed()) win.destroy();
  }
}

/**
 * Runs the scrape in whichever subframe is the switcher widget
 *
 * @param win
 * @param scrapeJs
 * @returns the entries, empty when no frame answered with any
 * @private
 */
async function entriesFromFrames(win: BrowserWindow, scrapeJs: string): Promise<SwitcherEntry[]> {
  if (win.isDestroyed()) return [];
  const frames = (win.webContents.mainFrame?.framesInSubtree ?? []).filter((f) =>
    f.url.startsWith('https://ogs.google.com'),
  );
  for (const frame of frames) {
    const res = await frame.executeJavaScript(scrapeJs).catch(() => null);
    if (Array.isArray(res) && res.length > 0) return res as SwitcherEntry[];
  }
  return [];
}

/**
 * Waits, in the executor form because the project's lib target predates Promise.withResolvers
 *
 * @param ms
 * @private
 */
function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
