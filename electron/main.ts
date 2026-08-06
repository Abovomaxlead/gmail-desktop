// The Electron main process: window and tray, per-account views and sessions, account
// detection, notifications, downloads, drag-to-save, Gmail-API sync and every IPC
// handler. The pure decisions live in the small modules beside this file.
//
// Ordering that breaks if moved: disableHardwareAcceleration and the WSL
// software-rendering switch must run before app 'ready' (hence the throwaway PrefsStore
// up there, and no inverse call to re-enable); the 'session-created' and context-menu
// hooks must be registered before createWindow; the nativeTheme listener is registered
// once at startup, not in createWindow, which runs again after a notification click and
// would leak a listener each time; and setAppUserModelId is required or Windows
// silently drops Gmail's notifications.
//
// Other traps: DownloadItem.getStartTime() returns seconds, not milliseconds;
// accounts.json is never written empty, as empty usually means detection has confirmed
// nothing yet; a view left at setVisible(false) counts as occluded and Gmail then never
// builds its message list, hence the one-off warm-up; each account has exactly one
// unread source at a time (labels.get under push, page title otherwise) or the number
// oscillates; and reveal/open accept only paths already in the download log.

import { app, BrowserWindow, protocol, net, ipcMain, session, Menu, screen, dialog, shell, clipboard, Notification, nativeTheme } from 'electron';
import { join } from 'node:path';
import { readFileSync, mkdirSync, writeFileSync, watch, existsSync } from 'node:fs';
import { release } from 'node:os';
import { pathToFileURL } from 'node:url';
import type { Tray } from 'electron';
import { parseChangelog, type ChangelogVersion } from './changelog';
import { ProfileViewManager, type Profile, type Surface } from './profile-view-manager';
import { SURFACES, SURFACE_CONFIG, surfacesForRef } from '../renderer/lib/surfaces';
import { accountCountVisible } from '../renderer/lib/badge-visibility';
import { accountKey, parseAccountKey, type AccountRef } from './account-ref';
import { resolveLocale, type LanguagePref, type Locale } from './locale';
import { DelegatedStore, type StoredDelegate } from './delegated-store';
import {
  AccountCacheStore,
  seedable,
  rememberedOrder,
  type CachedAccount,
} from './account-cache';
import { SWITCHER_SCRAPE_JS, parseDelegatedEntries } from './delegation';
import { planDelegated } from './delegation-planner';
import { ColorStore } from './color-store';
import { RemovedStore } from './removed-store';
import {
  PrefsStore,
  type AppearancePatch,
  type DownloadClickAction,
  type Prefs,
} from './prefs-store';
import { hostOf, needsLinkConfirm, unwrapRedirect } from './link-guard';
import { uniqueFileName } from './download-path';
import { clampBoundsToDisplays, grownToMinimum } from './window-bounds';
import { colorForIndex } from './palette';
import { planNext } from './detection-planner';
import { WarmupTracker } from './view-warmup';
import { addAccountUrl } from './google-urls';
import { popupNativeMenu } from './native-menu';
import type { NativeMenuItem } from '../renderer/lib/native-menu';
import { nativeLabels } from './native-labels';
import { applyBadge } from './badge-controller';
import { UnreadStore } from './unread-store';
import { shouldNotifyUpdate } from './update-notifier';
import {
  IPC,
  type MailDropPayload,
  type MailDropPreviewItem,
  type MailDropCopyTarget,
  type MailDropCopyAccountResult,
  type MailDropCopyResult,
  type MailDropCopyDuplicate,
} from './ipc';
import {
  normalizeTargets,
  copyTotal,
  groupDuplicates,
  duplicateIndex,
  labelsStillNeeded,
  newMessageCount,
  type DuplicateHit,
  type CopyMode,
} from './mail-copy';
import { parseHeaders, extractPlainText, htmlToText } from './eml';
import { writeThread, writeLabel, appendLog, displayName, type LogRecord, type SavedMessage } from './mail-archive';
import {
  labelListUrl,
  mergeThreads,
  LABEL_SCRAPE_JS,
  MAX_PAGES,
  MAX_THREADS,
  PAGE_SIZE,
  type LabelThread,
} from './label-drop';
import { fetchThreadEmls } from './mail-fetch';
import { NO_SUBJECT } from './dropzone';
import { shouldHideOnClose, createTray, updateTrayMenu, type TrayState, type TrayUpdateStatus } from './tray-controller';
import { trayLabels } from './tray-labels';
import { autoUpdater } from 'electron-updater';
import { resolveShortcut, type KeyInput } from './shortcuts';
import { openCompose, openFullThreadWindow } from './compose-window';
import { parseMailto, extractMailtoFromArgv, type MailtoFields } from './mailto';
import type { ComposeAccountAsk, ComposeAccountChoice } from '../renderer/lib/compose-account';
import {
  MAIL_APP_NAME,
  isOurProgId,
  readMailtoProgId,
  registerMailClient,
} from './mail-client-registration';
import { sortByOrder } from './account-order';
import {
  notificationsAllowed,
  notificationSilent,
  notificationPersist,
  wantsCalendarView,
  mergeNotificationsFromPanel,
} from './notification-policy';
import { updateCheckPopup } from './update-popup';
import { RENE_ZOOM_FACTOR, RENE_ZOOM_LEVEL } from './rene';
import { attachContextMenu, LABELS_NORMAL, LABELS_RENE, LABELS_NL } from './context-menu';
import { attachExternalLinkHandling, setExternalOpener } from './external-links';
import { googleAppTarget } from './google-apps-open';
import { DownloadHistoryStore } from './download-history';
import { overlayOptions, supportsOverlay, supportsOverlayUpdate, windowBackground } from './titlebar';
import { OverlayView } from './overlay-view';
import { ComposePicker } from './compose-picker';
import {
  openComposeAccountWindow,
  resizeAndShowComposeAccountWindow,
} from './compose-account-window';
import { ToastWindow } from './toast-window';
import { ToastController, type ToastInput } from './toast-controller';
import type { Toast, ToastAccount, ToastAction } from '../renderer/lib/toast';
import { accountsNeedingReconnect, bannerBounds, type ReconnectAccount } from './oauth-health';
import {
  fetchLabels,
  fetchLabelId,
  listLabelThreadIds,
  fetchThreadRaw,
  insertMessage,
  messageExistsInLabel,
  watchMailbox,
  stopWatch,
  fetchProfileHistoryId,
  fetchHistoryPage,
  fetchMessageMeta,
  fetchInboxUnread,
  GmailHttpError,
  type AccountLabels,
  type MessageMeta,
  fetchMessageRaw,
  markMessageRead,
  trashMessage,
} from './gmail-api';
import { mapLimit } from './concurrency';
import { OAuthStore } from './oauth-store';
import { connectAccount, accessTokenFor, forceRefresh } from './oauth-flow';
import { hasScopes, type OAuthConfig } from './google-oauth';
import { parsePushConfig, type PushConfig } from './push-config';
import { PushCoverage } from './push-coverage';
import { HistoryStore } from './history-store';
import { startPushManager } from './push-manager';
import { createSyncRunner } from './push-sync';
import { findVerificationCode, subjectSuggestsCode } from './verification-code';

if (process.platform === 'linux' && /microsoft|WSL/i.test(release())) {
  app.disableHardwareAcceleration();
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

try {
  const early = new PrefsStore(join(app.getPath('userData'), 'prefs.json')).getAll();
  if (early.advanced.hardwareAcceleration === false) app.disableHardwareAcceleration();
} catch {
}

// The floor the "do not make it too small" switch enforces. Height matters as much as
// width: the topbar is 40px (80 in Rene mode) and everything below it is the mail view,
// so without a minimum height the window can be squashed to a bare strip of chrome.
const MIN_WINDOW_WIDTH = 800;
const MIN_WINDOW_HEIGHT = 600;

const RENDERER_DIST = join(__dirname, '..', 'renderer', 'out');
const CHANGELOG_PATH = join(__dirname, '..', 'CHANGELOG.md');

function loadChangelog(): ChangelogVersion[] {
  try {
    return parseChangelog(readFileSync(CHANGELOG_PATH, 'utf8'));
  } catch {
    return [];
  }
}
const PRELOAD_PATH = join(__dirname, 'preload.js');
const SIDEBAR_PRELOAD_PATH = join(__dirname, 'sidebar-preload.js');
const ICON_PATH = join(app.getAppPath(), 'assets', 'icon.png');
const DEV_URL = process.env.ELECTRON_RENDERER_URL;
const OAUTH_CONFIG_PATH = join(app.getPath('userData'), 'google-oauth.json');
const PROBE_TIMEOUT_MS = 16000;

let mainWindow: BrowserWindow | null = null;
let manager: ProfileViewManager | null = null;
let colors: ColorStore | null = null;
let removed: RemovedStore | null = null;
let delegated: DelegatedStore | null = null;
let prefs: PrefsStore | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let settingsPanelOpen = false;
let dropOverlay: OverlayView | null = null;
let lastDropPreview: MailDropPreviewItem[] = [];
interface SavedRef {
  file: string;
  messageId: string;
  subject: string;
}
let lastDropSaved: SavedRef[] = [];
let lastDropSource = '';
let oauthTokens: OAuthStore | null = null;
let history: HistoryStore | null = null;
let downloadHistory: DownloadHistoryStore | null = null;
const coverage = new PushCoverage();
let pushManager: { stop(): void; refresh(): void } | null = null;
const syncRunners = new Map<string, { run(): Promise<void> }>();
let reconnectBanner: OverlayView | null = null;
let reconnectAccounts: ReconnectAccount[] = [];
let toasts: ToastController | null = null;
let updateRequested = false;
let pendingTrayUpdateCheck = false;
let lastUpdateStatus: Record<string, unknown> = { state: 'idle' };
let notifiedUpdateVersion: string | null = null;
let lastCheckBackground = false;
let pendingMailto: string | null = null;
let composeAccountWindow: BrowserWindow | null = null;
const composePicker = new ComposePicker<ComposeAccountAsk, string>({
  open: (ask) => showComposeAccountWindow(ask),
  close: () => closeComposeAccountWindow(),
  redispatch: (url) => void dispatchMailto(url),
});

const SESSION_PARTITION = 'persist:google';

const profiles: Profile[] = [];
const seenEmails = new Set<string>();
const unread = new UnreadStore();
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let probingIndex: number | null = null;
let visibleProbe: number | null = null;
let detectionStarted = false;
let cachedAccounts: CachedAccount[] = [];
let accountCache: AccountCacheStore | null = null;
let accountCacheLoaded = false;
let seedOrder = new Map<string, number>();
const SEED_KEY_PREFIX = 'seed:';
const seedKey = (email: string): string => `${SEED_KEY_PREFIX}${email}`;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function registerAppProtocol(): void {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    return net.fetch(pathToFileURL(join(RENDERER_DIST, rel)).toString());
  });
}

const authRef = (index: number): AccountRef => ({ kind: 'authuser', index });
const keyOf = (p: Profile): string => accountKey(p.ref);
const keyOfIndex = (index: number): string => accountKey(authRef(index));
const authIdx = (p: Profile): number => (p.ref.kind === 'authuser' ? p.ref.index : -1);
const idxOfKey = (key: string): number | null => {
  const parsed = parseAccountKey(key);
  return parsed.kind === 'authuser' ? parsed.index : null;
};

function colorForEmail(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) | 0;
  return colorForIndex(Math.abs(h));
}

function delegatedProfileFor(d: StoredDelegate): Profile {
  const ref: AccountRef = {
    kind: 'delegated',
    email: d.email,
    mailUrl: d.mailUrl,
    calendarUrl: d.calendarUrl,
  };
  return {
    ref,
    kind: 'delegated',
    email: d.email,
    name: d.email,
    avatarUrl: '',
    color: colors?.get(d.email) ?? colorForEmail(d.email),
  };
}

function loadDelegatedProfiles(): void {
  if (!delegated) return;
  const fresh: Profile[] = [];
  for (const d of delegated.list()) {
    const email = d.email.toLowerCase();
    if (removed?.has(email)) continue;
    if (profiles.some((p) => p.email.toLowerCase() === email)) continue;
    const profile = delegatedProfileFor({ ...d, email });
    profiles.push(profile);
    fresh.push(profile);
  }
  if (fresh.length > 0) {
    pushProfiles();
    syncCalendarViews();
    for (const profile of fresh) warmAccount(profile);
  }
}

async function scanSwitcherEntries(): Promise<Array<{ email: string; mailUrl: string }>> {
  if (!manager) return [];
  const raw = await manager.scrapeSwitcher(keyOfIndex(0), SWITCHER_SCRAPE_JS).catch(() => []);
  return parseDelegatedEntries(raw).map((e) => ({ email: e.email, mailUrl: e.mailUrl }));
}

