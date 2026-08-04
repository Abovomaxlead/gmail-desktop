import { parseUnreadCount } from './unread-parser';
import { IPC, type NotifyState, type MailDropPayload, type MailDropResult } from './ipc';
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
  // Locale-independent: the Google account button is an <a> whose aria-label
  // contains the signed-in email (an @-address) and which holds the avatar <img>.
  // (The old `aria-label^="Google Account"` match broke for non-English Gmail UIs.)
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
    .replace(/^[^:]*:\s*/, '') // strip any leading "Xxx:" prefix (any language)
    .replace(/\s*\(.*\)\s*$/, '') // strip trailing "(email)"
    .trim();
  const img = anchor.querySelector('img');
  const avatarUrl: string = (img && img.getAttribute('src')) || '';
  if (!email && !avatarUrl) return null;
  return { email, name, avatarUrl };
}

// Gmail's new-mail notifications carry no thread id (tag = account email, data
// = null) and Gmail's own click handler never opens the message inside the
// wrapper (verified: it runs but no-ops even with user activation). The inbox
// list DOM marks each row's subject span with data-legacy-thread-id, so the
// notification body (= subject) identifies the thread to open. Rows are
// newest-first; the first match is the message that fired the notification.
export function findThreadIdBySubject(
  doc: { querySelectorAll(sel: string): ArrayLike<any> },
  subject: string,
): string | null {
  const wanted = (subject || '').trim();
  if (!wanted) return null;
  // Gmail may ellipsize long subjects in the notification body.
  const ellipsized = /(…|\.\.\.)$/.test(wanted);
  const prefix = wanted.replace(/(…|\.\.\.)$/, '');
  for (const el of Array.from(doc.querySelectorAll('[data-legacy-thread-id]'))) {
    const id = el.getAttribute('data-legacy-thread-id');
    if (!id) continue;
    const text = (el.textContent || '').trim();
    if (text === wanted || (ellipsized && text.startsWith(prefix))) return id;
  }
  return null;
}

// Google Calendar fires event reminders through ServiceWorkerRegistration.
// showNotification ("persistent" notifications), which Electron never displays
// (electron/electron#13041) and which would bypass the notify-allowed gate and
// click routing below. Reroute them through window.Notification — resolved at
// call time so the gated wrapper installed later is the one that runs.
export function rerouteServiceWorkerNotifications(
  swRegProto:
    | { showNotification?: (title: string, options?: NotificationOptions) => Promise<void> }
    | undefined,
  getNotification: () => typeof Notification,
): void {
  if (!swRegProto || typeof swRegProto.showNotification !== 'function') return;
  swRegProto.showNotification = function (title: string, options?: NotificationOptions) {
    // `actions` (and only it) is rejected by the non-persistent constructor.
    const { actions: _actions, ...rest } = (options ?? {}) as NotificationOptions & {
      actions?: unknown;
    };
    new (getNotification())(title, rest);
    return Promise.resolve();
  };
}

// Apply the main-process gate's styling to the options the page passed.
// `requireInteraction` is the web API's name for "don't auto-dismiss"; Electron
// maps it to timeoutType 'never', which on Windows becomes a scenario="reminder"
// toast that stays up until the user closes it.
export function notificationOptionsFor(
  state: NotifyState,
  options?: NotificationOptions,
): NotificationOptions | undefined {
  const hideBody = typeof state.hiddenSubject === 'string';
  if (!state.silent && !state.persist && !hideBody) return options;
  return {
    ...options,
    ...(hideBody ? { body: state.hiddenSubject } : {}),
    ...(state.silent ? { silent: true } : {}),
    ...(state.persist ? { requireInteraction: true } : {}),
  };
}

// De titel van een melding uit de pagina, met "toon de afzender niet" erop
// toegepast. Main stuurt de vervangende tekst mee in plaats van een vlaggetje: de
// tekst die de gebruiker leest hoort niet in dit bestand te staan, dat in Gmail's
// eigen pagina wordt geïnjecteerd en geen taal kent. Staat er niets in de stand,
// dan komt de titel van de pagina er ongewijzigd door.
export function notificationTitleFor(state: NotifyState, title: string): string {
  return typeof state.hiddenSender === 'string' ? state.hiddenSender : title;
}

