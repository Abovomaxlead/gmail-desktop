// Preload for the Gmail and Calendar views: reports unread counts and the signed-in
// identity, gates and re-routes the page's notifications, and installs the mail-drop
// strip. Everything above the Electron block at the bottom
// is Node-safe so it can be unit-tested. Gmail is not our page, so anything found in it
// is matched by shape, never by translated text, and all user-facing wording arrives
// from main — which is why a notification click resolves its thread from the body the
// page gave us, which we keep, and never from the text on screen — main replaced that
// before drawing it. Notification.permission must stay a live getter or Gmail
// freezes it at "default"; window.open must return a stub, since null reads as a popup
// blocker. The drop strip has to live in <body> to render at all.

import { parseUnreadCount } from './unread/unread-parser';
import {
  IPC,
  type NotifyState,
  type MailDropPayload,
  type MailDropResult,
} from './core/ipc';
import { labelFromDragTarget } from './mail/label-drop';
import {
  DROPZONE_ID,
  DROPZONE_CSS,
  DROPZONE_LABEL,
  DRAG_CHROME_Z,
  threadIdFromDragTarget,
  messageRefFromDragTarget,
  selectedThreadIds,
  threadIdsForDrag,
  threadSubjects,
  itemsForDrag,
  isOverZone,
  movedEnough,
  type Point,
  authuserFromPath,
  ikFromPage,
  resultText,
  type DragNode,
  type MessageRef,
} from './mail/dropzone';


//===========================
// Exported functions
//===========================

/**
 * Reads the unread count out of the page title and sends it on
 *
 * @param doc
 * @param send
 */
export function computeAndReport(
  doc: { title: string },
  send: (channel: string, count: number) => void,
): void {
  send(IPC.UNREAD_UPDATE, parseUnreadCount(doc.title));
}

/**
 * Reads the signed-in account out of Gmail's own avatar
 *
 * Matched by shape — an anchor whose aria-label holds an address and whose content holds
 * an image — never by translated text.
 *
 * @param doc
 * @returns the identity, or null when the avatar is not in the DOM yet
 */
export function extractIdentity(
  doc: { querySelectorAll(sel: string): ArrayLike<any> },
): { email: string; name: string; avatarUrl: string } | null {
  const anchors = Array.from(doc.querySelectorAll('a[aria-label]'));
  let anchor: any = null;
  for (const a of anchors) {
    const lbl: string = a.getAttribute('aria-label') || '';
    if (/@[^\s@]+\.[^\s@]+/.test(lbl) && a.querySelector('img')) {
      anchor = a;
      break;
    }
  }
  if (!anchor) return null;
  const label: string = anchor.getAttribute('aria-label') || '';
  const email = (label.match(/[^\s()]+@[^\s()]+\.[^\s()]+/) || [''])[0];
  const name = label
    .replace(/^[^:]*:\s*/, '')
    .replace(/\s*\(.*\)\s*$/, '')
    .trim();
  const img = anchor.querySelector('img');
  const avatarUrl: string = (img && img.getAttribute('src')) || '';
  if (!email && !avatarUrl) return null;
  return { email, name, avatarUrl };
}

/**
 * Every thread whose subject matches, rather than only the first
 *
 * The count is the diagnostic. A click that opens the wrong conversation and a click that
 * opens no conversation at all look the same from the outside — "it opened something I did
 * not ask for" — but they are different failures: several rows carrying the same subject
 * means the first one won and it was the wrong thread, while none means the row was not in
 * the DOM to be found. Only the number tells them apart, and the caller cannot count what
 * this used to return the moment it found it.
 *
 * @param doc
 * @param subject a trailing ellipsis makes it a prefix match, since that is how Gmail
 *   truncates a long subject on a card
 * @returns the thread ids in DOM order, deduplicated because Gmail puts
 *   data-legacy-thread-id on the row and again on a span inside it
 */
export function matchThreadsBySubject(
  doc: { querySelectorAll(sel: string): ArrayLike<any> },
  subject: string,
): string[] {
  const wanted = (subject || '').trim();
  if (!wanted) return [];
  const ellipsized = /(…|\.\.\.)$/.test(wanted);
  const prefix = wanted.replace(/(…|\.\.\.)$/, '');
  const found: string[] = [];
  for (const el of Array.from(doc.querySelectorAll('[data-legacy-thread-id]'))) {
    const id = el.getAttribute('data-legacy-thread-id');
    if (!id || found.indexOf(id) !== -1) continue;
    const text = (el.textContent || '').trim();
    if (text === wanted || (ellipsized && text.startsWith(prefix))) found.push(id);
  }
  return found;
}