function suggestableDelegates(
  entries: Array<{ email: string; mailUrl: string }>,
  respectRemoved: boolean,
): Array<{ email: string; mailUrl: string }> {
  const removedKeys = respectRemoved ? (removed?.list().map((e) => `d:${e.toLowerCase()}`) ?? []) : [];
  return planDelegated(entries, [...seenEmails], removedKeys)
    .filter((e) => !profiles.some((p) => p.email.toLowerCase() === e.email))
    .map((e) => ({ email: e.email, mailUrl: e.mailUrl }));
}

async function scanDelegatedSuggestions(): Promise<Array<{ email: string; mailUrl: string }>> {
  return suggestableDelegates(await scanSwitcherEntries(), false);
}

function pushDelegatedSuggestions(suggestions: Array<{ email: string; mailUrl: string }>): void {
  mainWindow?.webContents.send(IPC.DELEGATED_SUGGESTIONS, { suggestions });
}

let delegatedScanStarted = false;
async function refreshAndSuggestDelegated(): Promise<void> {
  if (!delegated || !manager) return;
  const entries = await scanSwitcherEntries();
  const stored = delegated.list();
  if (entries.length < stored.length) return;
  const freshByEmail = new Map(entries.map((e) => [e.email.toLowerCase(), e.mailUrl]));
  let changed = false;
  for (const d of stored) {
    const fresh = freshByEmail.get(d.email.toLowerCase());
    if (!fresh || fresh === d.mailUrl) continue;
    delegated.upsert({ ...d, mailUrl: fresh });
    const p = profiles.find((x) => x.kind === 'delegated' && x.email.toLowerCase() === d.email.toLowerCase());
    if (p && p.ref.kind === 'delegated') {
      for (const s of SURFACES) manager.discardView(keyOf(p), s);
      p.ref = { ...p.ref, mailUrl: fresh };
      changed = true;
    }
  }
  if (changed) pushProfiles();
  if (entries.length > 0) pushDelegatedSuggestions(suggestableDelegates(entries, true));
}

function addDelegatedMailbox(email: string, mailUrl: string): void {
  if (!delegated) return;
  const e = email.trim().toLowerCase();
  if (!e || !mailUrl) return;
  if (profiles.some((p) => p.email.toLowerCase() === e)) return;
  removed?.remove(e);
  const entry: StoredDelegate = { email: e, mailUrl, calendarUrl: null };
  delegated.upsert(entry);
  loadDelegatedProfiles();
  showAccount({ kind: 'delegated', email: e, mailUrl, calendarUrl: null }, 'mail');
}

interface TabRow {
  key: string;
  kind: AccountRef['kind'];
  index: number;
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
  hasCalendar: boolean;
  order?: number;
  label?: string;
  provisional?: boolean;
}

function decorate(list: Profile[]): TabRow[] {
  const confirmed: TabRow[] = list.map((p) => {
    const ap = prefs?.getAccount(p.email) ?? {};
    return {
      key: keyOf(p),
      kind: p.ref.kind,
      index: authIdx(p),
      email: p.email,
      name: p.name,
      avatarUrl: p.avatarUrl,
      color: p.color,
      hasCalendar: surfacesForRef(p.ref).includes('calendar'),
      order: ap.order ?? seedOrder.get(p.email.toLowerCase()),
      label: ap.label,
    };
  });
  const seeds: TabRow[] = seedable(cachedAccounts, {
    confirmed: profiles.map((p) => p.email),
    removed: removed?.list() ?? [],
  }).map((c) => {
    const ap = prefs?.getAccount(c.email) ?? {};
    return {
      key: seedKey(c.email),
      kind: 'authuser',
      index: -1,
      email: c.email,
      name: c.name,
      avatarUrl: c.avatarUrl,
      color: colors?.get(c.email) ?? c.color,
      hasCalendar: false,
      order: ap.order ?? seedOrder.get(c.email),
      label: ap.label,
      provisional: true,
    };
  });
  return sortByOrder([...confirmed, ...seeds]);
}
function pushProfiles(): void {
  const rows = decorate([...profiles]);
  mainWindow?.webContents.send(IPC.PROFILES_CHANGED, rows);
  saveAccountCache(rows);
  scheduleOAuthHealthCheck();
}
function pushUnread(): void {
  mainWindow?.webContents.send(IPC.UNREAD_CHANGED, unread.snapshot());
}
function saveAccountCache(rows: TabRow[]): void {
  if (!accountCache) return;
  const own = rows.filter((r) => r.kind === 'authuser');
  if (own.length === 0) return;
  accountCache.save(
    own.map((r) => ({ email: r.email, name: r.name, avatarUrl: r.avatarUrl, color: r.color })),
  );
}
function settleDetection(): void {
  probingIndex = null;
  cachedAccounts = [];
  pushProfiles();
}
function excludedBadgeKeys(): Set<string> {
  const keys = new Set<string>();
  for (const p of profiles) {
    if (
      !accountCountVisible(
        prefs?.getAccount(p.email).badgeCount,
        prefs?.getAll().appearance.showUnreadBadges,
      )
    ) {
      keys.add(keyOf(p));
    }
  }
  return keys;
}
function refreshBadge(): void {
  applyBadge(unread.snapshot(), (n) => app.setBadgeCount(n), excludedBadgeKeys(), () => {
    if (process.platform === 'win32') mainWindow?.setOverlayIcon(null, '');
  });
}
// One place decides the language, so the panel, the context menu and the native dialogs
// cannot disagree. The resolved locale rides along with the prefs push rather than
// being worked out again in the renderer.
function currentLocale(): Locale {
  return resolveLocale(prefs?.getAll().language ?? 'system', app.getLocale());
}
function pushPrefs(): void {
  if (prefs) mainWindow?.webContents.send(IPC.PREFS_CHANGED, { ...prefs.getAll(), locale: currentLocale() });
}
// On Windows the truth lives in UrlAssociations\mailto\UserChoice, not in the legacy
// HKCU\Software\Classes\mailto key, so ask the registry which ProgId actually wins.
async function pushDefaultMailStatus(): Promise<void> {
  const isDefault =
    process.platform === 'win32'
      ? isOurProgId(await readMailtoProgId())
      : app.isDefaultProtocolClient('mailto');
  mainWindow?.webContents.send(IPC.MAIL_DEFAULT_STATUS, isDefault);
}

function clearProbeTimer(): void {
  if (probeTimer) {
    clearTimeout(probeTimer);
    probeTimer = null;
  }
}

function probe(index: number): void {
  probingIndex = index;
  manager?.ensureView(authRef(index), 'mail', false);
  clearProbeTimer();
  if (index > 0) {
    probeTimer = setTimeout(() => {
      manager?.discardView(keyOfIndex(index), 'mail');
      probeTimer = null;
      settleDetection();
    }, PROBE_TIMEOUT_MS);
  }
}

function onIdentity(index: number, identity: { email: string; name: string; avatarUrl: string }): void {
  if (profiles.some((p) => authIdx(p) === index)) return;

  const email = identity?.email;
  const isVisibleAdd = visibleProbe === index;

  if (isVisibleAdd && email && removed!.has(email)) removed!.remove(email);

  if (!isVisibleAdd && email && removed!.has(email)) {
    clearProbeTimer();
    probingIndex = null;
    manager?.discardView(keyOfIndex(index), 'mail');
    if (manager?.activeKey() == null && profiles[0]) switchSurface(authIdx(profiles[0]), 'mail');
    probe(index + 1);
    return;
  }

  const decision = planNext([...seenEmails], index, identity);
  clearProbeTimer();
  probingIndex = null;
  if (decision.register && identity.email) {
    if (isVisibleAdd) {
      visibleProbe = null;
      void addAccountAfterConsent(index, identity, decision.stop);
      return;
    }
    registerAccount(index, identity);
    if (manager?.activeKey() == null) {
      switchSurface(index, 'mail');
    }
  } else if (index > 0) {
    manager?.discardView(keyOfIndex(index), 'mail');
    if (isVisibleAdd) {
      visibleProbe = null;
      if (profiles[0]) switchSurface(authIdx(profiles[0]), 'mail');
    }
  }
  if (!decision.stop) probe(index + 1);
  else if (identity?.email) settleDetection();
}

function registerAccount(
  index: number,
  identity: { email: string; name: string; avatarUrl: string },
): void {
  seenEmails.add(identity.email);
  const dup = profiles.findIndex(
    (p) => p.kind === 'delegated' && p.email.toLowerCase() === identity.email.toLowerCase(),
  );
  if (dup !== -1) {
    for (const surface of SURFACES) manager?.discardView(keyOf(profiles[dup]), surface);
    profiles.splice(dup, 1);
  }
  const color = colors!.get(identity.email) ?? colorForIndex(index);
  const profile: Profile = {
    ref: authRef(index),
    kind: 'authuser',
    email: identity.email,
    name: identity.name,
    avatarUrl: identity.avatarUrl,
    color,
  };
  profiles.push(profile);
  profiles.sort((a, b) => authIdx(a) - authIdx(b));
  pushProfiles();
  refreshNotifyAllowed();
  startPush();
  syncCalendarViews();
  warmAccount(profile);
}

async function addAccountAfterConsent(
  index: number,
  identity: { email: string; name: string; avatarUrl: string },
  stopProbing: boolean,
): Promise<void> {
  const email = identity.email;
  const cfg = oauthConfig();
  const needsConsent =
    cfg !== null && oauthTokens !== null && !oauthTokens.get(email) && !!mainWindow && !mainWindow.isDestroyed();

  if (needsConsent) {
    const result = await connectAccount(mainWindow!, SESSION_PARTITION, cfg!, oauthTokens!, email);
    if (!result.ok) {
      manager?.discardView(keyOfIndex(index), 'mail');
      if (profiles[0]) switchSurface(authIdx(profiles[0]), 'mail');
      const L = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true);
      showToast({
        kind: 'error',
        title: L.accountNotAddedTitle,
        body: L.accountNotAddedBody(email, result.error),
        persist: true,
      });
      if (!stopProbing) probe(index + 1);
      else settleDetection();
      return;
    }
  }

  registerAccount(index, identity);
  switchSurface(index, 'mail');
  if (!stopProbing) probe(index + 1);
  else settleDetection();
}

function removeAccount(email: string): void {
  removed!.add(email);
  accountCache?.remove(email);
  const stopToken = oauthTokens?.get(email)?.accessToken;
  if (stopToken) void stopWatch(stopToken).catch(() => undefined);
  history?.remove(email);
  coverage.forget(email);
  syncRunners.delete(email);
  oauthTokens?.remove(email);
  const profile = profiles.find((p) => p.email === email);
  if (!profile) {
    pushProfiles();
    return;
  }
  if (profile.kind === 'delegated') delegated?.remove(email);
  const wasActive = manager?.activeKey() === keyOf(profile);
  profiles.splice(profiles.indexOf(profile), 1);
  seenEmails.delete(email);
  unread.forget(keyOf(profile));
  for (const surface of SURFACES) manager?.discardView(keyOf(profile), surface);
  pushProfiles();
  pushUnread();
  refreshBadge();
  startPush();
  if (wasActive && profiles[0]) showAccount(profiles[0].ref, 'mail');
}

function showAccount(ref: AccountRef, surface: Surface): void {
  manager?.show(ref, surface);
  refreshNotifyAllowed();
  flushPendingMailto();
}

function activeView(): { ref: AccountRef; surface: Surface } | null {
  const m = manager;
  const key = m?.activeKey();
  if (!m || !key) return null;
  const p = profiles.find((x) => keyOf(x) === key);
  const surface = SURFACES.find((s) => m.isShowing(key, s));
  return p && surface ? { ref: p.ref, surface } : null;
}

// One window per ask, destroyed on settle: reuse would carry the previous recipient into
// an unrelated next question for no gain, since the picker is short-lived. The module
// variable is nulled before the window is destroyed, so a stale instance can never be
// left behind to wedge the feature, and the `closed` that destroying triggers finds the
// resolver already cleared and harmlessly no-ops.
function closeComposeAccountWindow(): void {
  const win = composeAccountWindow;
  composeAccountWindow = null;
  if (win && !win.isDestroyed()) win.destroy();
}

function showComposeAccountWindow(ask: ComposeAccountAsk): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  closeComposeAccountWindow();
  const win = openComposeAccountWindow(
    mainWindow,
    SIDEBAR_PRELOAD_PATH,
    DEV_URL ? `${DEV_URL}/compose-account` : 'app://bundle/compose-account.html',
    ask.accounts.length,
    prefs?.getAll().reneMode ? RENE_ZOOM_FACTOR : 1,
  );
  composeAccountWindow = win;
  win.webContents.on('did-finish-load', () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.COMPOSE_ACCOUNT_ASK, ask);
  });
  win.on('closed', () => {
    if (composeAccountWindow === win) composeAccountWindow = null;
    composePicker.settle(null);
  });
}

