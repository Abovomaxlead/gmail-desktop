// Preload for the Gmail and Calendar views: reports unread counts and the signed-in
// identity, gates and re-routes the page's notifications, and installs the mail-drop strip.
// Everything above the Electron block at the bottom is Node-safe, so it can be unit-tested.
//
// Gmail is not our page, so anything found in it is matched by shape and never by
// translated text, and all user-facing wording arrives from main — which is why a
// notification click resolves its thread from the body the page gave us, kept for that.
//
// Notification.permission must stay a live getter or Gmail freezes it at "default";
// window.open must return a stub, since null reads as a popup blocker.

import { parseUnreadCount, showsInboxList } from './unread/unread-parser';
import {
  IPC,
  type NotifyState,
  type MailDropPayload,
  type MailDropResult,
  type MailDropSaveProgress,
  type MailDropLock,
} from './core/ipc';
import { labelFromDragTarget } from './mail/label-drop';
import {
  DROPZONE_ID,
  DROPZONE_CSS,
  DROPZONE_LABEL,
  DROPLOCK_ID,
  DROPLOCK_CSS,
  PULLING_TEXT,
  DRAG_CHROME_Z,
  threadIdFromDragTarget,
  messageRefFromDragTarget,
  selectedRows,
  rowsForDrag,
  threadSubjects,
  itemsForDrag,
  isOverZone,
  movedEnough,
  type Point,
  authuserFromPath,
  ikFromPage,
  resultText,
  savingText,
  type DragNode,
  type MessageRef,
} from './mail/dropzone';


//===========================
// Exported functions
//===========================

/**
 * Reads the unread count out of the page title and sends it on
 *
 * Only while the inbox list is the view: Gmail titles whatever is on screen, and neither a
 * label's count nor an open conversation's silence is the number the badge stands for.
 *
 * @param view the page's title and route
 * @param send
 */
