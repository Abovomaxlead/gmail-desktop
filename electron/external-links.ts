import { shell, type WebContents } from 'electron';
import {
  isInAppUrl,
  isGoogleUrl,
  isFederatedLoginUrl,
  isPopoutUrl,
  isFullMessageViewUrl,
  isBlankUrl,
  isAttachmentUrl,
} from './google-urls';

// Hoe een link de app verlaat. Standaard rechtstreeks naar de browser; main zet
// hier bij het opstarten een variant in die eerst de vraag uit Phishing Protection
// stelt (zie link-guard.ts).
//
// Een module-schakelaar en geen extra parameter, omdat `attachExternalLinkHandling`
// op drie plekken wordt aangeroepen — waarvan twee (de opstelvensters) helemaal geen
// opties meegeven. Die hoeven nu niets te weten en gaan toch langs de poort. Eén
// plek waar staat wat "naar buiten" betekent, in plaats van drie die het onthouden.
let openExternally: (url: string) => void = (url) => void shell.openExternal(url);

export function setExternalOpener(fn: (url: string) => void): void {
  openExternally = fn;
}

/** Open een link buiten de app, langs de poort die main heeft ingesteld. */
export function openExternalLink(url: string): void {
  openExternally(url);
}

// Routes links that don't belong to the in-app Gmail/Calendar/auth surfaces to
// the user's default browser instead of opening them inside the mail view.
//
// - window.open / target=_blank (how Gmail opens links clicked in an email,
//   via its www.google.com/url redirect wrapper) -> denied in-app, opened
//   externally, unless the target is one of our own in-app hosts.
// - top-frame navigation to a non-Google host -> cancelled and opened
//   externally. Google-to-Google navigation is left alone so login and
//   internal redirects keep working.
export type WindowOpenAction = 'open-external' | 'suppress' | 'open-in-app' | 'allow';

// Pure decision for a window.open from inside a view.
// - `suppressed` is true right after the app handled a notification click:
//   Gmail's own click handler then ALSO opens the thread (a normal window or
//   its focused pop-out), which would be a duplicate/stray window.
// - `popoutExpected` is true only while the app is deliberately triggering
//   Gmail's pop-out button (window mode). A pop-out window.open is allowed only
//   then, or when nothing is being suppressed (a manual ↗ click by the user).
//   During a notification click we did NOT initiate, a pop-out is suppressed.
export function windowOpenAction(
  url: string,
  mode: 'app' | 'window',
  suppressed: boolean,
  popoutExpected: boolean,
): WindowOpenAction {
  // A blank popup (about:blank / empty target) is opener-driven: a login or
  // verification flow opens it, then navigates it to the identity provider
  // itself. Let it open as a real window so the page can drive it — never
  // externalise about:, which pops a "no app for this link" OS dialog.
  if (isBlankUrl(url)) return 'allow';
  // An attachment is a file, not an app surface: hand it to the browser/OS.
  // Tested before isInAppUrl because attachments live on mail.google.com, which
  // would otherwise keep them in-app and clobber the inbox — and before the
  // suppressed check, since an attachment is always a deliberate user action,
  // never Gmail's own echo of a notification click.
  if (isAttachmentUrl(url)) return 'open-external';
  if (!isInAppUrl(url)) return 'open-external';
  // The "View entire message" reader is a standalone reading page (like a
  // pop-out): always let it open as its own window, never load it into the
  // shared in-app mail view, which would clobber the inbox with no way back.
  if (isFullMessageViewUrl(url)) return 'allow';
  if (isPopoutUrl(url)) {
    if (popoutExpected) return 'allow'; // the pop-out we deliberately triggered
    if (suppressed) return 'suppress'; // Gmail's own auto pop-out on a notification click
    return 'allow'; // a manual ↗ click by the user
  }
  if (suppressed) return 'suppress';
  return mode === 'app' ? 'open-in-app' : 'allow';
}

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

  // Google-to-Google hops and federated-login redirects (e.g. Workspace SSO to
  // Microsoft Entra) stay in-app so the sign-in POST survives; only genuinely
  // off-flow navigation (a link clicked in an email) is externalised. Handing a
  // federated-login POST to shell.openExternal would re-issue it as a GET and
  // trip AADSTS900561 — see isFederatedLoginUrl.
  webContents.on('will-navigate', (event, url) => {
    if (!isGoogleUrl(url) && !isFederatedLoginUrl(url) && !isBlankUrl(url)) {
      event.preventDefault();
      openExternally(url);
    }
  });
}