function chooseComposeAccount(fields: MailtoFields, mailtoUrl: string): Promise<number | null> {
  const authusers = profiles.filter((p) => p.ref.kind === 'authuser');
  if (authusers.length === 0) return Promise.resolve(null);
  if (authusers.length === 1) return Promise.resolve(authIdx(authusers[0]));
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve(null);

  const accounts: ComposeAccountChoice[] = authusers.map((p) => ({
    index: authIdx(p),
    email: p.email,
    label: prefs?.getAccount(p.email).label ?? p.name ?? p.email,
    color: p.color,
    avatarUrl: p.avatarUrl,
  }));
  const ask: ComposeAccountAsk = {
    to: fields.to,
    subject: fields.subject,
    accounts,
    locale: currentLocale(),
    reneMode: prefs?.getAll().reneMode === true,
  };

  return composePicker.ask(ask, mailtoUrl);
}

async function dispatchMailto(mailtoUrl: string): Promise<void> {
  const fields = parseMailto(mailtoUrl);
  if (!fields) return;
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
  const ready = manager?.activeKey() != null && profiles.some((p) => p.ref.kind === 'authuser');
  if (!ready) {
    pendingMailto = mailtoUrl;
    return;
  }
  const index = await chooseComposeAccount(fields, mailtoUrl);
  if (index == null) return;
  openComposeWindow(index, fields);
}

function flushPendingMailto(): void {
  if (!pendingMailto) return;
  if (manager?.activeKey() == null) return;
  const url = pendingMailto;
  pendingMailto = null;
  void dispatchMailto(url);
}
function switchSurface(index: number, surface: Surface): void {
  showAccount(authRef(index), surface);
}

function startDetection(): void {
  switchSurface(0, 'mail');
}

function redetect(): void {
  clearProbeTimer();
  if (probingIndex !== null && !profiles.some((p) => authIdx(p) === probingIndex)) {
    manager?.discardView(keyOfIndex(probingIndex), 'mail');
  }
  probingIndex = null;
  const maxIndex = profiles.length ? Math.max(...profiles.map((p) => authIdx(p))) : -1;
  probe(maxIndex + 1);
}

function addAccount(): void {
  clearProbeTimer();
  if (probingIndex !== null && !profiles.some((p) => authIdx(p) === probingIndex)) {
    manager?.discardView(keyOfIndex(probingIndex), 'mail');
  }
  const nextIndex = profiles.length ? Math.max(...profiles.map((p) => authIdx(p))) + 1 : 0;
  probingIndex = nextIndex;
  visibleProbe = nextIndex;
  manager?.ensureView(authRef(nextIndex), 'mail', true, addAccountUrl());
}

let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null;
function saveWindowBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !prefs) return;
  const maximized = mainWindow.isMaximized();
  const b = mainWindow.getNormalBounds();
  prefs.setWindow({ width: b.width, height: b.height, x: b.x, y: b.y, maximized });
}
function scheduleSaveBounds(): void {
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(saveWindowBounds, 400);
}

function handleInput(input: KeyInput): void {
  const action = resolveShortcut(input);
  if (!action) return;
  if (action.type === 'devtools') {
    manager?.toggleDevTools();
  } else if (action.type === 'switch') {
    const ordered = [...profiles].sort((a, b) => (a.order ?? authIdx(a)) - (b.order ?? authIdx(b)));
    const target = ordered[action.n - 1];
    if (target) showAccount(target.ref, 'mail');
  } else if (action.type === 'compose') {
    const activeKey = manager?.activeKey();
    const active = activeKey ? idxOfKey(activeKey) : null;
    if (active != null) openComposeWindow(active);
  } else if (action.type === 'zoom') {
    if (prefs?.getAll().reneMode) return;
    const activeKey = manager?.activeKey();
    if (activeKey == null) return;
    const current = manager!.getActiveZoomLevel();
    const level = action.dir === 'reset' ? 0 : current + (action.dir === 'in' ? 0.5 : -0.5);
    const clamped = Math.max(-3, Math.min(3, level));
    manager!.setZoomForKey(activeKey, clamped);
    const email = profiles.find((p) => keyOf(p) === activeKey)?.email;
    if (email) prefs!.setAccount(email, { zoom: clamped });
  }
}

function applyTitleBarOverlay(): void {
  if (!prefs || !mainWindow || mainWindow.isDestroyed()) return;
  if (!supportsOverlayUpdate(process.platform)) return;
  const p = prefs.getAll();
  mainWindow.setTitleBarOverlay(
    overlayOptions(p.theme, nativeTheme.shouldUseDarkColors, p.reneMode),
  );
}

function applyReneZoom(): void {
  if (!prefs || !mainWindow || mainWindow.isDestroyed()) return;
  const on = prefs.getAll().reneMode;
  mainWindow.webContents.setZoomFactor(on ? RENE_ZOOM_FACTOR : 1);
  applyTitleBarOverlay();
  for (const p of profiles) {
    manager?.setZoomForKey(keyOf(p), on ? RENE_ZOOM_LEVEL : prefs.getAccount(p.email).zoom ?? 0);
  }
  manager?.relayout();
}

const NOTIFY_HIDDEN_SENDER = 'New email';
const NOTIFY_HIDDEN_SUBJECT = 'You have new mail.';
let lastSoundAt = 0;
const SOUND_GAP_MS = 1500;
function playNotificationSound(p: Prefs): void {
  if (p.notifications.sound === false) return;
  const name = p.notifications.soundName;
  if (!name) return;
  const now = Date.now();
  if (now - lastSoundAt < SOUND_GAP_MS) return;
  lastSoundAt = now;
  mainWindow?.webContents.send(IPC.NOTIFY_SOUND_PLAY, { name, volume: p.notifications.volume });
}

function hiddenNotificationText(p: Prefs): { hiddenSender?: string; hiddenSubject?: string } {
  return {
    ...(p.notifications.showSender === false ? { hiddenSender: NOTIFY_HIDDEN_SENDER } : {}),
    ...(p.notifications.showSubject === false ? { hiddenSubject: NOTIFY_HIDDEN_SUBJECT } : {}),
  };
}

let notifyTimer: ReturnType<typeof setInterval> | null = null;
function refreshNotifyAllowed(): void {
  if (!prefs) return;
  let p = prefs.getAll();
  const now = new Date();
  if (p.notifications.dndUntil && now.getTime() >= p.notifications.dndUntil) {
    prefs.setNotifications({ ...p.notifications, dndUntil: undefined });
    p = prefs.getAll();
    pushPrefs();
    refreshTray();
  }
  for (const profile of profiles) {
    for (const surface of SURFACES) {
      manager?.pushNotifyAllowed(keyOf(profile), surface, {
        show: notificationsAllowed(p, profile.email, now, surface, coverage.has(profile.email)),
        silent: notificationSilent(p, profile.email, surface),
      });
    }
  }
}

function reportApiUnread(email: string, count: number | null): void {
  if (count === null) return;
  if (!coverage.has(email)) return;
  const profile = profiles.find((p) => p.email === email);
  if (!profile) return;
  unread.report(keyOf(profile), count);
  pushUnread();
  refreshBadge();
}

function startNotifyTimer(): void {
  if (notifyTimer) return;
  notifyTimer = setInterval(refreshNotifyAllowed, 60_000);
}

const warmup = new WarmupTracker();
let warmupTimer: ReturnType<typeof setInterval> | null = null;

function warmAccount(profile: Profile): void {
  if (!manager) return;
  const key = keyOf(profile);
  if (manager.isShowing(key, 'mail')) return;
  if (!warmup.begin(key, Date.now())) return;
  manager.warm(profile.ref, 'mail');
  if (!warmupTimer) warmupTimer = setInterval(tickWarmup, 1000);
}

function tickWarmup(): void {
  const now = Date.now();
  for (const key of warmup.pending()) {
    if (warmup.verdict(key, manager?.titleOf(key, 'mail') ?? null, now) !== 'cool') continue;
    manager?.cool(key, 'mail');
    warmup.finish(key);
  }
  if (warmup.pending().length === 0 && warmupTimer) {
    clearInterval(warmupTimer);
    warmupTimer = null;
  }
}

function syncCalendarViews(): void {
  if (!prefs || !manager) return;
  for (const profile of profiles) {
    const enabled = wantsCalendarView(prefs.getAll(), profile.email, profile.ref);
    if (enabled) {
      manager.ensureView(profile.ref, 'calendar', false);
    } else if (!manager.isShowing(keyOf(profile), 'calendar')) {
      manager.discardView(keyOf(profile), 'calendar');
    }
  }
  refreshNotifyAllowed();
}

function mailDropFolder(): string {
  return prefs?.getAll().mailDrop.folder || join(app.getPath('documents'), 'Gmail Desktop', 'Mail');
}

async function saveOneThread(
  ts: string,
  account: string,
  root: string,
  threadId: string,
  authuser: string,
  ik: string,
): Promise<{ count: number; total: number; error?: string; saved: SavedRef[] }> {
  const failed = (error: string, total = 0) => {
    try {
      appendLog(root, [{ ts, account, threadId, error }]);
    } catch {
    }
    return { count: 0, total, error, saved: [] };
  };

  let result;
  try {
    result = await fetchThreadEmls(session.fromPartition('persist:google'), { threadId, authuser, ik });
  } catch (e) {
    return failed(`Ophalen mislukt (${(e as Error).message})`);
  }
  const fetched = result.messages;
  if (fetched.length === 0) {
    const uitleg = htmlToText(result.page.html).replace(/\s+/g, ' ').trim();
    const kortEnDuidelijk = uitleg.length > 0 && uitleg.length <= 300;
    if (!kortEnDuidelijk) {
      const dump = join(root, `diagnose-om-${threadId}.html`);
      try {
        mkdirSync(root, { recursive: true });
        writeFileSync(dump, result.page.html, 'utf8');
      } catch {
      }
      return failed(
        `Geen origineel gevonden (HTTP ${result.page.status}, ${result.page.html.length} tekens — pagina bewaard als ${dump})`,
      );
    }
    return failed(`Gmail: ${uitleg}`);
  }

  const ok: SavedMessage[] = [];
  const failedRecords: LogRecord[] = [];
  for (const f of fetched) {
    if (f.raw) ok.push({ raw: f.raw, headers: parseHeaders(f.raw.toString('utf8')) });
    else failedRecords.push({ ts, account, threadId, error: f.error ?? 'onbekende fout' });
  }
  if (ok.length === 0) return failed(fetched[0]?.error ?? 'Geen bericht opgehaald', fetched.length);

  let files: string[];
  try {
    files = writeThread(root, ts, ok);
  } catch {
    return failed(`Kan niet schrijven naar ${root}`, fetched.length);
  }

  const records: LogRecord[] = ok.map((m, i) => ({
    ts,
    account,
    threadId,
    messageId: m.headers.messageId,
    from: m.headers.from,
    to: m.headers.to,
    cc: m.headers.cc,
    subject: m.headers.subject,
    date: m.headers.date,
    file: files[i],
    bytes: m.raw.length,
    body: extractPlainText(m.raw.toString('utf8')),
  }));
  try {
    appendLog(root, [...records, ...failedRecords]);
  } catch {
  }
  return {
    count: ok.length,
    total: fetched.length,
    saved: savedRefs(root, files, ok),
  };
}

function savedRefs(root: string, files: string[], messages: SavedMessage[]): SavedRef[] {
  return messages.map((m, i) => ({
    file: join(root, files[i]),
    messageId: m.headers.messageId,
    subject: m.headers.subject || NO_SUBJECT,
  }));
}

const DUPLICATE_CHECK_LIMIT = 8;

async function findDuplicates(
  cfg: OAuthConfig,
  targets: MailDropCopyTarget[],
  saved: SavedRef[],
  onProgress: (done: number, total: number, email: string) => void,
): Promise<DuplicateHit[]> {
  if (!oauthTokens) return [];
  const tokens = new Map<string, string>();
  for (const t of targets) {
    const token = await accessTokenFor(cfg, oauthTokens, t.email);
    if (token) tokens.set(t.email, token);
  }

  const checks: Array<{ email: string; labelId: string; ref: SavedRef }> = [];
  for (const t of targets) {
    if (!tokens.has(t.email)) continue;
    for (const labelId of t.labelIds) {
      for (const ref of saved) if (ref.messageId.trim()) checks.push({ email: t.email, labelId, ref });
    }
  }

  let done = 0;
  const hits = await mapLimit(checks, DUPLICATE_CHECK_LIMIT, async (c) => {
    let exists = false;
    try {
      exists = await messageExistsInLabel(tokens.get(c.email)!, c.ref.messageId, c.labelId);
    } catch {
    }
    onProgress((done += 1), checks.length, c.email);
    return exists
      ? {
          email: c.email,
          labelId: c.labelId,
          messageId: c.ref.messageId,
          subject: c.ref.subject,
        }
      : null;
  });
  return hits.filter((h) => h !== null);
}