export function computeAndReport(
  view: { title: string; hash: string },
  send: (channel: string, count: number) => void,
): void {
  if (!showsInboxList(view.hash)) return;
  send(IPC.UNREAD_UPDATE, parseUnreadCount(view.title));
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
 * The count is the diagnostic: several rows means the first one won and was the wrong
 * thread, none means the row was not in the DOM at all, and only the number tells the two
 * failures apart.
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
 * It raises nothing itself: it hands the title and body to main, which draws the card and
 * knows which account this page belongs to.
 *
 * It answers the permission question itself, with "granted", which is what makes refusing
 * the real permission safe — the session denies notifications so the service worker cannot
 * reach the Windows shelf, and a page reading that refusal would stop notifying entirely.
 * A card in the app needs no permission from Chromium.
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
 * navigator.permissions.query goes straight to Chromium, which says "denied", so a page
 * consulting it would stop notifying. Answered here for notifications only. The status is
 * a plain object, since PermissionStatus.state has no setter.
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
 * The counter alone would not do: a reload keeps the same view while restarting it at 1, so
 * two cards would answer to one name and a click resolve against the wrong one.
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
 * Both fields are coerced: `title: string` is the DOM signature, not what arrives, and a
 * non-primitive handed to React as a child unmounts the toasts page — taking every later
 * notification with it.
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
): {
  showResult: (r: MailDropResult) => void;
  showProgress: (p: MailDropSaveProgress) => void;
  setLock: (l: MailDropLock) => void;
} {
  const style = document.createElement('style');
  style.textContent = DROPZONE_CSS + DROPLOCK_CSS;
  const zone = document.createElement('div');
  zone.id = DROPZONE_ID;
  zone.textContent = DROPZONE_LABEL;
  zone.setAttribute('data-state', 'idle');

  // The veil that makes a pull exclusive. Always in the page and shown by its data-state, so
  // Gmail rebuilding its own DOM cannot take it away at the moment it is needed.
  const lock = document.createElement('div');
  lock.id = DROPLOCK_ID;
  lock.setAttribute('data-state', 'off');

  const host = document.body ?? document.documentElement;
  const attach = () => {
    if (!host.contains(style)) host.appendChild(style);
    if (!host.contains(zone)) host.appendChild(zone);
    if (!host.contains(lock)) host.appendChild(lock);
  };
  attach();
  new MutationObserver(attach).observe(host, { childList: true });
  console.info('[gmail-desktop] dropzone geïnstalleerd in', host.tagName);

  let clearTimer: ReturnType<typeof setTimeout> | null = null;
  let saving = false;
  let locked = false;
  /** Whether this page is the one that started the pull, and so the one a result is coming to.
   * The other accounts' pages are locked by the same pull and get none. */
  let mine = false;
  const setState = (s: string) => zone.setAttribute('data-state', s);
  const reset = () => {
    saving = false;
    // A page that is still locked says so again rather than inviting another drag.
    zone.textContent = locked ? PULLING_TEXT : DROPZONE_LABEL;
    setState(locked ? 'armed' : 'idle');
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
      // No gesture may begin while mail is being pulled. The veil already stops the mouse
      // reaching Gmail; this stops one that started before the veil went up.
      if (locked || e.button !== 0) return;
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
      if (locked || (!pressThreadId && !pressLabel) || !pressAt) return;
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
      if (locked) return;
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
        mine = true;
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
      const rows = rowsForDrag(
        { threadId, ...(message ? { message } : {}) },
        selectedRows(document),
      );
      const items = itemsForDrag(rows, threadSubjects(document));
      // The items rather than the rows, so a row whose message could not be read says so
      // here as well: without the mark the log showed a bare thread id and read like a row
      // that stands for a whole conversation.
      log(
        `[drag] ${items.length} rij(en) vanaf thread=${threadId}: ` +
          items
            .map(
              (i) =>
                `${i.threadId}${i.message?.permId ? `|${i.message.permId}` : ''}${i.messageUnknown ? '|?' : ''}`,
            )
            .join(' '),
      );
      saving = true;
      mine = true;
      zone.textContent = items.length > 1 ? `${items.length} berichten opslaan…` : 'Bezig met opslaan…';
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

  return {
    showResult: (r: MailDropResult) => {
      mine = false;
      zone.textContent = resultText(r);
      setState(r.ok ? 'done' : 'failed');
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = setTimeout(reset, 2000);
    },

    showProgress: (p: MailDropSaveProgress) => {
      if (clearTimer) clearTimeout(clearTimer);
      zone.textContent = savingText(p.done, p.total);
      setState('armed');
    },

    setLock: (l: MailDropLock) => {
      locked = l.locked;
      lock.setAttribute('data-state', l.locked ? 'on' : 'off');
      if (l.locked) {
        saving = true;
        // A gesture that was half-made when the lock arrived is dropped here, or its press
        // state would still be waiting and Gmail's drag card would keep the z-index the
        // gesture lifted it to.
        endGesture();
        // The page that dragged already says what it is doing, and its own line is the better
        // one to keep until the first count arrives.
        if (!mine) {
          zone.textContent = PULLING_TEXT;
          setState('armed');
        }
        return;
      }
      // The pull's own result reaches the page that dragged just before this does, and that is
      // the line to leave standing. So the strip is only touched for the two cases the result
      // does not cover: a lock that lifted itself, and a page that had no result coming.
      if (l.note) {
        zone.textContent = l.note;
        setState('failed');
        if (clearTimer) clearTimeout(clearTimer);
        clearTimer = setTimeout(reset, 4000);
        return;
      }
      if (!mine) reset();
    },
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

  const bodies = new Map<string, string>();
  const loadNonce = Math.random().toString(36).slice(2, 10);
  let webNotifySeq = 0;

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
    computeAndReport({ title: document.title, hash: location.hash }, (channel, count) =>
      ipcRenderer.send(channel, count),
    );

  const start = () => {
    report();
    const titleEl = document.querySelector('title');
    if (titleEl) {
      new MutationObserver(report).observe(titleEl, { childList: true });
    }
    setInterval(report, 5000);

    if (location.hostname === 'mail.google.com') {
      let answered = false;
      ipcRenderer.on(IPC.MAIL_DROP_ALLOWED, (_e: unknown, allowed: boolean) => {
        if (answered) return;
        answered = true;
        if (!allowed) return;
        // Only a view that may drag to save listens for any of this, so a mailbox outside the
        // work domain is never veiled by a pull it could not have started.
        const drop = installDropzone(
          (p) => ipcRenderer.send(IPC.MAIL_DROP, p),
          (message) => ipcRenderer.send(IPC.VIEW_LOG, message),
        );
        ipcRenderer.on(IPC.MAIL_DROP_RESULT, (_e2: unknown, r: MailDropResult) => drop.showResult(r));
        ipcRenderer.on(IPC.MAIL_DROP_SAVE_PROGRESS, (_e2: unknown, p: MailDropSaveProgress) =>
          drop.showProgress(p),
        );
        ipcRenderer.on(IPC.MAIL_DROP_LOCK, (_e2: unknown, l: MailDropLock) => drop.setLock(l));
      });

      let asks = 0;
      const ask = (): void => {
        if (answered || asks >= 15) return;
        asks += 1;
        ipcRenderer.send(IPC.MAIL_DROP_ALLOWED_GET);
        setTimeout(ask, 1000);
      };
      ask();
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