export function findThreadIdBySubject(
  doc: { querySelectorAll(sel: string): ArrayLike<any> },
  subject: string,
): string | null {
  return matchThreadsBySubject(doc, subject)[0] ?? null;
}

/**
 * Sends the service worker's notifications through the shim as well
 *
 * Its own showNotification would otherwise reach the Windows shelf, where the app can
 * neither draw the card nor apply a single one of its settings to it.
 *
 * @param swRegProto
 * @param getNotification read per call, so it picks up the shim installed after this
 */
export function rerouteServiceWorkerNotifications(
  swRegProto:
    | { showNotification?: (title: string, options?: NotificationOptions) => Promise<void> }
    | undefined,
  getNotification: () => typeof Notification,
): void {
  if (!swRegProto || typeof swRegProto.showNotification !== 'function') return;
  swRegProto.showNotification = function (title: string, options?: NotificationOptions) {
    const { actions: _actions, ...rest } = (options ?? {}) as NotificationOptions & {
      actions?: unknown;
    };
    new (getNotification())(title, rest);
    return Promise.resolve();
  };
}

/**
 * The window.Notification the Gmail page gets instead of Chromium's
 *
 * It raises nothing itself: it hands the title and body to main, which draws the card in
 * the app's own stack, knows which account this page belongs to and what the privacy
 * settings replace.
 *
 * It also answers the permission question for itself, with "granted", and never asks the
 * browser. That is deliberate and it is what makes refusing the real permission safe: the
 * session denies notifications so that anything bypassing this shim — the service worker's
 * own showNotification — cannot reach the Windows shelf, and a page that consults
 * Notification.permission before it notifies must not read that refusal, or Gmail would
 * stop notifying and the stack would go quiet along with the shelf. What this shim
 * promises is a card in the app, which needs no permission from Chromium.
 *
 * The object handed back is the one Gmail's code goes on to use, so it answers to onclick,
 * close and addEventListener whatever was done with the notification.
 *
 * @param hooks.allowed asked per notification, since the settings can change
 * @param hooks.show returns what to run when the page closes the notification — the raise
 *   pins the body until the click, and a closed notification will never be clicked
 * @returns {typeof Notification}
 */
export function createNotificationShim(hooks: {
  allowed: () => boolean;
  show: (title: string, options?: NotificationOptions) => (() => void) | void;
}): typeof Notification {
  const stub = (release?: (() => void) | void): Notification => {
    let closed = false;
    return {
      onclick: null,
      close: () => {
        if (closed) return;
        closed = true;
        release?.();
      },
      addEventListener() {},
    } as unknown as Notification;
  };
  const Shim = function (this: Notification, title: string, options?: NotificationOptions) {
    if (!hooks.allowed()) return stub();
    return stub(hooks.show(title, options));
  } as unknown as typeof Notification;
  Object.defineProperty(Shim, 'permission', {
    configurable: true,
    get: (): NotificationPermission => 'granted',
  });
  Shim.requestPermission = (): Promise<NotificationPermission> => Promise.resolve('granted');
  return Shim;
}

/**
 * Answers the second way a page can ask whether it may notify
 *
 * Notification.permission is answered by the shim above, but navigator.permissions.query
 * goes straight to Chromium, which now says "denied" — and a page that consults it before
 * notifying would stop, taking the app's own notifications with it. The answer for
 * notifications is therefore given here too, and only for notifications: every other
 * permission is still whatever the browser says it is.
 *
 * The status handed back is a plain object rather than the real one with its state
 * overridden, because PermissionStatus.state has no setter. It carries the members a
 * listener uses, so a page that subscribes to changes gets silence rather than a throw.
 *
 * @param permissions navigator.permissions, or nothing on a page that has none
 */
export function patchNotificationPermissionQuery(permissions: unknown): void {
  const target = permissions as { query?: (d: { name: string }) => Promise<unknown> } | undefined;
  if (!target || typeof target.query !== 'function') return;
  const original = target.query.bind(target);
  target.query = async (descriptor: { name: string }) => {
    if (descriptor?.name !== 'notifications') return original(descriptor);
    return {
      name: 'notifications',
      state: 'granted',
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    };
  };
}

