// Routes links that do not belong to the in-app Gmail/Calendar/auth surfaces to the
// user's default browser instead of opening them inside a mail view. How a link leaves
// is a module-level setting rather than a parameter, so there is one definition of
// "outward" for all three call sites: main installs the Phishing Protection variant at
// startup (see link-guard.ts).
//
// Order inside the window.open decision is load-bearing. Attachments are tested before
// isInAppUrl, since they live on mail.google.com and would otherwise clobber the
// inbox, and before the `suppressed` check, since an attachment is always a deliberate
// user action. A blank popup must open as a real window the opener can drive —
// externalising about: pops an OS "no app for this link" dialog. Google-to-Google hops
// and federated-login redirects stay in-app, because handing a federation POST to
// shell.openExternal re-issues it as a GET and trips AADSTS900561.

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


//===========================
// Types
//===========================

export type WindowOpenAction = 'open-external' | 'suppress' | 'open-in-app' | 'allow';


//===========================
// Module state
//===========================

let openExternally: (url: string) => void = (url) => void shell.openExternal(url);


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

export function openExternalLink(url: string): void {
  openExternally(url);
}

/**
 * Decides what happens to a link a mail view wants to open in a new window
 *
 * @param url
 * @param mode whether an in-app link opens in the app or in its own window
 * @param suppressed true while a notification click is in flight
 * @param popoutExpected true when the user asked for a popout themselves
 * @returns the action the window-open handler carries out
 */
export function windowOpenAction(
  url: string,
  mode: 'app' | 'window',
  suppressed: boolean,
  popoutExpected: boolean,
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
  if (suppressed) return 'suppress';
  return mode === 'app' ? 'open-in-app' : 'allow';
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
    if (!isGoogleUrl(url) && !isFederatedLoginUrl(url) && !isBlankUrl(url)) {
      event.preventDefault();
      openExternally(url);
    }
  });
}