export function isEditableTarget(
  el: { tagName?: string; isContentEditable?: boolean } | null | undefined,
): boolean {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || el.isContentEditable === true;
}

// The main process denies window.open calls it handles itself (in-app
// navigation, external browser, or the duplicate popup right after a handled
// notification click). A denied window.open returns null, which Gmail reads as
// a popup blocker and alerts. Substitute a harmless window-like stub — the
// open WAS handled, just not as a new renderer window.
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

// Hangt de dropzone in de Gmail-pagina en geeft terug hoe je het resultaat van
// een drop toont. Alleen aanroepen als er een document is.
function installDropzone(send: (p: MailDropPayload) => void): (r: MailDropResult) => void {
  const style = document.createElement('style');
  style.textContent = DROPZONE_CSS;
  const zone = document.createElement('div');
  zone.id = DROPZONE_ID;
  zone.textContent = DROPZONE_LABEL;
  zone.setAttribute('data-state', 'idle');

  // In <body>, niet in <html>: een element dat naast <body> hangt krijgt geen
  // plek in de renderboom en blijft dus onzichtbaar, hoe hoog de z-index ook is.
  const host = document.body ?? document.documentElement;
  const attach = () => {
    if (!host.contains(style)) host.appendChild(style);
    if (!host.contains(zone)) host.appendChild(zone);
  };
  attach();
  // Gmail's SPA vervangt soms hele takken van de DOM; dan hangen we 'm terug.
  new MutationObserver(attach).observe(host, { childList: true });
  // Zichtbaar in devtools (Ctrl+Shift+I) of de dropzone überhaupt geïnstalleerd is.
  console.info('[gmail-desktop] dropzone geïnstalleerd in', host.tagName);

  let clearTimer: ReturnType<typeof setTimeout> | null = null;
  let saving = false;
  const setState = (s: string) => zone.setAttribute('data-state', s);
  const reset = () => {
    saving = false;
    zone.textContent = DROPZONE_LABEL;
    setState('idle');
  };

  // Muisknop ingedrukt op een conversatierij: onthoud welke, maar toon nog
  // niets — een gewone klik is geen sleep.
  let pressThreadId: string | null = null;
  let pressLabel: string | null = null;
  let pressAt: Point | null = null;
  let dragging = false;

  // Gmail tekent tijdens het slepen een eigen kaartje dat de cursor volgt ("Een
  // gesprek verplaatsen"). Dat verschijnt als nieuw element in de pagina zodra
  // de sleep begint. Onze strip zit één laag onder het maximum, dus wat Gmail
  // erbij zet kan die laatste laag krijgen en blijft zichtbaar boven de strip.
  //
  // Alleen tijdens de sleep en alleen voor wat er in díe tijd bijkomt; de oude
  // waarde gaat er achteraf weer op. Op "er komt een zwevend element bij" en
  // niet op een klassenaam: Gmail's klassenamen zijn vervormd en veranderen.
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
      // Een label uit de linkernavigatie: geen conversatierij, dus alleen kijken
      // als er geen thread-id onder de cursor zat.
      pressLabel = pressThreadId ? null : labelFromDragTarget(target);
      pressAt = { x: e.clientX, y: e.clientY };
      dragging = false;
      // Slepen over tekst selecteert die tekst, en die selectie blijft na het
      // loslaten staan. Druk je daarna nóg eens op diezelfde, nu geselecteerde
      // tekst en beweeg je, dan begint Chromium zijn eigen sleep van de
      // selectie — en zodra dat gebeurt houden de mousemove-events op en
      // verschijnt onze strip nooit meer. Dat treft precies het label dat je
      // net versleepte, en niet de labels ernaast. Selectie weg bij het
      // indrukken, dus elke sleep begint weer schoon.
      if (pressThreadId || pressLabel) {
        window.getSelection()?.removeAllRanges();
        // Nu al kijken, niet pas als de sleep de drempel haalt: Gmail zet zijn
        // kaartje neer op zijn eigen moment en dat kan eerder zijn.
        liftDragChrome();
      }
    },
    true,
  );

  // Vangnet voor hetzelfde: begint Chromium tóch een eigen sleep (een <a> in de
  // navigatie is vanzelf sleepbaar), dan hier afbreken. Zonder dit stopt de
  // gebeurtenissenstroom waar de strip op draait.
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
        // Geen sleep, of niet boven de strip losgelaten. Een lopende opslag mag
        // hier niet door weggepoetst worden.
        if (!saving) reset();
        return;
      }
      const threadIds = threadIdsForDrag(threadId, selectedThreadIds(document));
      // Onderwerpen nú vastleggen: na het opslaan kan de lijst al ververst zijn.
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