/**
 * The name this page gives one of its notifications
 *
 * The counter alone would not do: main files these under the view that sent them, and a
 * reload keeps the same view while restarting the counter at 1, so a card raised before the
 * reload and one raised after would answer to the same name and a click would resolve
 * against the wrong one.
 *
 * @param loadNonce per page load, which is exactly the lifetime of the bodies we keep
 * @param seq
 * @returns the id
 */
export function webNotifyPageId(loadNonce: string, seq: number): string {
  return `${loadNonce}-${seq}`;
}

/**
 * What travels to main when the page raises a notification
 *
 * Both fields are coerced, and the title is the one that has to be. `title: string` is what
 * the DOM signature says, not what arrives: this runs on `new Notification(x)` inside
 * Google's own page, so x is whatever that page passed. A non-primitive travels to main,
 * goes onto a card and is handed to React as a child, which throws "Objects are not valid
 * as a React child" and unmounts the toasts page — and a page that is not there reports no
 * size and raises no card, so every later notification goes with it.
 *
 * @param id
 * @param title
 * @param options
 * @returns the payload, with both fields strings whatever the page passed
 */
export function webNotifyPayload(
  id: string,
  title: string,
  options?: NotificationOptions,
): { id: string; title: string; body: string } {
  const raw = options?.body;
  return {
    id,
    title: title === undefined || title === null ? '' : String(title),
    body: raw === undefined || raw === null ? '' : String(raw),
  };
}

export function isEditableTarget(
  el: { tagName?: string; isContentEditable?: boolean } | null | undefined,
): boolean {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || el.isContentEditable === true;
}

/**
 * Makes window.open answer with a stub rather than null
 *
 * A null return reads as a popup blocker to Gmail, which then gives up on opening
 * anything at all.
 *
 * @param original
 * @returns the replacement
 */
export function wrapWindowOpen(original: typeof window.open): typeof window.open {
  return function (...args: Parameters<typeof window.open>) {
    const w = original(...args);
    if (w) return w;
    return {
      closed: true,
      close() {},
      focus() {},
      blur() {},
      postMessage() {},
    } as unknown as Window;
  };
}


//===========================
// Helper functions
//===========================

/**
 * Puts the drag-to-save strip in the page and tracks the gesture
 *
 * The strip has to live in <body> to render at all, and a MutationObserver puts it back
 * whenever Gmail rebuilds around it.
 *
 * @param send hands a finished drop to main
 * @param log a line into notify.log, the only place a message from inside Google's page
 *   is ever read back
 * @returns what to call with main's answer, which the strip then shows
 * @private
 */
