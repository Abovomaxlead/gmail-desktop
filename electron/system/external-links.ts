// Routes links outside the in-app surfaces to the user's default browser. How a link leaves
// is a module-level setting, so all three call sites share one definition of "outward";
// main installs the Phishing Protection variant at startup.
//
// Order inside the window.open decision is load-bearing: attachments are tested before
// isInAppUrl, since they live on mail.google.com, and before `suppressed`, since an
// attachment is always deliberate. A blank popup must open as a real window, and
// Google-to-Google hops and federated logins stay in-app — externalising a federation POST
// re-issues it as a GET and trips AADSTS900561. The Google apps setting is read after the
// mail-only predicates, so a pop-out stays a pop-out whatever Docs and Sheets are set to.

import { shell, type WebContents } from 'electron';
import {
  isInAppUrl,
  isGoogleUrl,
  isFederatedLoginUrl,
  isPopoutUrl,
  isFullMessageViewUrl,
  isBlankUrl,
  isAttachmentUrl,
} from '../gmail/google-urls';
import { surfaceForUrl } from '../../renderer/lib/surfaces';
import { googleAppTarget, type GoogleAppTarget } from '../../renderer/lib/google-apps';


//===========================
// Types
//===========================

export type WindowOpenAction = 'open-external' | 'suppress' | 'open-in-app' | 'allow';

/** The part of the Google apps prefs that decides where an app opens. */
export interface GoogleAppsRouting {
  openInApp: boolean;
  alwaysNewWindow: boolean;
  excluded: readonly string[];
}


//===========================
// Module state
//===========================

let openExternally: (url: string) => void = (url) => void shell.openExternal(url);

let googleAppsRouting: () => GoogleAppsRouting | null = () => null;


//===========================
// Exported functions
//===========================

/**
 * Replaces how a link leaves the app
 *
 * @param fn receives the URL that is on its way out
 */
export function setExternalOpener(fn: (url: string) => void): void {
  openExternally = fn;
}

/**
 * Tells the router where the user wants Google apps to open
 *
 * @param fn asked per link, since the setting can change while the app is up
 */
export function setGoogleAppsRouting(fn: () => GoogleAppsRouting | null): void {
  googleAppsRouting = fn;
}

export function openExternalLink(url: string): void {
  openExternally(url);
}

/**
 * Decides what happens to a link a mail view wants to open in a new window
 *
 * A Google app the user sent to the browser has to leave whichever way it was reached: the
 * launcher already asks googleAppTarget, and so does this, or a spreadsheet Gmail opens for
 * an attachment would land in the app the user just excluded. Mail is the one surface the
 * setting never speaks for -- the same exemption openSurfaceForAccount makes -- since
 * externalising a pop-out or a compose window would empty the app it was opened from.
 *
 * @param url
 * @param mode whether an in-app link opens in the app or in its own window
 * @param suppressed true while a notification click is in flight
 * @param popoutExpected true when the user asked for a popout themselves
 * @param googleApps where the user wants Google apps to open, when it is known
 * @returns the action the window-open handler carries out
 */
export function windowOpenAction(
  url: string,
  mode: 'app' | 'window',
  suppressed: boolean,
  popoutExpected: boolean,
  googleApps?: GoogleAppsRouting | null,
  from?: string | null,
): WindowOpenAction {
  if (isBlankUrl(url)) return 'allow';
  if (isAttachmentUrl(url)) return 'open-external';
  if (!isInAppUrl(url)) return 'open-external';
  if (isFullMessageViewUrl(url)) return 'allow';
  if (isPopoutUrl(url)) {
    if (popoutExpected) return 'allow';
    if (suppressed) return 'suppress';
    return 'allow';
  }
  const target = googleAppRouting(url, googleApps, from);
  if (target === 'external') return 'open-external';
  if (target === 'new-window') return 'allow';
  if (suppressed) return 'suppress';
  // An answer from the setting outranks the window mode: "open Google apps in the app" has
  // to mean the shared view even when the link was clicked in a window of its own.
  if (target === 'in-app') return 'open-in-app';
  return mode === 'app' ? 'open-in-app' : 'allow';
}

/**
 * Whether a same-window navigation has to leave the app instead
 *
 * A view is allowed to walk around inside its own app -- one sheet to the next -- but a
 * navigation into an app the user sent to the browser is that app opening, whatever the
 * page calls it, so it leaves and the view stays where it was.
 *
 * @param url
 * @param googleApps where the user wants Google apps to open, when it is known
 * @param from the surface doing the navigating
 * @returns true when the URL belongs in the browser
 */
export function navigationLeavesApp(
  url: string,
  googleApps?: GoogleAppsRouting | null,
  from?: string | null,
): boolean {
  if (!isGoogleUrl(url) && !isFederatedLoginUrl(url) && !isBlankUrl(url)) return true;
  return googleAppRouting(url, googleApps, from) === 'external';
}

/**
 * Hangs the routing decision on a web contents
 *
 * @param webContents
 * @param opts the questions the decision asks main; each falls back to a safe default
 */
export function attachExternalLinkHandling(
  webContents: WebContents,
  opts?: {
    surface?: string | null;
    getOpenMode?: () => 'app' | 'window';
    openInApp?: (url: string) => void;
    isNotificationClickInFlight?: () => boolean;
    isPopoutExpected?: () => boolean;
  },
): void {
  webContents.setWindowOpenHandler(({ url }) => {
    const action = windowOpenAction(
      url,
      opts?.getOpenMode?.() ?? 'window',
      opts?.isNotificationClickInFlight?.() ?? false,
      opts?.isPopoutExpected?.() ?? false,
      googleAppsRouting(),
      opts?.surface ?? null,
    );
    if (action === 'open-in-app' && opts?.openInApp) {
      opts.openInApp(url);
      return { action: 'deny' };
    }
    if (action === 'suppress') return { action: 'deny' };
    if (action === 'open-external') {
      openExternally(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  webContents.on('will-navigate', (event, url) => {
    if (!navigationLeavesApp(url, googleAppsRouting(), opts?.surface ?? null)) return;
    event.preventDefault();
    openExternally(url);
  });

  // A window the handler allowed -- Gmail's own pop-out, a popup, an app in its own window --
  // used to be born without any of this: no routing, no phishing gate, no containment. It
  // inherits the same rules as the page that opened it.
  webContents.on('did-create-window', (win) => {
    if (win?.webContents) attachExternalLinkHandling(win.webContents, opts);
  });
}


//===========================
// Helper functions
//===========================

/**
 * Where the Google apps setting wants the app behind a URL to open
 *
 * The surface the click came from has the last word: a link inside an app's own view or
 * window stays there, because "open Docs in the browser" is about reaching Docs, not about
 * being thrown out of the document already on screen.
 *
 * @param url
 * @param googleApps null while main has not wired the setting up yet
 * @param from the surface the link was clicked in, when the caller knows it
 * @returns the target, or null when no setting speaks for this URL
 * @private
 */
function googleAppRouting(
  url: string,
  googleApps?: GoogleAppsRouting | null,
  from?: string | null,
): GoogleAppTarget | null {
  if (!googleApps) return null;
  const surface = surfaceForUrl(url);
  if (surface === null || surface === 'mail') return null;
  if (from && surface === from) return null;
  return googleAppTarget(surface, googleApps);
}
