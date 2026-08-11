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
import { parseUnreadCount } from './unread-parser';
import {
  IPC,
  type NotifyState,
  type MailDropPayload,
  type MailDropResult,
} from './ipc';
import { labelFromDragTarget } from './label-drop';
import {
  DROPZONE_ID,
  DROPZONE_CSS,
  DROPZONE_LABEL,
  DRAG_CHROME_Z,
  threadIdFromDragTarget,
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
} from './dropzone';

export function computeAndReport(
  doc: { title: string },
  send: (channel: string, count: number) => void,
): void {
  send(IPC.UNREAD_UPDATE, parseUnreadCount(doc.title));
}

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

/** Every thread whose subject matches, in DOM order, rather than only the first.
 *
 * The count is the diagnostic. A click that opens the wrong conversation and a click that
 * opens no conversation at all look the same from the outside — "it opened something I did
 * not ask for" — but they are different failures: several rows carrying the same subject
 * means the first one won and it was the wrong thread, while none means the row was not in
 * the DOM to be found. Only the number tells them apart, and the caller cannot count what
 * this used to return the moment it found it.
 *
 * Ids are deduplicated because Gmail puts data-legacy-thread-id on the row and again on a
 * span inside it, so one thread would otherwise read as an ambiguous two. */
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

// The name this page gives one of its notifications. The counter alone would not do: main
// files these under the view that sent them, and a reload keeps the same view while
// restarting the counter at 1, so a card raised before the reload and one raised after
// would answer to the same name and a click would resolve against the wrong one. The nonce
// is per page load, which is exactly the lifetime of the bodies we keep.
export function webNotifyPageId(loadNonce: string, seq: number): string {
  return `${loadNonce}-${seq}`;
}

// Both fields are coerced, and the title is the one that has to be. `title: string` is
// what the DOM signature says, not what arrives: this runs on `new Notification(x)` inside
// Google's own page, so x is whatever that page passed. A non-primitive travels to main,
// goes onto a card and is handed to React as a child, which throws "Objects are not valid
// as a React child" and unmounts the toasts page - and a page that is not there reports no
// size and raises no card, so every later notification goes with it.
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

function installDropzone(send: (p: MailDropPayload) => void): (r: MailDropResult) => void {
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
      const items = itemsForDrag(threadIds, threadSubjects(document));
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

if (typeof document !== 'undefined') {
  const { ipcRenderer } = require('electron') as typeof import('electron');

  let notifyState: NotifyState = { show: true, silent: false };
  ipcRenderer.on(IPC.NOTIFY_ALLOWED, (_e: unknown, state: NotifyState) => {
    notifyState = state;
  });

  window.open = wrapWindowOpen(window.open.bind(window));

  const report = () =>
    computeAndReport(document, (channel, count) => ipcRenderer.send(channel, count));

  const start = () => {
    report();
    const titleEl = document.querySelector('title');
    if (titleEl) {
      new MutationObserver(report).observe(titleEl, { childList: true });
    }
    setInterval(report, 5000);

    // Gmail's own notifications are relayed to main rather than raised here: main draws
    // every notification the app gives, and only main knows the account this view belongs
    // to, whether it should stay, and what the privacy settings should replace. The stub
    // returned is the object Gmail's code goes on to use, so it has to answer to onclick,
    // close and addEventListener whatever we do with it. The original body is kept until
    // the click, because finding the thread means matching that subject in this page's
    // DOM, and by then main has long since replaced the text on screen.
    const bodies = new Map<string, string>();
    const loadNonce = Math.random().toString(36).slice(2, 10);
    let webNotifySeq = 0;
    const Wrapped = function (this: Notification, title: string, options?: NotificationOptions) {
      if (!notifyState.show) {
        return { onclick: null, close() {}, addEventListener() {} } as unknown as Notification;
      }
      webNotifySeq += 1;
      const id = webNotifyPageId(loadNonce, webNotifySeq);
      const payload = webNotifyPayload(id, title, options);
      bodies.set(id, payload.body);
      ipcRenderer.send(IPC.WEB_NOTIFY_SHOW, payload);
      return {
        onclick: null,
        close: () => bodies.delete(id),
        addEventListener() {},
      } as unknown as Notification;
    } as unknown as typeof Notification;
    const Original = window.Notification;
    if (Original) {
      Object.defineProperty(Wrapped, 'permission', {
        configurable: true,
        get: () => Original.permission,
      });
      Wrapped.requestPermission = Original.requestPermission.bind(Original);
    }
    window.Notification = Wrapped;

    // The second argument is diagnostic and travels with the click rather than being logged
    // here, because a console line inside a Gmail view is somewhere nobody is looking. Main
    // logs it. What it is for: this lookup is a guess by construction — the notification
    // carries no thread id, so the thread is found by matching its text against the rows
    // that happen to be rendered — and when it guesses wrong there is nothing afterwards
    // that can tell which way it went. `rows` distinguishes a view showing an open
    // conversation or a different label (no list, so nothing to match) from one showing the
    // inbox; `matches` distinguishes an ambiguous subject from an absent one.
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

    rerouteServiceWorkerNotifications(
      typeof ServiceWorkerRegistration !== 'undefined' ? ServiceWorkerRegistration.prototype : undefined,
      () => window.Notification,
    );

    if (location.hostname === 'mail.google.com') {
      const showResult = installDropzone((p) => ipcRenderer.send(IPC.MAIL_DROP, p));
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