function installDropzone(
  send: (p: MailDropPayload) => void,
  log: (message: string) => void,
): (r: MailDropResult) => void {
  const style = document.createElement('style');
  style.textContent = DROPZONE_CSS;
  const zone = document.createElement('div');
  zone.id = DROPZONE_ID;
  zone.textContent = DROPZONE_LABEL;
  zone.setAttribute('data-state', 'idle');

  const host = document.body ?? document.documentElement;
  const attach = () => {
    if (!host.contains(style)) host.appendChild(style);
    if (!host.contains(zone)) host.appendChild(zone);
  };
  attach();
  new MutationObserver(attach).observe(host, { childList: true });
  console.info('[gmail-desktop] dropzone geïnstalleerd in', host.tagName);

  let clearTimer: ReturnType<typeof setTimeout> | null = null;
  let saving = false;
  const setState = (s: string) => zone.setAttribute('data-state', s);
  const reset = () => {
    saving = false;
    zone.textContent = DROPZONE_LABEL;
    setState('idle');
  };

  let pressThreadId: string | null = null;
  let pressMessage: MessageRef | null = null;
  let pressLabel: string | null = null;
  let pressAt: Point | null = null;
  let dragging = false;

  const lifted: Array<{ el: HTMLElement; previous: string }> = [];
  let liftObserver: MutationObserver | null = null;

  const liftDragChrome = () => {
    if (liftObserver) return;
    liftObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (let i = 0; i < record.addedNodes.length; i++) {
          const node = record.addedNodes[i] as HTMLElement;
          if (node.nodeType !== 1 || node === zone || node === style) continue;
          const position = window.getComputedStyle(node).position;
          if (position !== 'fixed' && position !== 'absolute') continue;
          lifted.push({ el: node, previous: node.style.zIndex });
          node.style.zIndex = String(DRAG_CHROME_Z);
        }
      }
    });
    liftObserver.observe(host, { childList: true });
  };

  const dropDragChrome = () => {
    liftObserver?.disconnect();
    liftObserver = null;
    for (const { el, previous } of lifted) el.style.zIndex = previous;
    lifted.length = 0;
  };

  const endGesture = () => {
    pressThreadId = null;
    pressMessage = null;
    pressLabel = null;
    pressAt = null;
    dragging = false;
    dropDragChrome();
  };

  document.addEventListener(
    'mousedown',
    (e) => {
      if (e.button !== 0) return;
      const target = e.target as unknown as DragNode | null;
      pressThreadId = threadIdFromDragTarget(target);
      pressMessage = pressThreadId ? messageRefFromDragTarget(target) : null;
      pressLabel = pressThreadId ? null : labelFromDragTarget(target);
      pressAt = { x: e.clientX, y: e.clientY };
      dragging = false;
      if (pressThreadId || pressLabel) {
        window.getSelection()?.removeAllRanges();
        liftDragChrome();
      }
    },
    true,
  );

  document.addEventListener(
    'dragstart',
    (e) => {
      if (pressThreadId || pressLabel) e.preventDefault();
    },
    true,
  );

  document.addEventListener(
    'mousemove',
    (e) => {
      if ((!pressThreadId && !pressLabel) || !pressAt) return;
      const at = { x: e.clientX, y: e.clientY };
      if (!dragging && !movedEnough(pressAt, at)) return;
      dragging = true;
      if (clearTimer) clearTimeout(clearTimer);
      zone.textContent = pressLabel
        ? `Sleep hier om alle mail uit "${pressLabel}" op te slaan`
        : DROPZONE_LABEL;
      setState(isOverZone(at, zone.getBoundingClientRect()) ? 'over' : 'armed');
    },
    true,
  );

  document.addEventListener(
    'mouseup',
    (e) => {
      const threadId = pressThreadId;
      const message = pressMessage;
      const label = pressLabel;
      const wasDragging = dragging;
      const over = isOverZone({ x: e.clientX, y: e.clientY }, zone.getBoundingClientRect());
      endGesture();
      if (!wasDragging || !over) {
        if (!saving) reset();
        return;
      }
      if (label) {
        saving = true;
        zone.textContent = `Mail uit "${label}" ophalen…`;
        setState('armed');
        send({
          items: [],
          label,
          authuser: authuserFromPath(location.pathname),
          ik:
            ikFromPage(window as unknown as { GLOBALS?: unknown }, document.documentElement.innerHTML) ??
            '',
        });
        return;
      }
      if (!threadId) {
        if (!saving) reset();
        return;
      }
      const threadIds = threadIdsForDrag(threadId, selectedThreadIds(document));
      const items = itemsForDrag(threadIds, threadSubjects(document), message);
      log(`[drag] thread=${threadId} message=${message ? JSON.stringify(message) : 'geen'}`);
      saving = true;
      zone.textContent = items.length > 1 ? `${items.length} gesprekken opslaan…` : 'Bezig met opslaan…';
      setState('armed');
      send({
        items,
        authuser: authuserFromPath(location.pathname),
        ik:
          ikFromPage(window as unknown as { GLOBALS?: unknown }, document.documentElement.innerHTML) ??
          '',
      });
    },
    true,
  );

  return (r: MailDropResult) => {
    zone.textContent = resultText(r);
    setState(r.ok ? 'done' : 'failed');
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(reset, 2000);
  };
}


//===========================
// Page setup
//===========================