let lastScan: { key: string; hits: DuplicateHit[] } | null = null;
let dropSerial = 0;

function scanKey(targets: MailDropCopyTarget[]): string {
  return `${dropSerial}|${JSON.stringify(targets)}`;
}

function openDropPreview(items: MailDropPreviewItem[]): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!dropOverlay) {
    dropOverlay = new OverlayView(
      mainWindow,
      SIDEBAR_PRELOAD_PATH,
      DEV_URL ? `${DEV_URL}/maildrop` : 'app://bundle/maildrop.html',
      IPC.MAIL_DROP_PREVIEW,
    );
  }
  lastDropPreview = items;
  dropOverlay.open({ items });
}

function oauthConfig(): OAuthConfig | null {
  try {
    const raw = JSON.parse(readFileSync(OAUTH_CONFIG_PATH, 'utf8'));
    if (typeof raw?.clientId === 'string' && typeof raw?.clientSecret === 'string') {
      return { clientId: raw.clientId, clientSecret: raw.clientSecret };
    }
  } catch {
  }
  return null;
}

function pushConfig(): PushConfig | null {
  try {
    return parsePushConfig(JSON.parse(readFileSync(OAUTH_CONFIG_PATH, 'utf8')), process.env);
  } catch {
    return parsePushConfig(null, process.env);
  }
}

let healthTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleOAuthHealthCheck(): void {
  if (healthTimer) clearTimeout(healthTimer);
  healthTimer = setTimeout(() => void checkOAuthHealth(), 1500);
}

const refreshFailures = new Set<string>();

const pushRefusals = new Set<string>();

async function checkOAuthHealth(): Promise<void> {
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens || !mainWindow || mainWindow.isDestroyed()) return;

  const ownEmails = profiles.filter((p) => p.kind === 'authuser').map((p) => p.email);
  for (const email of ownEmails) {
    const token = oauthTokens.get(email);
    if (!token) continue;
    const fresh = await accessTokenFor(cfg, oauthTokens, email);
    if (fresh) refreshFailures.delete(email);
    else refreshFailures.add(email);
  }

  const needing = accountsNeedingReconnect({
    ownEmails,
    hasToken: (e) => oauthTokens!.get(e) !== undefined,
    refreshFailed: (e) => refreshFailures.has(e),
    pushConfigured: pushConfig() !== null,
    missingScopes: (e) => {
      const token = oauthTokens!.get(e);
      return token !== undefined && !hasScopes(token);
    },
    pushRefused: (e) => pushRefusals.has(e),
  });
  showReconnectBanner(needing);
}