// Electron-only wiring. Guarded so the module is importable under plain Node (tests).
if (typeof document !== 'undefined') {
  // Lazy require avoids bundling issues and keeps the top of the module Node-safe.
  const { ipcRenderer } = require('electron') as typeof import('electron');

  let notifyState: NotifyState = { show: true, silent: false, persist: false };
  ipcRenderer.on(IPC.NOTIFY_ALLOWED, (_e: unknown, state: NotifyState) => {
    notifyState = state;
  });

  // Install before page scripts run so Gmail never sees a null window.open.
  window.open = wrapWindowOpen(window.open.bind(window));

  const report = () =>
    computeAndReport(document, (channel, count) => ipcRenderer.send(channel, count));

  const start = () => {
    report();
    const titleEl = document.querySelector('title');
    if (titleEl) {
      new MutationObserver(report).observe(titleEl, { childList: true });
    }
    // Fallback: Gmail sometimes replaces the title element wholesale.
    setInterval(report, 5000);

    const Original = window.Notification;
    if (Original) {
      const Wrapped = function (this: Notification, title: string, options?: NotificationOptions) {
        if (!notifyState.show) {
          // Return a harmless stub so Gmail's code doesn't throw; nothing is shown.
          return { onclick: null, close() {}, addEventListener() {} } as unknown as Notification;
        }
        const n = new Original(
          notificationTitleFor(notifyState, title),
          notificationOptionsFor(notifyState, options),
        );
        n.addEventListener('click', () => {
          // Resolve the clicked thread at click time (the row exists by then).
          // Let op: `options?.body` en niet de tekst die uiteindelijk in de melding
          // stond. Staat "toon het onderwerp niet" aan, dan is die vervangen door een
          // neutrale regel, en daarmee is geen gesprek terug te vinden — het
          // onderwerp van de pagina is wat in de berichtenlijst staat.
          const threadId = findThreadIdBySubject(document, options?.body ?? '');
          ipcRenderer.send(IPC.NOTIFICATION_ACTIVATE, threadId ?? undefined);
        });
        return n;
      } as unknown as typeof Notification;
      // Delegate `permission` live via a getter — copying it once freezes it at
      // 'default', so Gmail would think notifications are disabled forever and
      // never fire one. The getter always reflects the real granted state.
      Object.defineProperty(Wrapped, 'permission', {
        configurable: true,
        get: () => Original.permission,
      });
      Wrapped.requestPermission = Original.requestPermission.bind(Original);
      window.Notification = Wrapped;
    }

    rerouteServiceWorkerNotifications(
      typeof ServiceWorkerRegistration !== 'undefined' ? ServiceWorkerRegistration.prototype : undefined,
      () => window.Notification,
    );

    // De agenda-view draait dezelfde preload maar heeft geen berichtenlijst.
    if (location.hostname === 'mail.google.com') {
      const showResult = installDropzone((p) => ipcRenderer.send(IPC.MAIL_DROP, p));
      ipcRenderer.on(IPC.MAIL_DROP_RESULT, (_e: unknown, r: MailDropResult) => showResult(r));
    }

    // Poll for the signed-in identity and report it once found.
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