if (typeof document !== 'undefined') {
  const { ipcRenderer } = require('electron') as typeof import('electron');

  let notifyState: NotifyState = { show: true, silent: false };
  ipcRenderer.on(IPC.NOTIFY_ALLOWED, (_e: unknown, state: NotifyState) => {
    notifyState = state;
  });

  window.open = wrapWindowOpen(window.open.bind(window));

  // Installed here rather than inside start(), which waits for DOMContentLoaded: Gmail's
  // own scripts run before that and a page that took its own reference to
  // window.Notification on the way past would go on raising real Chromium notifications
  // for the rest of the session, straight onto the Windows shelf, where the app cannot
  // draw them, cannot apply a single one of its settings to them, and cannot make them
  // open the mail when clicked. Nothing in here touches the document, so there is nothing
  // to wait for.
  //
  // Gmail's own notifications are relayed to main rather than raised: main draws every
  // notification the app gives, and only main knows the account this view belongs to,
  // whether it should stay, and what the privacy settings should replace. The original
  // body is kept until the click, because finding the thread means matching that subject
  // in this page's DOM, and by then main has long since replaced the text on screen.
  const bodies = new Map<string, string>();
  const loadNonce = Math.random().toString(36).slice(2, 10);
  let webNotifySeq = 0;
  // Straight into notify.log, because everything below happens inside Google's page, where
  // the app's own console is somewhere nobody is looking. The one question this answers is
  // the one the log could not: did Gmail raise a notification at all? A page that never
  // constructs one and a card that was suppressed on the way out look identical from main.
  const log = (message: string): void => ipcRenderer.send(IPC.VIEW_LOG, message);
  log(`notification shim installed on ${location.hostname}`);
  window.Notification = createNotificationShim({
    allowed: () => {
      if (!notifyState.show) log('Gmail raised a notification and the settings suppressed it');
      return notifyState.show;
    },
    show: (title, options) => {
      webNotifySeq += 1;
      const id = webNotifyPageId(loadNonce, webNotifySeq);
      const payload = webNotifyPayload(id, title, options);
      bodies.set(id, payload.body);
      log(`Gmail raised a notification, handing ${id} to main`);
      ipcRenderer.send(IPC.WEB_NOTIFY_SHOW, payload);
      return () => {
        log(`Gmail closed notification ${id}`);
        bodies.delete(id);
      };
    },
  });
  patchNotificationPermissionQuery(
    typeof navigator !== 'undefined' ? navigator.permissions : undefined,
  );
  rerouteServiceWorkerNotifications(
    typeof ServiceWorkerRegistration !== 'undefined' ? ServiceWorkerRegistration.prototype : undefined,
    () => window.Notification,
  );

  // Registered beside the shim rather than in start(), for the same reason: a card can now
  // be raised before the document is ready, and a click on it must not arrive at a channel
  // nobody is listening to.
  //
  // The second argument is diagnostic and travels with the click rather than being logged
  // here, because a console line inside a Gmail view is somewhere nobody is looking. Main
  // logs it, and now also uses the body: this lookup is a guess by construction — the
  // notification carries no thread id, so the thread is found by matching its text against
  // the rows that happen to be rendered — and when it finds nothing the subject is the only
  // lead left. `rows` distinguishes a view showing an open conversation or a different
  // label (no list, so nothing to match) from one showing the inbox; `matches`
  // distinguishes an ambiguous subject from an absent one.
  ipcRenderer.on(IPC.WEB_NOTIFY_CLICK, (_e: unknown, id: string) => {
    const body = bodies.get(id) ?? '';
    bodies.delete(id);
    const matches = matchThreadsBySubject(document, body);
    ipcRenderer.send(IPC.NOTIFICATION_ACTIVATE, matches[0] ?? undefined, {
      rows: document.querySelectorAll('[data-legacy-thread-id]').length,
      matches: matches.length,
      hash: location.hash,
      body: body.slice(0, 60),
    });
  });

  const report = () =>
    computeAndReport(document, (channel, count) => ipcRenderer.send(channel, count));

  const start = () => {
    report();
    const titleEl = document.querySelector('title');
    if (titleEl) {
      new MutationObserver(report).observe(titleEl, { childList: true });
    }
    setInterval(report, 5000);

    if (location.hostname === 'mail.google.com') {
      const showResult = installDropzone(
        (p) => ipcRenderer.send(IPC.MAIL_DROP, p),
        (message) => ipcRenderer.send(IPC.VIEW_LOG, message),
      );
      ipcRenderer.on(IPC.MAIL_DROP_RESULT, (_e: unknown, r: MailDropResult) => showResult(r));
    }

    let identityTries = 0;
    const identityTimer = setInterval(() => {
      identityTries += 1;
      const identity = extractIdentity(document);
      if (identity) {
        ipcRenderer.send(IPC.ACCOUNT_IDENTITY, identity);
        clearInterval(identityTimer);
      } else if (identityTries >= 15) {
        clearInterval(identityTimer);
      }
    }, 1000);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}