function showReconnectBanner(accounts: ReconnectAccount[]): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (accounts.length === 0) {
    reconnectBanner?.close();
    reconnectAccounts = [];
    return;
  }
  reconnectAccounts = accounts;
  if (!reconnectBanner) {
    reconnectBanner = new OverlayView(
      mainWindow,
      SIDEBAR_PRELOAD_PATH,
      DEV_URL ? `${DEV_URL}/reconnect` : 'app://bundle/reconnect.html',
      IPC.OAUTH_RECONNECT_LIST,
      bannerBounds,
    );
  }
  if (reconnectBanner.isOpen()) reconnectBanner.update({ accounts }, accounts.length);
  else reconnectBanner.open({ accounts }, accounts.length);
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function collectLabelThreads(
  ref: AccountRef,
  authuser: string,
  label: string,
): Promise<{ threads: LabelThread[]; capped: boolean }> {
  const threads: LabelThread[] = [];
  let capped = false;
  if (!manager) return { threads, capped };

  await manager.withHiddenView(labelListUrl(authuser, label, 1), async (wc) => {
    let firstOfPrevious = '';
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (page > 1) {
        const hash = new URL(labelListUrl(authuser, label, page)).hash;
        await wc.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`).catch(() => null);
      }
      let pageThreads: LabelThread[] = [];
      for (let tries = 0; tries < 25; tries++) {
        await delay(400);
        pageThreads = (await wc.executeJavaScript(LABEL_SCRAPE_JS).catch(() => [])) as LabelThread[];
        if (pageThreads.length > 0 && pageThreads[0].threadId !== firstOfPrevious) break;
      }
      if (pageThreads.length === 0) break;
      firstOfPrevious = pageThreads[0].threadId;

      const { added, total } = mergeThreads(threads, pageThreads);
      if (total >= MAX_THREADS) {
        capped = pageThreads.length >= PAGE_SIZE;
        break;
      }
      if (added === 0) break;
    }
  });
  return { threads, capped };
}

interface CollectedThread {
  thread: LabelThread;
  messages: SavedMessage[];
  error?: string;
}

const THREAD_FETCH_LIMIT = 5;

async function collectLabelViaApi(
  account: string,
  label: string,
): Promise<{ collected: CollectedThread[]; capped: boolean } | null> {
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens || !account) return null;
  const first = await accessTokenFor(cfg, oauthTokens, account);
  if (!first) return null;
  let token: string = first;

  let mayRefresh = true;
  const refreshed = async (e: unknown): Promise<boolean> => {
    if (!mayRefresh || !(e instanceof GmailHttpError) || e.status !== 401) return false;
    mayRefresh = false;
    const fresh = await forceRefresh(cfg, oauthTokens!, account);
    if (!fresh) {
      refreshFailures.add(account);
      scheduleOAuthHealthCheck();
      return false;
    }
    token = fresh;
    refreshFailures.delete(account);
    return true;
  };

  let list: { threadIds: string[]; capped: boolean };
  try {
    let labelId = await fetchLabelId(token, label).catch(async (e) => {
      if (!(await refreshed(e))) throw e;
      return fetchLabelId(token, label);
    });
    if (!labelId) return null;
    list = await listLabelThreadIds(token, labelId, MAX_THREADS);
  } catch {
    return null;
  }

  const collected = await mapLimit(list.threadIds, THREAD_FETCH_LIMIT, async (threadId) => {
    const read = async (): Promise<CollectedThread> => {
      const raws = await fetchThreadRaw(token, threadId);
      const messages: SavedMessage[] = raws.map((raw) => ({
        raw,
        headers: parseHeaders(raw.toString('utf8')),
      }));
      return {
        thread: { threadId, subject: messages[0]?.headers.subject || NO_SUBJECT },
        messages,
        error: messages.length === 0 ? 'Geen bericht in dit gesprek' : undefined,
      };
    };
    try {
      return await read();
    } catch (e) {
      if (await refreshed(e)) {
        try {
          return await read();
        } catch (e2) {
          e = e2;
        }
      }
      return {
        thread: { threadId, subject: '' },
        messages: [],
        error: `Ophalen mislukt (${(e as Error).message})`,
      };
    }
  });
  return { collected, capped: list.capped };
}

async function saveLabel(
  ts: string,
  account: string,
  root: string,
  ref: AccountRef,
  label: string,
  authuser: string,
  ik: string,
): Promise<{ items: MailDropPreviewItem[]; saved: SavedRef[] }> {
  const empty = () => {
    const error = `Geen mail gevonden in label "${label}"`;
    try {
      appendLog(root, [{ ts, account, threadId: '', label, error }]);
    } catch {
    }
    return { items: [{ threadId: '', subject: label, saved: 0, error }], saved: [] };
  };

  const viaApi = await collectLabelViaApi(account, label);
  let collected: CollectedThread[];
  let capped: boolean;

  if (viaApi) {
    if (viaApi.collected.length === 0) return empty();
    collected = viaApi.collected;
    capped = viaApi.capped;
  } else {
    const scraped = await collectLabelThreads(ref, authuser, label);
    if (scraped.threads.length === 0) return empty();
    capped = scraped.capped;

    collected = [];
    for (const thread of scraped.threads) {
      try {
        const result = await fetchThreadEmls(session.fromPartition(SESSION_PARTITION), {
          threadId: thread.threadId,
          authuser,
          ik,
        });
        const messages: SavedMessage[] = [];
        for (const f of result.messages) {
          if (f.raw) messages.push({ raw: f.raw, headers: parseHeaders(f.raw.toString('utf8')) });
        }
        if (messages.length === 0) {
          const uitleg = htmlToText(result.page.html).replace(/\s+/g, ' ').trim();
          collected.push({
            thread,
            messages: [],
            error: uitleg && uitleg.length <= 300 ? `Gmail: ${uitleg}` : 'Geen origineel gevonden',
          });
        } else {
          collected.push({ thread, messages });
        }
      } catch (e) {
        collected.push({ thread, messages: [], error: `Ophalen mislukt (${(e as Error).message})` });
      }
    }
  }

  const flat = collected.flatMap((c) => c.messages);
  let files: string[] = [];
  try {
    files = writeLabel(root, ts, label, flat);
  } catch {
    const error = `Kan niet schrijven naar ${root}`;
    return {
      items: collected.map((c) => ({
        threadId: c.thread.threadId,
        subject: c.thread.subject,
        saved: 0,
        error,
      })),
      saved: [],
    };
  }

  const records: LogRecord[] = [];
  let fileIndex = 0;
  for (const c of collected) {
    if (c.messages.length === 0) {
      records.push({ ts, account, threadId: c.thread.threadId, label, error: c.error });
      continue;
    }
    for (const m of c.messages) {
      records.push({
        ts,
        account,
        threadId: c.thread.threadId,
        label,
        messageId: m.headers.messageId,
        from: m.headers.from,
        to: m.headers.to,
        cc: m.headers.cc,
        subject: m.headers.subject,
        date: m.headers.date,
        file: files[fileIndex++],
        bytes: m.raw.length,
        body: extractPlainText(m.raw.toString('utf8')),
      });
    }
  }
  if (capped) {
    records.push({
      ts,
      account,
      threadId: '',
      label,
      error: `Afgekapt op ${MAX_THREADS} gesprekken; het label bevat er meer`,
    });
  }
  try {
    appendLog(root, records);
  } catch {
  }

  const items = collected.map((c) => ({
    threadId: c.thread.threadId,
    subject: c.thread.subject,
    saved: c.messages.length,
    error: c.error,
  }));
  if (capped) {
    items.push({
      threadId: '',
      subject: `Afgekapt op ${MAX_THREADS} gesprekken`,
      saved: 0,
      error: 'Het label bevat meer mail dan in één sleep wordt opgehaald',
    });
  }
  return { items, saved: savedRefs(root, files, flat) };
}

async function handleMailDrop(acctKey: string, payload: MailDropPayload): Promise<void> {
  const ts = new Date().toISOString();
  const account = profiles.find((p) => keyOf(p) === acctKey)?.email ?? '';
  const root = mailDropFolder();
  const items = payload?.items ?? [];
  if (items.length === 0 && !payload?.label) return;
  lastDropSaved = [];
  dropSerial += 1;
  lastDropSource = account;
  if (!payload.ik) {
    const error = 'Kon Gmail-token niet lezen';
    try {
      appendLog(root, items.map(({ threadId }) => ({ ts, account, threadId, error })));
    } catch {
    }
    manager?.sendDropResult(acctKey, { ok: false, count: 0, total: 0, error });
    openDropPreview(
      items.length > 0
        ? items.map((i) => ({ ...i, saved: 0, error }))
        : [{ threadId: '', subject: payload.label ?? '', saved: 0, error }],
    );
    return;
  }

  if (payload.label) {
    const profile = profiles.find((p) => keyOf(p) === acctKey);
    if (!profile) return;
    const { items: done, saved: refs } = await saveLabel(
      ts,
      account,
      root,
      profile.ref,
      payload.label,
      payload.authuser,
      payload.ik,
    );
    lastDropSaved = refs;
    const saved = done.reduce((n, i) => n + i.saved, 0);
    manager?.sendDropResult(
      acctKey,
      saved === 0
        ? { ok: false, count: 0, total: done.length, error: done[0]?.error ?? 'Niets opgeslagen' }
        : { ok: true, count: saved, total: saved },
    );
    openDropPreview(done);
    return;
  }

  const done: MailDropPreviewItem[] = [];
  let count = 0;
  let total = 0;
  let lastError: string | undefined;
  for (const item of items) {
    const r = await saveOneThread(ts, account, root, item.threadId, payload.authuser, payload.ik);
    count += r.count;
    total += r.total;
    if (r.error) lastError = r.error;
    lastDropSaved.push(...r.saved);
    done.push({ ...item, saved: r.count, error: r.error });
  }
  manager?.sendDropResult(
    acctKey,
    count === 0
      ? { ok: false, count: 0, total, error: lastError ?? 'Niets opgeslagen' }
      : { ok: true, count, total },
  );
  openDropPreview(done);
}

function watchPreloadForReload(): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    watch(PRELOAD_PATH, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => manager?.reloadAll(), 250);
    });
  } catch {
  }
}

function activateNotification(accountKey: string, surface: Surface, threadId?: string): void {
  const idx = idxOfKey(accountKey);
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (isQuitting) return;
    detectionStarted = false;
    createWindow();
    return;
  }
  if (!profiles.some((p) => keyOf(p) === accountKey)) return;
  if (threadId && surface === 'mail') manager?.markNotificationClickHandled(accountKey, 'mail');
  const windowMode = prefs?.getAll().notificationOpen === 'window';
  if (threadId && surface === 'mail' && windowMode) {
    manager?.openMailThread(accountKey, threadId);
    void manager?.popOutThread(accountKey).then((ok) => {
      if (!ok && idx != null) openFullThreadWindow(idx, threadId);
    });
    return;
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  if (settingsPanelOpen) {
    settingsPanelOpen = false;
    mainWindow?.webContents.send(IPC.SETTINGS_FORCE_CLOSE);
  }
  if (idx != null) switchSurface(idx, surface);
  if (threadId && surface === 'mail') manager?.openMailThread(accountKey, threadId);
}

// The account fields a card needs, resolved once at show time. A toast keeps the colour
// and avatar it was raised with rather than a reference to a profile that may be removed
// while the card is still on screen.
function toastAccountFor(email: string): ToastAccount | undefined {
  const profile = profiles.find((p) => p.email === email);
  if (!profile) return undefined;
  return {
    key: keyOf(profile),
    email: profile.email,
    label: prefs?.getAccount(email).label ?? profile.name ?? email,
    color: profile.color,
    avatarUrl: profile.avatarUrl,
  };
}

// The one place a toast is raised. Falling back to a system notification when our own
// window is not there is not politeness: a bug in the stack must not mean mail arrives
// silently, and the fallback is the behaviour this feature replaced, so it is known good.
function showToast(input: ToastInput): void {
  if (toasts) {
    toasts.show(input);
    return;
  }
  if (!Notification.isSupported()) return;
  new Notification({ title: input.title, body: input.body }).show();
}

function activateToast(toast: Toast): void {
  if (toast.kind === 'mail' && toast.account) {
    activateNotification(toast.account.key, 'mail', toast.threadId);
    return;
  }
  if (toast.kind === 'update' || toast.kind === 'error') {
    openSettingsPanel();
    return;
  }
  if (toast.kind === 'download' && toast.threadId) {
    const action = downloadClickPaths.get(toast.threadId);
    downloadClickPaths.delete(toast.threadId);
    if (action === 'open-file') void shell.openPath(toast.threadId);
    else if (action === 'show-in-folder') shell.showItemInFolder(toast.threadId);
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

async function runToastAction(_toast: Toast, _action: ToastAction): Promise<void> {
  // Filled in by the archive / mark-read task.
}

function notifyNewMail(email: string, meta: MessageMeta): void {
  if (!prefs) return;
  if (!coverage.has(email)) return;
  const account = toastAccountFor(email);
  if (!account) return;
  const p = prefs.getAll();
  const now = new Date();
  if (!notificationsAllowed(p, email, now, 'mail')) return;
  const hidden = hiddenNotificationText(p);
  const L = nativeLabels(currentLocale(), p.reneMode === true);
  showToast({
    kind: 'mail',
    title: hidden.hiddenSender ?? (displayName(meta.from) || email),
    body: hidden.hiddenSubject ?? (meta.subject || L.noSubject),
    account,
    threadId: meta.threadId,
    messageId: meta.id,
    persist: notificationPersist(p, email),
  });
  if (!notificationSilent(p, email, 'mail')) playNotificationSound(p);
}

const handledCodeIds = new Set<string>();
const HANDLED_CODE_LIMIT = 500;

async function handleVerificationCode(
  email: string,
  meta: MessageMeta,
  withToken: <T>(fn: (token: string) => Promise<T>) => Promise<T>,
): Promise<void> {
  const vc = prefs?.getAll().verificationCodes;
  if (!vc?.autoCopy) return;
  if (handledCodeIds.has(meta.id)) return;
  if (!subjectSuggestsCode(meta.subject)) return;
  try {
    const raw = await withToken((token) => fetchMessageRaw(token, meta.id));
    if (!raw) return;
    const code = findVerificationCode(
      { subject: meta.subject, body: extractPlainText(raw.toString('utf8')), from: meta.from },
      vc.confidence,
    );
    if (!code) return;
    clipboard.writeText(code);
    handledCodeIds.add(meta.id);
    if (handledCodeIds.size > HANDLED_CODE_LIMIT) {
      for (const id of [...handledCodeIds].slice(0, HANDLED_CODE_LIMIT / 2)) {
        handledCodeIds.delete(id);
      }
    }
    if (vc.markRead) await withToken((token) => markMessageRead(token, meta.id));
    if (vc.deleteAfter) await withToken((token) => trashMessage(token, meta.id));
  } catch (e) {
    console.warn(`[codes] kon geen code afhandelen voor ${email}:`, e);
  }
}

function syncRunnerFor(email: string): { run(): Promise<void> } | null {
  const existing = syncRunners.get(email);
  if (existing) return existing;
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens || !history) return null;

  const withToken = async <T>(fn: (token: string) => Promise<T>): Promise<T> => {
    const token = await accessTokenFor(cfg, oauthTokens!, email);
    if (!token) throw new Error('geen token');
    try {
      return await fn(token);
    } catch (e) {
      if (!(e instanceof GmailHttpError) || e.status !== 401) throw e;
      const fresh = await forceRefresh(cfg, oauthTokens!, email);
      if (!fresh) {
        refreshFailures.add(email);
        scheduleOAuthHealthCheck();
        throw e;
      }
      refreshFailures.delete(email);
      return await fn(fresh);
    }
  };

  const runner = createSyncRunner({
    client: {
      profileHistoryId: () => withToken((t) => fetchProfileHistoryId(t)),
      historyPage: (start, pageToken) => withToken((t) => fetchHistoryPage(t, start, pageToken)),
      messageMeta: (id) => withToken((t) => fetchMessageMeta(t, id)),
      inboxUnread: () => withToken((t) => fetchInboxUnread(t)),
    },
    cursor: {
      get: () => history!.get(email),
      set: (id) => history!.set(email, id),
    },
    coveredSince: () => coverage.since(email),
    isExpiredCursor: (e) => e instanceof GmailHttpError && e.status === 404,
    onOutcome: (outcome) => {
      reportApiUnread(email, outcome.unread);
      for (const meta of outcome.notify) notifyNewMail(email, meta);
      for (const meta of outcome.notify) void handleVerificationCode(email, meta, withToken);
    },
    onError: (e) => console.warn(`[push] sync mislukte voor ${email}:`, e),
  });
  syncRunners.set(email, runner);
  return runner;
}

function pushableEmails(): string[] {
  if (!oauthTokens) return [];
  return profiles
    .filter((p) => p.kind === 'authuser')
    .map((p) => p.email)
    .filter((email) => {
      const token = oauthTokens!.get(email);
      return token !== undefined && hasScopes(token);
    });
}

function startPush(): void {
  if (pushManager) {
    pushManager.refresh();
    return;
  }
  const config = pushConfig();
  if (!config) return;
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return;

  pushManager = startPushManager({
    config,
    accounts: pushableEmails,
    accessToken: (email) => accessTokenFor(cfg, oauthTokens!, email),
    refreshToken: async (email) => {
      const fresh = await forceRefresh(cfg, oauthTokens!, email);
      if (fresh) refreshFailures.delete(email);
      else refreshFailures.add(email);
      return fresh;
    },
    armWatch: async (email) => {
      const token = await accessTokenFor(cfg, oauthTokens!, email);
      if (!token) return false;
      try {
        return (await watchMailbox(token, config.pushTopic)) !== null;
      } catch (e) {
        console.warn(`[push] watch mislukte voor ${email}:`, e);
        return false;
      }
    },
    onSync: (email) => void syncRunnerFor(email)?.run(),
    onCoverage: (email, covered) => {
      if (covered) {
        coverage.cover(email);
        if (pushRefusals.delete(email)) scheduleOAuthHealthCheck();
      } else coverage.drop(email);
      refreshNotifyAllowed();
    },
    onFatal: (email, code) => {
      console.warn(`[push] push definitief uit voor ${email} (code ${code})`);
      if (code === 4401) {
        pushRefusals.add(email);
        void checkOAuthHealth();
      }
    },
  });
}

let firstWindow = true;

function createWindow(): void {
  prefs = new PrefsStore(join(app.getPath('userData'), 'prefs.json'));
  const stored = prefs.getAll().window;
  const bounds = clampBoundsToDisplays(
    { width: stored.width, height: stored.height, x: stored.x, y: stored.y },
    screen.getAllDisplays().map((d) => ({ bounds: d.bounds })),
  );
  const frameless = supportsOverlay(process.platform)
    ? {
        titleBarStyle: 'hidden' as const,
        titleBarOverlay: overlayOptions(
          prefs.getAll().theme,
          nativeTheme.shouldUseDarkColors,
          prefs.getAll().reneMode,
        ),
      }
    : {};
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    backgroundColor: windowBackground(prefs.getAll().theme, nativeTheme.shouldUseDarkColors),
    icon: ICON_PATH,
    minWidth: prefs.getAll().appearance.restrictMinWindowSize === false ? 0 : MIN_WINDOW_WIDTH,
    minHeight: prefs.getAll().appearance.restrictMinWindowSize === false ? 0 : MIN_WINDOW_HEIGHT,
    ...frameless,
    webPreferences: { preload: SIDEBAR_PRELOAD_PATH, contextIsolation: true },
  });
  if (stored.maximized) mainWindow.maximize();
  if (firstWindow && prefs.getAll().launchMinimized) mainWindow.minimize();
  firstWindow = false;
  mainWindow.on('show', refreshBadge);
  mainWindow.on('restore', refreshBadge);
  // The user leaves for Windows Settings to pick a mail app and comes back, so re-read
  // the association on focus rather than trusting what we last showed.
  mainWindow.on('focus', () => void pushDefaultMailStatus());
  colors = new ColorStore(join(app.getPath('userData'), 'colors.json'));
  oauthTokens = new OAuthStore(join(app.getPath('userData'), 'google-tokens.json'));
  history = new HistoryStore(join(app.getPath('userData'), 'gmail-history.json'));
  removed = new RemovedStore(join(app.getPath('userData'), 'removed.json'));
  downloadHistory = new DownloadHistoryStore(join(app.getPath('userData'), 'downloads.json'));
  delegated = new DelegatedStore(join(app.getPath('userData'), 'delegated.json'));
  accountCache = new AccountCacheStore(join(app.getPath('userData'), 'accounts.json'));
  if (!accountCacheLoaded) {
    accountCacheLoaded = true;
    cachedAccounts = accountCache.list();
    seedOrder = rememberedOrder(cachedAccounts);
  }
  manager = new ProfileViewManager(
    mainWindow,
    PRELOAD_PATH,
    (accountKey, count) => {
      const email = profiles.find((p) => keyOf(p) === accountKey)?.email;
      if (email && coverage.has(email)) return;
      unread.report(accountKey, count);
      pushUnread();
      refreshBadge();
    },
    (accountKey, surface, threadId) => activateNotification(accountKey, surface, threadId),
    (accountKey, identity) => {
      const idx = idxOfKey(accountKey);
      if (idx != null) onIdentity(idx, identity);
    },
    (_accountKey, input) => handleInput(input),
    (accountKey) => {
      if (prefs?.getAll().reneMode) return RENE_ZOOM_LEVEL;
      const email = profiles.find((p) => keyOf(p) === accountKey)?.email;
      return email ? prefs!.getAccount(email).zoom ?? 0 : 0;
    },
    (accountKey) => {
      const email = profiles.find((p) => keyOf(p) === accountKey)?.email;
      return email ? notificationSilent(prefs!.getAll(), email, 'mail') : false;
    },
    () => prefs?.getAll().notificationOpen ?? 'app',
    () => (prefs?.getAll().reneMode ? RENE_ZOOM_FACTOR : 1),
    (acctKey, payload) => void handleMailDrop(acctKey, payload),
  );

  // Built with the main window because that is what decides which display the stack
  // appears on, and torn down with it: a stack floating over a closed app is nonsense.
  const toastWindow = new ToastWindow(
    SIDEBAR_PRELOAD_PATH,
    DEV_URL ? `${DEV_URL}/toasts` : 'app://bundle/toasts.html',
    () => (prefs?.getAll().reneMode ? RENE_ZOOM_FACTOR : 1),
    () => mainWindow,
    () => toasts?.markReady(),
  );
  toasts = new ToastController({
    window: toastWindow,
    locale: () => currentLocale(),
    reneMode: () => prefs?.getAll().reneMode === true,
    now: () => Date.now(),
    onActivate: (toast) => activateToast(toast),
    onActivateSummary: (accountKey) => {
      if (accountKey) activateNotification(accountKey, 'mail');
      else if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    },
    onAction: (toast, action) => void runToastAction(toast, action),
  });
  mainWindow.on('closed', () => {
    toasts?.destroy();
    toasts = null;
  });

  if (DEV_URL) void mainWindow.loadURL(DEV_URL);
  else void mainWindow.loadURL('app://bundle/');

  if (DEV_URL) watchPreloadForReload();

  setInterval(() => void checkOAuthHealth(), 5 * 60 * 1000);

  mainWindow.webContents.on('did-finish-load', () => {
    loadDelegatedProfiles();
    pushProfiles();
    pushPrefs();
    void pushDefaultMailStatus();
    if (!delegatedScanStarted) {
      delegatedScanStarted = true;
      setTimeout(() => void refreshAndSuggestDelegated(), 7000);
    }
    applyReneZoom();
    mainWindow?.webContents.send(IPC.UPDATE_STATUS, { ...lastUpdateStatus, currentVersion: app.getVersion() });
    if (!detectionStarted) {
      detectionStarted = true;
      startDetection();
    }
  });

  mainWindow.on('close', (e) => {
    if (shouldHideOnClose({ isQuitting, platform: process.platform })) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('resize', scheduleSaveBounds);
  mainWindow.on('move', scheduleSaveBounds);
  mainWindow.on('close', saveWindowBounds);
  mainWindow.on('closed', () => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    mainWindow = null;
    composePicker.settle(null);
  });
  // shouldHideOnClose turns a close into a hide unless the app is quitting, so 'closed'
  // fires only on quit; the tray toggle and the close box both end up here instead, and
  // an unanswered picker has to go with the window that its parent hid behind.
  mainWindow.on('hide', () => composePicker.settle(null));

  mainWindow.webContents.on('before-input-event', (_e, input) => {
    handleInput(input as unknown as KeyInput);
  });
}

function sendUpdate(status: Record<string, unknown>): void {
  lastUpdateStatus = { ...status, currentVersion: app.getVersion() };
  mainWindow?.webContents.send(IPC.UPDATE_STATUS, lastUpdateStatus);
  refreshTray();
  maybeShowTrayUpdatePopup();
}

function openSettingsPanel(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  settingsPanelOpen = true;
  manager?.hideAll();
  mainWindow.webContents.send(IPC.SETTINGS_FORCE_OPEN);
}

function checkForUpdateFromTray(): void {
  openSettingsPanel();
  pendingTrayUpdateCheck = true;
  checkForUpdate();
}

function maybeShowTrayUpdatePopup(): void {
  if (!pendingTrayUpdateCheck) return;
  const L = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true);
  const popup = updateCheckPopup(lastUpdateStatus as { state: string }, L);
  if (!popup) return;
  pendingTrayUpdateCheck = false;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  void dialog
    .showMessageBox(mainWindow, {
      type: 'info',
      title: 'Gmail Desktop',
      message: popup.message,
      detail: popup.detail,
      buttons: popup.buttons,
      defaultId: 0,
      cancelId: popup.buttons.length - 1,
      noLink: true,
    })
    .then((res) => {
      if (popup.downloadButtonIndex != null && res.response === popup.downloadButtonIndex) {
        downloadUpdate();
      }
    });
}

function checkForUpdate(opts?: { background?: boolean }): void {
  lastCheckBackground = opts?.background === true;
  if (!app.isPackaged) return sendUpdate({ state: 'dev' });
  sendUpdate({ state: 'checking' });
  autoUpdater
    .checkForUpdates()
    .catch((err) => sendUpdate({ state: 'error', message: String(err?.message || err) }));
}
function maybeNotifyUpdate(version: string): void {
  if (prefs?.getAll().updates.notify === false) return;
  if (
    !shouldNotifyUpdate({
      state: 'available',
      version,
      background: lastCheckBackground,
      notifiedVersion: notifiedUpdateVersion,
    })
  )
    return;
  notifiedUpdateVersion = version;
  const L = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true);
  showToast({
    kind: 'update',
    title: L.updateAvailableTitle,
    body: L.updateAvailableBody(version),
    persist: true,
  });
}
function downloadUpdate(): void {
  updateRequested = true;
  autoUpdater
    .downloadUpdate()
    .catch((err) => sendUpdate({ state: 'error', message: String(err?.message || err) }));
}
function installUpdate(): void {
  isQuitting = true;
  autoUpdater.quitAndInstall();
}
function setAutoStart(v: boolean): void {
  prefs!.setAutoStart(v);
  app.setLoginItemSettings({ openAtLogin: v });
  pushPrefs();
  refreshTray();
}
function setLaunchMinimized(v: boolean): void {
  prefs!.setLaunchMinimized(v);
  pushPrefs();
}
// Only a packaged build has an exe worth registering; in dev process.execPath is
// electron.exe, which would leave a bogus app sitting in Windows Settings.
function ensureMailClientRegistered(): Promise<void> {
  if (process.platform !== 'win32' || !app.isPackaged) return Promise.resolve();
  return registerMailClient(process.execPath);
}

// Windows picks the mailto: handler from a UserChoice hash it signs itself, so an app
// cannot make itself the default however much it would like to. Registering the
// capability and opening the page where the user picks us is the whole of what we can
// do. Other platforms still let us claim it outright.
function requestDefaultMail(): void {
  if (process.platform !== 'win32') {
    app.setAsDefaultProtocolClient('mailto');
    void pushDefaultMailStatus();
    return;
  }
  void ensureMailClientRegistered().then(() =>
    shell.openExternal(`ms-settings:defaultapps?registeredAppUser=${encodeURIComponent(MAIL_APP_NAME)}`),
  );
}
function setSnooze(minutes: number | null): void {
  if (!prefs) return;
  const n = prefs.getAll().notifications;
  if (minutes === null) prefs.setNotifications({ ...n, dnd: true, dndUntil: undefined });
  else if (minutes <= 0) prefs.setNotifications({ ...n, dnd: false, dndUntil: undefined });
  else prefs.setNotifications({ ...n, dnd: false, dndUntil: Date.now() + minutes * 60_000 });
  pushPrefs();
  refreshNotifyAllowed();
  refreshTray();
}
function clearSnooze(): void {
  setSnooze(0);
}

function openFromTrayIcon(): void {
  if (prefs?.getAll().appearance.tray.selectUnreadOnClick === true) {
    const counts = unread.snapshot();
    const target = profiles.find((p) => (counts[keyOf(p)] ?? 0) > 0);
    if (target) {
      activateNotification(keyOf(target), 'mail');
      return;
    }
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function getTrayState(): TrayState {
  const p = prefs?.getAll();
  return {
    onOpen: () => mainWindow?.show(),
    onIconClick: openFromTrayIcon,
    onQuit: () => {
      isQuitting = true;
      app.quit();
    },
    isPackaged: app.isPackaged,
    updateStatus: lastUpdateStatus as unknown as TrayUpdateStatus,
    onCheckUpdate: checkForUpdateFromTray,
    onDownloadUpdate: downloadUpdate,
    onInstallUpdate: installUpdate,
    autoStart: p?.autoStart ?? false,
    onToggleAutoStart: setAutoStart,
    dnd: p?.notifications.dnd ?? false,
    dndUntil: p?.notifications.dndUntil,
    now: Date.now(),
    onSnooze: setSnooze,
    onClearSnooze: clearSnooze,
    labels: trayLabels(currentLocale(), p?.reneMode === true),
  };
}
function refreshTray(): void {
  if (tray) updateTrayMenu(tray, getTrayState());
}

function applyTraySetting(): void {
  const want = prefs?.getAll().appearance.tray.enabled !== false;
  if (want && !tray) {
    tray = createTray(trayImage(), getTrayState());
    return;
  }
  if (!want && tray) {
    tray.destroy();
    tray = null;
  }
  if (want && tray) tray.setImage(trayImage());
}

function trayImage(): Electron.NativeImage {
  const { nativeImage } = require('electron') as typeof import('electron');
  let image = nativeImage.createFromPath(ICON_PATH);
  if (image.isEmpty()) return image;
  image = image.resize({ width: 32, height: 32 });
  const colour = prefs?.getAll().appearance.tray.color ?? 'system';
  if (colour === 'system') return image;
  const level = colour === 'light' ? 0xff : 0x00;
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  for (let i = 0; i < bitmap.length; i += 4) {
    if (bitmap[i + 3] === 0) continue;
    bitmap[i] = level;
    bitmap[i + 1] = level;
    bitmap[i + 2] = level;
  }
  return nativeImage.createFromBitmap(bitmap, { width, height });
}

function applyMinWindowSize(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const on = prefs?.getAll().appearance.restrictMinWindowSize !== false;
  mainWindow.setMinimumSize(on ? MIN_WINDOW_WIDTH : 0, on ? MIN_WINDOW_HEIGHT : 0);
  if (!on || mainWindow.isMaximized() || mainWindow.isFullScreen()) return;
  const bounds = mainWindow.getBounds();
  const grown = grownToMinimum(bounds, { width: MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT });
  if (grown.width === bounds.width && grown.height === bounds.height) return;
  mainWindow.setBounds({ ...bounds, ...grown });
}

function showTestNotification(): void {
  if (!prefs) return;
  const p = prefs.getAll();
  const hidden = hiddenNotificationText(p);
  const L = nativeLabels(currentLocale(), p.reneMode === true);
  const first = profiles[0];
  showToast({
    kind: 'test',
    title: hidden.hiddenSender ?? 'Gmail Desktop',
    body: hidden.hiddenSubject ?? L.testNotificationBody,
    ...(first ? { account: toastAccountFor(first.email) } : {}),
    persist: true,
  });
  if (p.notifications.sound !== false && p.notifications.soundName) {
    lastSoundAt = 0;
    playNotificationSound(p);
  }
}

function openSurfaceForAccount(ref: AccountRef, surface: Surface): void {
  if (surface === 'mail' || !prefs) {
    showAccount(ref, surface);
    return;
  }
  const target = googleAppTarget(surface, prefs.getAll().googleApps);
  if (target === 'in-app') {
    showAccount(ref, surface);
    return;
  }
  const url = SURFACE_CONFIG[surface].url(ref);
  if (target === 'external') {
    openExternalGuarded(url);
    const visible = activeView();
    if (!visible) showAccount(ref, 'mail');
    return;
  }
  openGoogleAppWindow(url, ref, surface);
}

function openGoogleAppWindow(url: string, ref: AccountRef, surface: Surface): void {
  const email = profiles.find((p) => accountKey(p.ref) === accountKey(ref))?.email ?? '';
  const account = email ? prefs?.getAccount(email) : undefined;
  const g = prefs?.getAll().googleApps;
  const label = (account?.label || email || '').trim();
  const showLabel = g?.showAccountLabel !== false && profiles.length > 1 && label;
  const title = showLabel
    ? `${SURFACE_CONFIG[surface].label} — ${label}`
    : SURFACE_CONFIG[surface].label;
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    title,
    backgroundColor:
      g?.showAccountColor !== false && profiles.find((p) => p.email === email)?.color
        ? profiles.find((p) => p.email === email)!.color
        : '#ffffff',
    webPreferences: { partition: 'persist:google', contextIsolation: true },
  });
  win.on('page-title-updated', (e) => {
    if (showLabel) e.preventDefault();
  });
  attachExternalLinkHandling(win.webContents);
  void win.loadURL(url);
}

function openComposeWindow(index: number, fields?: MailtoFields): void {
  const title = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true).composeTitle;
  openCompose(index, title, fields);
}

function openExternalGuarded(url: string): void {
  const p = prefs?.getAll();
  if (!p || !needsLinkConfirm(url, p.phishing)) {
    void shell.openExternal(url);
    return;
  }
  // Ask about, show and trust where the link really goes, not the google.com/url
  // wrapper Gmail puts around it. The browser still gets the URL as Gmail handed it
  // over; that wrapper redirects to the very host the user just approved.
  const target = unwrapRedirect(url);
  const host = hostOf(target) ?? target;
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const shown = target.length > 200 ? `${target.slice(0, 200)}…` : target;
  const L = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true);
  const box = {
    type: 'question' as const,
    noLink: true,
    buttons: [L.linkOpenButton, L.cancel],
    defaultId: 1,
    cancelId: 1,
    message: L.linkMessage(host),
    detail: L.linkDetail(shown),
    checkboxLabel: L.linkAlwaysAllow(host),
    checkboxChecked: false,
  };
  const done = (res: { response: number; checkboxChecked: boolean }) => {
    if (res.response !== 0) return;
    if (res.checkboxChecked && prefs) {
      const current = prefs.getAll().phishing.trustedHosts;
      prefs.setPhishing({ trustedHosts: [...current, host] });
      pushPrefs();
    }
    void shell.openExternal(url);
  };
  if (parent) void dialog.showMessageBox(parent, box).then(done);
  else void dialog.showMessageBox(box).then(done);
}

function knownDownloadPath(path: string): boolean {
  return downloadHistory?.all().some((r) => r.path === path) === true;
}

function downloadFolder(): string {
  const chosen = prefs?.getAll().downloads.folder?.trim();
  return chosen || app.getPath('downloads');
}

const sessions = new Set<Electron.Session>();

function attachSessionHandlers(s: Electron.Session): void {
  if (sessions.has(s)) return;
  sessions.add(s);
  applySpellcheckTo(s);
  s.on('will-download', (_e, item) => {
    const d = prefs?.getAll().downloads;
    if (!d) return;
    if (!d.saveAsDialog) {
      const dir = downloadFolder();
      try {
        mkdirSync(dir, { recursive: true });
        const name = uniqueFileName(item.getFilename(), (c) => existsSync(join(dir, c)));
        item.setSavePath(join(dir, name));
      } catch {
      }
    }
    item.once('done', (_ev, state) => {
      const path = item.getSavePath();
      const started = item.getStartTime();
      downloadHistory?.add({
        filename: item.getFilename(),
        path,
        url: item.getURL(),
        bytes: item.getReceivedBytes() || item.getTotalBytes(),
        startedAt: started > 0 ? Math.round(started * 1000) : Date.now(),
        state,
      });
      mainWindow?.webContents.send(IPC.DOWNLOAD_HISTORY_CHANGED);
      if (state === 'completed' && d.openFolderWhenDone && path) shell.showItemInFolder(path);
      if (d.notify) notifyDownloadDone(item.getFilename(), path, state, d.notifyClick);
    });
  });
}

// A download card carries its path in threadId — the only field on a Toast that is a free
// string, and reusing it beats widening the type for one kind. The action is remembered
// here rather than on the card, so a preference changed between download and click is the
// one that applies.
const downloadClickPaths = new Map<string, DownloadClickAction>();

function notifyDownloadDone(
  filename: string,
  path: string,
  state: 'completed' | 'cancelled' | 'interrupted',
  onClick: DownloadClickAction,
): void {
  const done = state === 'completed';
  const L = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true);
  if (done && path && onClick !== 'nothing') downloadClickPaths.set(path, onClick);
  showToast({
    kind: 'download',
    title: done ? L.downloadCompleteTitle : state === 'cancelled' ? L.downloadCancelledTitle : L.downloadFailedTitle,
    body: filename,
    ...(done && path && onClick !== 'nothing' ? { threadId: path } : {}),
    persist: true,
  });
}

// The spellchecker follows the system language and nothing else - there is no setting
// for it. Setting it explicitly rather than leaving it to Electron matters: its default
// is en-US, which would underline every Dutch word in a compose window.
function spellcheckLanguagesFor(s: Electron.Session): string[] {
  const available = s.availableSpellCheckerLanguages;
  const locale = app.getLocale();
  const prefix = locale.split('-')[0]?.toLowerCase() ?? '';
  const system =
    available.find((c) => c.toLowerCase() === locale.toLowerCase()) ??
    available.find((c) => c.toLowerCase() === prefix) ??
    available.find((c) => c.toLowerCase().startsWith(`${prefix}-`));
  return system ? [system] : [];
}

function applySpellcheckTo(s: Electron.Session): void {
  try {
    s.setSpellCheckerLanguages(spellcheckLanguagesFor(s));
  } catch {
  }
}

let updateTimer: ReturnType<typeof setInterval> | null = null;

function applyAutoUpdateCheck(): void {
  const on = app.isPackaged && prefs?.getAll().updates.autoCheck !== false;
  if (on && !updateTimer) {
    checkForUpdate({ background: true });
    updateTimer = setInterval(() => checkForUpdate({ background: true }), 30 * 60_000);
    return;
  }
  if (!on && updateTimer) {
    clearInterval(updateTimer);
    updateTimer = null;
  }
}

function setupUpdater(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => {
    sendUpdate({ state: 'available', version: info.version });
    maybeNotifyUpdate(info.version);
  });
  autoUpdater.on('update-not-available', (info) => sendUpdate({ state: 'not-available', version: info.version }));
  autoUpdater.on('error', (err) => sendUpdate({ state: 'error', message: String(err?.message || err) }));
  autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => {
    sendUpdate({ state: 'downloaded', version: info.version });
    if (updateRequested) {
      isQuitting = true;
      autoUpdater.quitAndInstall();
    }
  });
}

function setupNotifications(): void {
  if (process.platform === 'win32') app.setAppUserModelId('com.gmaildesktop.app');
  const ses = session.fromPartition(SESSION_PARTITION);
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(true));
  ses.setPermissionCheckHandler(() => true);
}

function registerIpc(): void {
  ipcMain.on(IPC.SWITCH_SURFACE, (_e, arg: { key: string; surface: Surface }) => {
    const p = profiles.find((x) => keyOf(x) === arg.key);
    if (!p) return;
    openSurfaceForAccount(p.ref, arg.surface);
  });
  ipcMain.on(IPC.REDETECT, () => redetect());
  ipcMain.on(IPC.ADD_ACCOUNT, () => addAccount());
  ipcMain.on(IPC.ADD_DELEGATED, () => {
    const before = activeView();
    manager?.show(authRef(0), 'mail');
    void scanDelegatedSuggestions().then((s) => {
      if (before && !settingsPanelOpen && manager?.isShowing(keyOfIndex(0), 'mail')) {
        showAccount(before.ref, before.surface);
      }
      pushDelegatedSuggestions(s);
    });
  });
  ipcMain.on(IPC.ADD_DELEGATED_SUGGESTION, (_e, arg: { email: string; mailUrl: string }) =>
    addDelegatedMailbox(arg.email, arg.mailUrl),
  );
  ipcMain.on(IPC.SET_COLOR, (_e, arg: { email: string; color: string }) => {
    colors!.set(arg.email, arg.color);
    const p = profiles.find((x) => x.email === arg.email);
    if (p) p.color = arg.color;
    pushProfiles();
  });
  ipcMain.on(IPC.REMOVE_ACCOUNT, (_e, arg: { email: string }) => removeAccount(arg.email));
  ipcMain.on(IPC.UPDATE_CHECK, () => checkForUpdate());
  ipcMain.on(IPC.UPDATE_DOWNLOAD, () => downloadUpdate());
  ipcMain.on(IPC.UPDATE_INSTALL, () => installUpdate());
  ipcMain.on(IPC.SETTINGS_TOGGLE, (_e, arg: { open: boolean }) => {
    settingsPanelOpen = arg.open;
    if (arg.open) manager?.hideAll();
    else manager?.showActive();
  });
  ipcMain.handle(IPC.MENU_POPUP, (e, items: NativeMenuItem[]) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return null;
    return popupNativeMenu(win, items);
  });
  ipcMain.on(IPC.SET_AUTO_START, (_e, v: boolean) => setAutoStart(v));
  ipcMain.on(IPC.SET_LAUNCH_MINIMIZED, (_e, v: boolean) => setLaunchMinimized(v));
  ipcMain.on(IPC.SET_APPEARANCE, (_e, patch: AppearancePatch) => {
    if (!prefs) return;
    prefs.setAppearance(patch ?? {});
    if (patch?.tray?.enabled !== undefined || patch?.tray?.color !== undefined) applyTraySetting();
    if (patch?.restrictMinWindowSize !== undefined) applyMinWindowSize();
    if (patch?.showUnreadBadges !== undefined) {
      refreshBadge();
      pushUnread();
    }
    pushPrefs();
  });
  ipcMain.on(IPC.SET_DOWNLOAD_PREFS, (_e, patch: unknown) => {
    if (!prefs) return;
    prefs.setDownloads((patch ?? {}) as Parameters<PrefsStore['setDownloads']>[0]);
    pushPrefs();
  });
  ipcMain.on(IPC.SET_PHISHING, (_e, patch: unknown) => {
    if (!prefs) return;
    prefs.setPhishing((patch ?? {}) as Parameters<PrefsStore['setPhishing']>[0]);
    pushPrefs();
  });
  ipcMain.on(IPC.SET_UPDATE_PREFS, (_e, patch: unknown) => {
    if (!prefs) return;
    prefs.setUpdates((patch ?? {}) as Parameters<PrefsStore['setUpdates']>[0]);
    applyAutoUpdateCheck();
    pushPrefs();
  });
  ipcMain.on(IPC.SET_ADVANCED, (_e, patch: unknown) => {
    if (!prefs) return;
    prefs.setAdvanced((patch ?? {}) as Parameters<PrefsStore['setAdvanced']>[0]);
    pushPrefs();
  });
  ipcMain.on(IPC.SET_NOTIFICATION_EXTRAS, (_e, patch: unknown) => {
    if (!prefs) return;
    prefs.setNotificationExtras((patch ?? {}) as Parameters<PrefsStore['setNotificationExtras']>[0]);
    refreshNotifyAllowed();
    pushPrefs();
  });
  ipcMain.on(IPC.SET_VERIFICATION_CODES, (_e, patch: unknown) => {
    if (!prefs) return;
    prefs.setVerificationCodes((patch ?? {}) as Parameters<PrefsStore['setVerificationCodes']>[0]);
    pushPrefs();
  });
  ipcMain.on(IPC.SET_GOOGLE_APPS, (_e, patch: unknown) => {
    if (!prefs) return;
    prefs.setGoogleApps((patch ?? {}) as Parameters<PrefsStore['setGoogleApps']>[0]);
    pushPrefs();
  });
  ipcMain.on(IPC.NOTIFY_TEST, () => showTestNotification());
  ipcMain.on(IPC.TOAST_SIZE, (_e, size: { width: number; height: number }) =>
    toasts?.applySize(size.width, size.height),
  );
  ipcMain.on(IPC.TOAST_ACTIVATE, (_e, id: string) =>
    id === 'summary' ? toasts?.activateSummary() : toasts?.activate(id),
  );
  ipcMain.on(IPC.TOAST_DISMISS, (_e, id: string) => toasts?.dismiss(id));
  ipcMain.on(IPC.TOAST_DISMISS_ALL, () => toasts?.dismissAll());
  ipcMain.on(IPC.TOAST_ACTION, (_e, arg: { id: string; action: ToastAction }) =>
    toasts?.runAction(arg.id, arg.action),
  );
  ipcMain.on(IPC.TOAST_HOVER, (_e, hovered: boolean) => toasts?.setHovered(Boolean(hovered)));
  ipcMain.handle(IPC.DOWNLOAD_FOLDER_PICK, async () => {
    const current = downloadFolder();
    const res = await dialog.showOpenDialog({
      title: 'Downloads',
      defaultPath: current,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return current;
    prefs?.setDownloads({ folder: res.filePaths[0] });
    pushPrefs();
    return res.filePaths[0];
  });
  ipcMain.handle(IPC.DOWNLOAD_HISTORY_GET, () => downloadHistory?.all() ?? []);
  ipcMain.on(IPC.DOWNLOAD_HISTORY_CLEAR, () => {
    downloadHistory?.clear();
    mainWindow?.webContents.send(IPC.DOWNLOAD_HISTORY_CHANGED);
  });
  ipcMain.on(IPC.DOWNLOAD_HISTORY_REVEAL, (_e, path: unknown) => {
    if (typeof path === 'string' && knownDownloadPath(path)) shell.showItemInFolder(path);
  });
  ipcMain.on(IPC.DOWNLOAD_HISTORY_OPEN, (_e, path: unknown) => {
    if (typeof path === 'string' && knownDownloadPath(path)) void shell.openPath(path);
  });
  ipcMain.on(IPC.SET_DEFAULT_MAIL, () => requestDefaultMail());
  ipcMain.handle(IPC.MAIL_DROP_PREVIEW_GET, () => ({ items: lastDropPreview }));
  ipcMain.on(IPC.MAIL_DROP_PREVIEW_CLOSE, () => {
    dropOverlay?.close();
  });
  ipcMain.handle(IPC.LABELS_GET, async () => {
    const cfg = oauthConfig();
    const own = profiles.filter(
      (p) => p.kind === 'authuser' && (!lastDropSource || p.email !== lastDropSource),
    );
    if (!cfg || !oauthTokens) {
      return { accounts: own.map((p) => ({ email: p.email, labels: [], error: 'Niet gekoppeld' })) };
    }
    const accounts: AccountLabels[] = [];
    for (const p of own) {
      const token = await accessTokenFor(cfg, oauthTokens, p.email);
      if (!token) {
        accounts.push({ email: p.email, labels: [], error: 'Verbinding verlopen' });
        continue;
      }
      try {
        accounts.push({ email: p.email, labels: await fetchLabels(token) });
      } catch (e) {
        const unauthorized = e instanceof GmailHttpError && e.status === 401;
        const fresh = unauthorized ? await forceRefresh(cfg, oauthTokens, p.email) : null;
        if (fresh) {
          try {
            accounts.push({ email: p.email, labels: await fetchLabels(fresh) });
            refreshFailures.delete(p.email);
            continue;
          } catch (e2) {
            accounts.push({ email: p.email, labels: [], error: (e2 as Error).message });
            continue;
          }
        }
        if (unauthorized) {
          refreshFailures.add(p.email);
          scheduleOAuthHealthCheck();
          accounts.push({ email: p.email, labels: [], error: 'Verbinding verlopen' });
        } else {
          accounts.push({ email: p.email, labels: [], error: (e as Error).message });
        }
      }
    }
    return { accounts };
  });
  ipcMain.handle(
    IPC.MAIL_DROP_COPY,
    async (_e, arg: { targets: MailDropCopyTarget[]; mode?: CopyMode }) => {
    const cfg = oauthConfig();
    const targets = normalizeTargets(arg?.targets ?? []);
    const mode: CopyMode = arg?.mode ?? 'check';
    const fail = (error: string): MailDropCopyResult => ({
      ok: false,
      copied: 0,
      skipped: 0,
      total: 0,
      accounts: [],
      error,
    });
    if (!cfg || !oauthTokens) return fail('Koppeling niet ingesteld');
    if (targets.length === 0) return fail('Geen label gekozen');
    const files = lastDropSaved;
    if (files.length === 0) return fail('Geen opgeslagen berichten om te kopiëren');

    const total = copyTotal(targets, files.length);
    const ts = new Date().toISOString();
    const root = mailDropFolder();
    const records: LogRecord[] = [];
    const accounts: MailDropCopyAccountResult[] = [];
    let done = 0;
    let copied = 0;
    let skipped = 0;
    const progress = (phase: 'check' | 'copy', email: string, of = total) =>
      dropOverlay?.send(IPC.MAIL_DROP_COPY_PROGRESS, { phase, done, total: of, email });

    let index = new Set<string>();
    if (mode !== 'all') {
      const key = scanKey(targets);
      const hits =
        lastScan?.key === key
          ? lastScan.hits
          : await findDuplicates(cfg, targets, files, (n, of, email) => {
              done = n;
              progress('check', email, of);
            });
      lastScan = { key, hits };
      done = 0;
      index = duplicateIndex(hits);
      if (mode === 'check' && hits.length > 0) {
        return {
          ok: false,
          copied: 0,
          skipped: 0,
          total,
          accounts: [],
          needsConfirm: true,
          duplicates: groupDuplicates(hits),
          newCount: newMessageCount(index, targets, files.map((f) => f.messageId)),
        };
      }
    }

    for (const target of targets) {
      progress('copy', target.email);
      let token = await accessTokenFor(cfg, oauthTokens, target.email);
      if (!token) {
        refreshFailures.add(target.email);
        scheduleOAuthHealthCheck();
        done += files.length;
        progress('copy', target.email);
        accounts.push({
          email: target.email,
          copied: 0,
          skipped: 0,
          total: files.length,
          error: 'Verbinding verlopen',
        });
        continue;
      }

      let ok = 0;
      let over = 0;
      let lastError: string | undefined;
      for (const { file, messageId } of files) {
        const labelIds = labelsStillNeeded(index, target.email, target.labelIds, messageId);
        if (labelIds.length === 0) {
          over += 1;
          done += 1;
          progress('copy', target.email);
          continue;
        }
        let raw: Buffer;
        try {
          raw = readFileSync(file);
        } catch {
          lastError = `Kan ${file} niet lezen`;
          records.push({ ts, account: target.email, threadId: '', file, error: lastError });
          done += 1;
          progress('copy', target.email);
          continue;
        }
        try {
          let id: string | null;
          try {
            id = await insertMessage(token, raw, labelIds);
          } catch (e) {
            if (!(e instanceof GmailHttpError) || e.status !== 401) throw e;
            const fresh = await forceRefresh(cfg, oauthTokens, target.email);
            if (!fresh) {
              refreshFailures.add(target.email);
              scheduleOAuthHealthCheck();
              throw new Error('Verbinding verlopen');
            }
            token = fresh;
            refreshFailures.delete(target.email);
            id = await insertMessage(token, raw, labelIds);
          }
          ok += 1;
          records.push({
            ts,
            account: target.email,
            threadId: id ?? '',
            file,
            bytes: raw.length,
            copy: { to: target.email, labels: labelIds, ok: true },
          });
        } catch (e) {
          lastError = (e as Error).message;
          records.push({
            ts,
            account: target.email,
            threadId: '',
            file,
            error: lastError,
            copy: { to: target.email, labels: labelIds, ok: false, error: lastError },
          });
        }
        done += 1;
        progress('copy', target.email);
      }
      copied += ok;
      skipped += over;
      accounts.push({
        email: target.email,
        copied: ok,
        skipped: over,
        total: files.length,
        error: ok + over < files.length ? (lastError ?? 'Niet alles gekopieerd') : undefined,
      });
    }

    try {
      appendLog(root, records);
    } catch {
    }
    return {
      ok: copied > 0 || skipped > 0,
      copied,
      skipped,
      total,
      accounts,
    } satisfies MailDropCopyResult;
    },
  );
  ipcMain.handle(IPC.OAUTH_RECONNECT_GET, () => ({ accounts: reconnectAccounts }));
  ipcMain.handle(IPC.OAUTH_RECONNECT, async (_e, arg: { email: string }) => {
    const cfg = oauthConfig();
    if (!cfg || !oauthTokens || !mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: 'Koppeling niet ingesteld' };
    }
    const result = await connectAccount(mainWindow, SESSION_PARTITION, cfg, oauthTokens, arg.email);
    if (!result.ok) return result;
    refreshFailures.delete(arg.email);
    pushRefusals.delete(arg.email);
    void checkOAuthHealth();
    startPush();
    return { ok: true };
  });
  ipcMain.handle(IPC.MAIL_DROP_FOLDER_GET, () => mailDropFolder());
  ipcMain.handle(IPC.MAIL_DROP_FOLDER_PICK, async () => {
    const current = mailDropFolder();
    if (!mainWindow || mainWindow.isDestroyed()) return current;
    const res = await dialog.showOpenDialog(mainWindow, {
      defaultPath: current,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return current;
    prefs?.setMailDropFolder(res.filePaths[0]);
    return res.filePaths[0];
  });
  ipcMain.on(IPC.MAIL_DROP_FOLDER_OPEN, () => {
    const dir = mailDropFolder();
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
    }
    void shell.openPath(dir);
  });
  ipcMain.on(IPC.SET_SNOOZE, (_e, minutes: number | null) => setSnooze(minutes));
  ipcMain.on(IPC.SET_ACCOUNT_PREF, (_e, arg: { email: string; label?: string; notify?: boolean; calendarNotify?: boolean; badgeCount?: boolean; notifySound?: boolean; notifyPersist?: boolean }) => {
    const patch: Record<string, unknown> = {};
    if ('label' in arg) patch.label = arg.label;
    if ('notify' in arg) patch.notify = arg.notify;
    if ('calendarNotify' in arg) patch.calendarNotify = arg.calendarNotify;
    if ('badgeCount' in arg) patch.badgeCount = arg.badgeCount;
    if ('notifySound' in arg) patch.notifySound = arg.notifySound;
    if ('notifyPersist' in arg) patch.notifyPersist = arg.notifyPersist;
    prefs!.setAccount(arg.email, patch);
    pushProfiles();
    pushPrefs();
    refreshNotifyAllowed();
    startPush();
    syncCalendarViews();
    refreshBadge();
  });
  ipcMain.on(IPC.SET_ACCOUNT_ORDER, (_e, arg: { emails: string[] }) => {
    prefs!.setOrder(arg.emails);
    pushProfiles();
  });
  ipcMain.on(
    IPC.SET_NOTIFICATIONS,
    (_e, arg: { dnd: boolean; quietHours: { enabled: boolean; start: string; end: string } }) => {
      prefs!.setNotifications(mergeNotificationsFromPanel(prefs!.getAll().notifications, arg));
      pushPrefs();
      refreshNotifyAllowed();
      refreshTray();
    },
  );
  ipcMain.on(IPC.SET_THEME, (_e, theme: 'system' | 'light' | 'dark') => {
    prefs!.setTheme(theme);
    pushPrefs();
    applyTitleBarOverlay();
  });
  ipcMain.on(IPC.SET_LANGUAGE, (_e, v: LanguagePref) => {
    if (v !== 'system' && v !== 'en' && v !== 'nl') return;
    prefs!.setLanguage(v);
    pushPrefs();
    toasts?.refresh();
  });
  ipcMain.on(IPC.SET_NOTIFICATION_OPEN, (_e, v: 'app' | 'window') => {
    prefs!.setNotificationOpen(v);
    pushPrefs();
  });
  ipcMain.on(IPC.SET_RENE_MODE, (_e, v: boolean) => {
    prefs!.setReneMode(v === true);
    applyReneZoom();
    pushPrefs();
    toasts?.refresh();
  });
  ipcMain.handle(IPC.CHANGELOG_GET, () => loadChangelog());
  // One handler for the life of the app, not `ipcMain.once` per open: a `once` listener
  // left registered by a cancelled dialog would answer the next one instead, a bug that
  // only shows up on the third mailto:.
  ipcMain.on(IPC.COMPOSE_ACCOUNT_PICK, (_e, index: number | null) => {
    composePicker.settle(typeof index === 'number' ? index : null);
  });
  // The picker measures its own card once it has laid out, because no constant over a row
  // count can know how a subject wraps or what the OS font metrics are. The window is
  // still hidden at this point, so the resize is invisible and the reveal happens here.
  ipcMain.on(IPC.COMPOSE_ACCOUNT_SIZE, (e, size: { width: number; height: number }) => {
    const win = composeAccountWindow;
    if (!win || win.isDestroyed() || e.sender !== win.webContents) return;
    if (!Number.isFinite(size?.width) || !Number.isFinite(size?.height)) return;
    const applied = resizeAndShowComposeAccountWindow(win, size.width, size.height);
    if (DEV_URL) {
      console.log(
        `[picker] measured ${size.width}x${size.height} css, setContentSize ${applied.width}x${applied.height}`,
      );
    }
  });
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    const url = extractMailtoFromArgv(argv);
    if (url) void dispatchMailto(url);
  });
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  void dispatchMailto(url);
});

app.whenReady().then(() => {
  if (!gotTheLock) return;
  Menu.setApplicationMenu(null);
  app.on('web-contents-created', (_e, wc) => {
    attachContextMenu(wc, () => {
      if (prefs?.getAll().reneMode) return LABELS_RENE;
      return currentLocale() === 'nl' ? LABELS_NL : LABELS_NORMAL;
    });
  });
  app.on('session-created', (s) => attachSessionHandlers(s));
  attachSessionHandlers(session.defaultSession);
  setExternalOpener(openExternalGuarded);
  registerAppProtocol();
  setupNotifications();
  registerIpc();
  nativeTheme.on('updated', () => applyTitleBarOverlay());
  screen.on('display-metrics-changed', () => toasts?.reposition());
  createWindow();
  // Registering every launch keeps the exe path right after an update or a move, and
  // is what makes the app show up in Windows Settings at all.
  void ensureMailClientRegistered();
  const initialMailto = extractMailtoFromArgv(process.argv);
  if (initialMailto) pendingMailto = initialMailto;
  startNotifyTimer();
  app.setLoginItemSettings({ openAtLogin: prefs!.getAll().autoStart });
  applyTraySetting();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  setupUpdater();
  applyAutoUpdateCheck();
});

app.on('window-all-closed', () => {
});
app.on('before-quit', () => {
  isQuitting = true;
  pushManager?.stop();
});

