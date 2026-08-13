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
import { dirname, join } from 'node:path';
import { readFileSync, mkdirSync, writeFileSync, watch, existsSync } from 'node:fs';
import { release } from 'node:os';
import { pathToFileURL } from 'node:url';
import type { Tray } from 'electron';
import { parseChangelog, type ChangelogVersion } from './updates/changelog';
import { ProfileViewManager, type Profile, type Surface } from './windows/profile-view-manager';
import { SURFACES, SURFACE_CONFIG, surfacesForRef } from '../renderer/lib/surfaces';
import { accountCountVisible } from '../renderer/lib/badge-visibility';
import { accountKey, parseAccountKey, type AccountRef } from './accounts/account-ref';
import { resolveLocale, type LanguagePref, type Locale } from './core/locale';
import { DelegatedStore, type StoredDelegate } from './delegation/delegated-store';
import {
  AccountCacheStore,
  seedable,
  rememberedOrder,
  type CachedAccount,
} from './accounts/account-cache';
import { SWITCHER_SCRAPE_JS, parseDelegatedEntries } from './delegation/delegation';
import { canRunDelegatedApiScan } from './delegation/delegated-discovery-gate';
import { ColorStore } from './accounts/color-store';
import { RemovedStore } from './accounts/removed-store';
import {
  PrefsStore,
  type AppearancePatch,
  type DownloadClickAction,
  type Prefs,
} from './core/prefs-store';
import { hostOf, needsLinkConfirm, unwrapRedirect } from './system/link-guard';
import { uniqueFileName } from './system/download-path';
import { clampBoundsToDisplays, grownToMinimum } from './windows/window-bounds';
import { colorForIndex } from './accounts/palette';
import { planNext } from './accounts/detection-planner';
import { WarmupTracker } from './windows/view-warmup';
import { addAccountUrl } from './gmail/google-urls';
import { popupNativeMenu } from './menus/native-menu';
import type { NativeMenuItem } from '../renderer/lib/native-menu';
import { nativeLabels } from './menus/native-labels';
import { applyBadge } from './unread/badge-controller';
import { UnreadStore } from './unread/unread-store';
import { shouldNotifyUpdate } from './updates/update-notifier';
import {
  IPC,
  type MailDropPayload,
  type MailDropPreviewItem,
  type MailDropCopyTarget,
  type MailDropCopyAccountResult,
  type MailDropCopyResult,
  type MailDropCopyDuplicate,
} from './core/ipc';
import {
  normalizeTargets,
  copyTotal,
  groupDuplicates,
  duplicateIndex,
  labelsStillNeeded,
  newMessageCount,
  type DuplicateHit,
  type CopyMode,
} from './mail/mail-copy';
import { parseHeaders, extractPlainText, htmlToText } from './mail/eml';
import { writeThread, writeLabel, appendLog, displayName, newestMessage, draggedMessage, type LogRecord, type SavedMessage } from './mail/mail-archive';
import {
  labelListUrl,
  mergeThreads,
  LABEL_SCRAPE_JS,
  MAX_PAGES,
  MAX_THREADS,
  PAGE_SIZE,
  type LabelThread,
} from './mail/label-drop';
import { fetchThreadEmls } from './mail/mail-fetch';
import { NO_SUBJECT, type MessageRef } from './mail/dropzone';
import { shouldHideOnClose, createTray, updateTrayMenu, type TrayState, type TrayUpdateStatus } from './menus/tray-controller';
import { trayLabels } from './menus/tray-labels';
import { autoUpdater } from 'electron-updater';
import { resolveShortcut, type KeyInput } from './menus/shortcuts';
import { openCompose, openFullThreadWindow } from './compose/compose-window';
import { parseMailto, extractMailtoFromArgv, type MailtoFields } from './mail/mailto';
import type { ComposeAccountAsk, ComposeAccountChoice } from '../renderer/lib/compose-account';
import {
  MAIL_APP_NAME,
  isOurProgId,
  readMailtoProgId,
  registerMailClient,
} from './system/mail-client-registration';
import { sortByOrder } from './accounts/account-order';
import {
  notificationsAllowed,
  notificationSilent,
  notificationPersist,
  wantsCalendarView,
  mergeNotificationsFromPanel,
  sessionPermissionAllowed,
} from './notify/notification-policy';
import { notifyLog, openNotifyLog } from './notify/notify-log';
import { updateCheckPopup } from './updates/update-popup';
import { UPDATE_RETRY_DELAY_MS, shouldRetryDownload } from './updates/update-retry';
import { createUpdateLog, type UpdateLogger } from './updates/update-log';
import { RENE_ZOOM_FACTOR, RENE_ZOOM_LEVEL } from './core/rene';
import { attachContextMenu, LABELS_NORMAL, LABELS_RENE, LABELS_NL } from './menus/context-menu';
import { attachExternalLinkHandling, setExternalOpener } from './system/external-links';
import { googleAppTarget } from './gmail/google-apps-open';
import { DownloadHistoryStore } from './system/download-history';
import { isDarkTheme, overlayOptions, supportsOverlay, supportsOverlayUpdate, windowBackground } from './windows/titlebar';
import { OverlayView } from './windows/overlay-view';
import { ComposePicker } from './compose/compose-picker';
import {
  openComposeAccountWindow,
  resizeAndShowComposeAccountWindow,
} from './compose/compose-account-window';
import { ToastWindow } from './toast/toast-window';
import { ToastController, type ToastInput } from './toast/toast-controller';
import { webNotifySourceKey, type Toast, type ToastAccount, type ToastAction } from '../renderer/lib/toast';
import { soundNameOrDefault } from '../renderer/lib/notification-sound';
import { APP_SCHEME, APP_SCHEME_PRIVILEGES } from './system/app-scheme';
import { checkOAuthConfigFile } from './auth/oauth-config-file';
import { chooseOAuthConfigText } from './auth/oauth-source';
import {
  cacheEntry,
  isUsable,
  requestDelegatedToken,
  shouldTryAnotherRequester,
  type CachedToken,
  type DelegatedTokenOutcome,
} from './delegation/delegated-token';
import { parseMailboxesUrl, requestDelegatedMailboxes } from './delegation/delegated-mailboxes';
import { readBundledOAuthConfig } from './auth/oauth-bundled';
import {
  accountOAuthStatuses,
  accountsNeedingReconnect,
  bannerBounds,
  type ReconnectAccount,
} from './auth/oauth-health';
import type { AccountOAuthStatus } from '../renderer/lib/oauth-status';
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
  fetchRecentInboxIds,
  fetchThreadMessages,
  type ThreadMessage,
  markMessageRead,
  archiveMessage,
  trashMessage,
} from './gmail/gmail-api';
import { pickNotifiedMessage, type NotifiedMail } from './notify/notify-match';
import { mapLimit } from './core/concurrency';
import { OAuthStore } from './auth/oauth-store';
import { connectAccount, accessTokenFor, forceRefresh } from './auth/oauth-flow';
import { hasScopes, type OAuthConfig } from './auth/google-oauth';
import { parsePushConfig, type PushConfig } from './push/push-config';
import { PushCoverage } from './push/push-coverage';
import { HistoryStore } from './gmail/history-store';
import { startPushManager } from './push/push-manager';
import { createSyncRunner } from './push/push-sync';
import { findVerificationCode, subjectSuggestsCode } from './gmail/verification-code';


//===========================
// Startup switches
//===========================

if (process.platform === 'linux' && /microsoft|WSL/i.test(release())) {
  app.disableHardwareAcceleration();
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

try {
  const early = new PrefsStore(join(app.getPath('userData'), 'prefs.json')).getAll();
  if (early.advanced.hardwareAcceleration === false) app.disableHardwareAcceleration();
} catch {
}


//===========================
// Constants
//===========================

// The floor the "do not make it too small" switch enforces. Height matters as much as
// width: the topbar is 40px (80 in Rene mode) and everything below it is the mail view,
// so without a minimum height the window can be squashed to a bare strip of chrome.
const MIN_WINDOW_WIDTH = 800;
const MIN_WINDOW_HEIGHT = 600;

const RENDERER_DIST = join(__dirname, '..', 'renderer', 'out');
const CHANGELOG_PATH = join(__dirname, '..', 'CHANGELOG.md');

const PRELOAD_PATH = join(__dirname, 'preload.js');
const SIDEBAR_PRELOAD_PATH = join(__dirname, 'sidebar-preload.js');
const ICON_PATH = join(app.getAppPath(), 'assets', 'icon.png');
const DEV_URL = process.env.ELECTRON_RENDERER_URL;
const OAUTH_CONFIG_PATH = join(app.getPath('userData'), 'google-oauth.json');

// how long an account probe waits for the page to say who it belongs to
const PROBE_TIMEOUT_MS = 16000;

/**
 * The release notes the settings panel shows
 *
 * @returns {ChangelogVersion[]} empty when the file is missing, which it is in a checkout
 *   that has never been packaged
 */
function loadChangelog(): ChangelogVersion[] {
  try {
    return parseChangelog(readFileSync(CHANGELOG_PATH, 'utf8'));
  } catch {
    return [];
  }
}


//===========================
// Module state
//===========================

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
  /** The thread this message came out of, so a copy can put its conversation back
   * together in the target mailbox. Empty when the source is not known per message. */
  threadId: string;
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
// The last statuses the health check computed, for a settings panel that opens between
// two checks. Set in the same pass as the banner's list so the two cannot describe
// different moments. A removed account lingers here until the next check, which is
// harmless: the panel matches these against the profiles it has and an entry no profile
// claims is never drawn.
let oauthStatuses: AccountOAuthStatus[] = [];
// Every overlay that has to stay above the Gmail layer, raised together whenever the
// manager attaches a view — which appends and therefore covers whatever was there.
// Closed overlays ignore the call, so this needs no bookkeeping about which is up.
function raiseOverlays(): void {
  dropOverlay?.raise();
  reconnectBanner?.raise();
}
let toasts: ToastController | null = null;
// Kept beside the controller because two callers need the window itself and not the stack
// it holds: showToast has to ask whether it still works, and the Rene toggle has to push a
// new zoom factor into it.
let toastWindow: ToastWindow | null = null;
let updateRequested = false;
let downloadAttempt = 0;
let downloadInFlight = false;
let downloadRetryTimer: ReturnType<typeof setTimeout> | null = null;
let updateLog: UpdateLogger | null = null;
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


//===========================
// App protocol
//===========================

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { ...APP_SCHEME_PRIVILEGES } },
]);

function registerAppProtocol(): void {
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    return net.fetch(pathToFileURL(join(RENDERER_DIST, rel)).toString());
  });
}


//===========================
// Accounts and profiles
//===========================

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


//===========================
// Delegated mailboxes
//===========================

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
    // A mailbox known only by address has nothing to warm — surfacesForRef says so, and
    // SURFACE_CONFIG.mail.url would throw if anything tried.
    for (const profile of fresh) {
      if (surfacesForRef(profile.ref).length > 0) warmAccount(profile);
    }
  }
}

/** One account's switcher. Defaults to the first, which is where a delegation almost always
 * shows up and is the only one the periodic refresh has ever needed to read. */
async function scanSwitcherEntries(
  acctKey: string = keyOfIndex(0),
): Promise<Array<{ email: string; mailUrl: string }>> {
  if (!manager) return [];
  const raw = await manager.scrapeSwitcher(acctKey, SWITCHER_SCRAPE_JS).catch(() => []);
  return parseDelegatedEntries(raw).map((e) => ({ email: e.email, mailUrl: e.mailUrl }));
}

let delegatedScanStarted = false;
/**
 * Re-reads the switcher to catch a rotated opaque id, so a stored mailbox keeps opening.
 *
 * This is all the switcher is for now. It used to be where delegated mailboxes were
 * *discovered* — the scan proposed addresses and the "+" menu offered them — and that is
 * gone: membership comes from Google's delegation administration through the relay, which is
 * an answer rather than a reading of someone else's markup.
 *
 * What is left cannot be moved to the API, and not for want of trying. The web view needs
 * `/mail/u/<n>/d/<opaque-id>/`; no API returns that id, it cannot be built from the address
 * (`/mail/b/<address>/` silently opens your own mailbox, which is worse than an error), and
 * it rotates, so capturing it once does not hold. Losing this would mean a delegated mailbox
 * you may use over the API and can never look at.
 */
async function refreshDelegatedUrls(): Promise<void> {
  if (!delegated || !manager) return;
  const entries = await scanSwitcherEntries();
  const stored = delegated.list();
  // Only compare against entries the switcher could plausibly still see: an API-discovered
  // mailbox (mailUrl null) inflates `stored` without ever showing up here, since this reads
  // account 0 only while the API is asked with the active account. Counting those against
  // the scrape would make this bail out forever the moment the API adds one, killing the
  // only code that ever writes a real mailUrl onto a stored entry.
  if (entries.length < stored.filter((d) => d.mailUrl !== null).length) return;
  applySwitcherUrls(entries);
}

/** Writes the URLs a scrape found onto the stored mailboxes, and tells the interface.
 *
 * Two jobs in one loop, because they are the same write. A mailbox whose opaque id rotated
 * gets its new URL; a mailbox the API discovered gets its first one, going from a row that
 * only names it to a row that opens. The views are discarded either way — they were loaded
 * from a URL that is no longer the one to use, or from no URL at all. */
function applySwitcherUrls(entries: Array<{ email: string; mailUrl: string }>): void {
  if (!delegated || !manager) return;
  const freshByEmail = new Map(entries.map((e) => [e.email.toLowerCase(), e.mailUrl]));
  let changed = false;
  for (const d of delegated.list()) {
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
}

/** Which stored mailboxes are known by address and cannot be opened yet. */
function delegatedWithoutUrl(): string[] {
  return (delegated?.list() ?? []).filter((d) => d.mailUrl === null).map((d) => d.email);
}

/**
 * Finds the web URL for mailboxes the API discovered, so the answer to "may I reach this" and
 * the answer to "where is it" do not have to come from the same place.
 *
 * That split is the point. Membership comes from Google's delegation administration, through
 * the relay; the URL comes from the switcher, which is the only place the opaque id in
 * `/mail/u/<n>/d/<id>/` exists at all — no API returns it, and it cannot be built from the
 * address. Tested rather than assumed: `/mail/b/<address>/` silently lands on your own
 * mailbox, which is worse than an error, and `/mail/u/<address>/` errors outright.
 *
 * Asked account by account and stopped the moment nothing is left, because a scrape is not
 * free: it clicks the avatar in that account's live mail view and then waits up to eight
 * seconds for Google's widget frame. Doing that for every account on every start would be
 * visible activity in service of a question that is usually already answered. Account 0
 * first, since a delegation nearly always appears there; the others only exist as a path for
 * a mailbox delegated to a second account, which the API can see and account 0's switcher
 * cannot.
 *
 * Whatever is still without a URL afterwards keeps its "open it once in Gmail" row. That is
 * the honest last resort, not the plan.
 */
async function resolveDelegatedUrls(): Promise<void> {
  if (!delegated || !manager) return;
  if (delegatedWithoutUrl().length === 0) return;
  for (const own of profiles.filter((p) => p.kind === 'authuser')) {
    applySwitcherUrls(await scanSwitcherEntries(keyOf(own)));
    const left = delegatedWithoutUrl();
    if (left.length === 0) {
      console.log('[delegated] all discovered mailboxes resolved to a url');
      return;
    }
    console.log(`[delegated] still without a url after ${own.email}: ${left.join(', ')}`);
  }
}

/** The API's half of discovery. Adds mailboxes the switcher never showed and never removes
 * one it does not mention: it cannot see an out-of-domain delegation, so its silence about a
 * mailbox is not evidence about that mailbox.
 *
 * Asked with one of the user's own accounts, active one first, exactly as a token request
 * is. The loop returns on the first requester that gets an answer, so only one person's
 * delegations are ever discovered per call — trying the rest is only for when the active
 * account itself cannot reach the relay. */
async function refreshDelegatedFromApi(opts: { asked?: boolean } = {}): Promise<void> {
  const url = delegatedMailboxesUrl();
  if (!url || !delegated) return;
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return;

  for (const requester of requestersInOrder()) {
    const token = await accessTokenFor(cfg, oauthTokens, requester.email);
    if (!token) continue;
    const res = await requestDelegatedMailboxes({ url, requesterToken: token });
    if (!res.ok) {
      console.warn(`[delegated] mailbox list via ${requester.email}: ${res.error}`);
      continue;
    }
    const known = new Set(profiles.map((p) => p.email.toLowerCase()));
    // A removal outranks a background scan and loses to an explicit one. Startup must not
    // undo a mailbox you deliberately closed, or it comes back every morning; but asking for
    // a look is the only way back in, and there is no other control that clears the flag —
    // the suggestion list that used to do it is gone along with the DOM discovery it belonged
    // to. Without this fork a removal would be permanent, which nothing in the interface says.
    const fresh = res.mailboxes.filter(
      (email) => !known.has(email) && (opts.asked === true || !removed?.has(email)),
    );
    if (fresh.length === 0) {
      if (opts.asked) console.log('[delegated] nothing to add: no delegations beyond what is here');
      return;
    }
    // Asked for, so the removal goes with it. Done before the upsert: loadDelegatedProfiles
    // consults the removed list too, and would drop the profile straight back out.
    if (opts.asked) for (const email of fresh) removed?.remove(email);
    // Plain upserts, not mergeScan: upsert is where the keep-the-url rule lives (delegated
    // store), so writing an address over a mailbox the switcher already gave a URL to is
    // harmless.
    for (const email of fresh) delegated.upsert({ email, mailUrl: null, calendarUrl: null });
    loadDelegatedProfiles();
    console.log(`[delegated] ${fresh.length} mailbox(es) via ${requester.email}`);
    // The addresses are in; now find where they live. Not awaited: discovery has already
    // done its job and the sidebar already shows the mailboxes — resolving a URL is what
    // turns a row that names one into a row that opens it, and it is allowed to take the
    // seconds a switcher scrape takes.
    void resolveDelegatedUrls();
    return;
  }
}

/** Starts the relay-based discovery scan the first time an own account exists to ask it
 * with. Called from `settleDetection()` rather than `did-finish-load`: detection runs on its
 * own schedule (more accounts, slower machine, a probe timeout) and a fixed delay picked to
 * "usually" outlast it would just move the race, not close it. Settling is the actual signal
 * that `profiles` holds whatever own accounts this process is going to find before the user
 * adds another one by hand. */
let delegatedApiScanStarted = false;
function maybeStartDelegatedApiScan(): void {
  const ownAccountCount = profiles.filter((p) => p.kind === 'authuser').length;
  if (!canRunDelegatedApiScan(ownAccountCount, delegatedApiScanStarted)) return;
  delegatedApiScanStarted = true;
  void refreshDelegatedFromApi();
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


//===========================
// Tabs, detection and cache
//===========================

interface TabRow {
  key: string;
  kind: AccountRef['kind'];
  index: number;
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
  hasCalendar: boolean;
  /** False for a mailbox the API found and nobody has opened in Gmail yet: known by address,
   * with no URL to load. The seeded rows below are false for a different reason — they have
   * no ref at all yet — and both mean "do not try to open this". */
  hasMail: boolean;
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
      hasMail: surfacesForRef(p.ref).includes('mail'),
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
      hasMail: false,
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
  maybeStartDelegatedApiScan();
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
  startMailSync();
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
      if (prefs) playNotificationSound(prefs.getAll());
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
  startMailSync();
  // profiles[0] is not necessarily openable: authIdx returns -1 for every delegated
  // profile, so a mailbox known only by address (no mailUrl yet) sorts ahead of every
  // authuser account and would otherwise be handed to showAccount, which now refuses it —
  // leaving the window showing nothing at all where a removal used to always land on
  // something. Pick the first profile that actually has a mail surface instead.
  if (wasActive) {
    const next = profiles.find((p) => surfacesForRef(p.ref).includes('mail'));
    if (next) showAccount(next.ref, 'mail');
    // Nothing left to show. Say so, or the bar keeps the tab that was just removed lit.
    else pushActive();
  }
}


//===========================
// Views and surfaces
//===========================

function showAccount(ref: AccountRef, surface: Surface): void {
  manager?.show(ref, surface);
  pushActive();
  refreshNotifyAllowed();
  flushPendingMailto();
}

/** What the window is showing, for the bar that draws the active tab.
 *
 * The bar used to decide this itself, by taking the first tab that was not provisional, and
 * that is not the same question. At startup the remembered own accounts arrive as
 * provisional tabs while a delegated mailbox arrives ready, so the bar marked the delegated
 * one active — and main, meanwhile, showed authuser 0. The result was a bar pointing at one
 * mailbox with another one's mail underneath it. */
function activeTab(): { key: string; surface: Surface } | null {
  const m = manager;
  const key = m?.activeKey();
  if (!m || !key) return null;
  // Read off the manager rather than through `profiles`: detection shows account 0 before it
  // is registered, and a tab that does not exist yet is exactly the moment this has to be
  // right — the bar will highlight the key as soon as the tab for it arrives.
  const surface = SURFACES.find((s) => m.isShowing(key, s));
  return surface ? { key, surface } : null;
}

function pushActive(): void {
  mainWindow?.webContents.send(IPC.ACTIVE_CHANGED, activeTab());
}

function activeView(): { ref: AccountRef; surface: Surface } | null {
  const m = manager;
  const key = m?.activeKey();
  if (!m || !key) return null;
  const p = profiles.find((x) => keyOf(x) === key);
  const surface = SURFACES.find((s) => m.isShowing(key, s));
  return p && surface ? { ref: p.ref, surface } : null;
}


//===========================
// Compose and mailto
//===========================

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


//===========================
// Window, zoom and shortcuts
//===========================

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
  } else if (action.type === 'reload') {
    manager?.reloadActive();
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


//===========================
// Notification gating
//===========================

const NOTIFY_HIDDEN_SENDER = 'New email';
const NOTIFY_HIDDEN_SUBJECT = 'You have new mail.';
let lastSoundAt = 0;
const SOUND_GAP_MS = 1500;
function playNotificationSound(p: Prefs): void {
  if (p.notifications.sound === false) return;
  const name = soundNameOrDefault(p.notifications.soundName);
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
      const show = notificationsAllowed(p, profile.email, now, surface, coverage.has(profile.email));
      // Only mail, and only when it changes: this runs every minute for every account and
      // every surface, and a log that repeats the same thing sixty times an hour hides the
      // line that matters. What matters is that a mail view told to keep quiet raises
      // nothing at all, which from the outside is indistinguishable from mail not arriving.
      if (surface === 'mail' && notifyAllowedLast.get(profile.email) !== show) {
        notifyAllowedLast.set(profile.email, show);
        notifyLog(
          `[notify] mail view for ${profile.email} may notify: ${show}` +
            (show ? '' : ` (dnd=${p.notifications.dnd} quiet=${p.notifications.quietHours.enabled} account=${p.accounts[profile.email]?.notify !== false} push=${coverage.has(profile.email)})`),
        );
      }
      manager?.pushNotifyAllowed(keyOf(profile), surface, {
        show,
        silent: notificationSilent(p, profile.email, surface),
      });
    }
  }
}

/** What each mail view was last told, so the line above is written on a change and not on
 * every tick of the minute timer. */
const notifyAllowedLast = new Map<string, boolean>();

/** The inbox count as the API counts it, used only for an account the relay delivers for.
 *
 * The gate looks like a leftover — push covers no account while RELAY_PUSH_ENABLED is false,
 * so this count is fetched every five minutes and dropped every time — and it stays, because
 * the two sources do not count the same mailbox. labels/INBOX/threadsUnread counts every
 * unread conversation in the inbox; the page title counts the tab Gmail is showing, which
 * with categories on is Primary alone. Letting both write would swap the badge between two
 * numbers every five minutes. The title is the one that matches what Gmail itself puts on
 * screen, so it stays the source, and preload.ts is where it was made to read the inbox
 * rather than whatever label is open. */
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


//===========================
// View warm-up
//===========================

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


//===========================
// Drag to save
//===========================

function mailDropFolder(): string {
  return prefs?.getAll().mailDrop.folder || join(app.getPath('documents'), 'Gmail Desktop', 'Mail');
}

/** What the API route has to say about a thread: the messages, the reason it could not get
 * them, or that this mailbox has no API route at all.
 *
 * Three answers where there were two, and the missing one cost a drag its mail. "No token for
 * this mailbox" and "the API refused" both used to come back as null, on the reasoning that
 * neither was worth reporting because the page route still worked. The paragraph below says
 * why that reasoning does not hold, and the two are told apart here so the caller can act on
 * the difference instead of walking into a route that cannot answer and repeating what it
 * says.
 *
 * The token comes from withMailboxToken rather than the OAuth store, so a mailbox reached by
 * delegation gets the relay's token instead of nothing. For such a mailbox this is not the
 * better of two routes but the only one: the page route needs the /d/<token>/ part of the URL,
 * which a drag does not carry, and Gmail answers the URL without it with a 403 — or, when it
 * feels like phrasing it differently, with a page saying the message cannot be found. Falling
 * back there turned an API hiccup into "Het gevraagde bericht kan niet worden gevonden", which
 * is a sentence about the user's mailbox for a problem that was never in it. */
type ApiThreadResult =
  | { kind: 'messages'; messages: ThreadMessage[] }
  | { kind: 'failed'; error: string }
  | { kind: 'no-route' };

async function threadMessagesViaApi(email: string, threadId: string): Promise<ApiThreadResult> {
  if (!email) return { kind: 'no-route' };
  const withToken = await withMailboxToken(email);
  if (!withToken) return { kind: 'no-route' };
  try {
    return { kind: 'messages', messages: await withToken((token) => fetchThreadMessages(token, threadId)) };
  } catch (e) {
    const error = (e as Error).message || 'onbekende fout';
    console.warn(`[maildrop] API-ophalen mislukte voor ${email} ${threadId}:`, e);
    return { kind: 'failed', error };
  }
}

async function saveOneThread(
  ts: string,
  account: string,
  root: string,
  threadId: string,
  authuser: string,
  ik: string,
  message: MessageRef | null = null,
): Promise<{ count: number; total: number; error?: string; saved: SavedRef[] }> {
  const failed = (error: string, total = 0) => {
    try {
      appendLog(root, [{ ts, account, threadId, error }]);
    } catch {
    }
    return { count: 0, total, error, saved: [] };
  };

  // The API first, and the page only when there is no token for this account.
  //
  // Both routes end in the same list, but they do not find the same messages. The page
  // route reads Gmail's "show original" page and can only save what that page links to,
  // and a long conversation arrives there with its older messages collapsed and their
  // links gone — so a thread of twelve becomes a copy of three that reports itself as
  // three of three, since it counts what it found rather than what exists. threads.get
  // has no opinion about rendering: it lists every message in the thread, so what is
  // missing is missing loudly.
  const viaApi = await threadMessagesViaApi(account, threadId);
  // A mailbox reached by delegation has no second route, so its API failure is the answer.
  // Trying the page anyway is what turned "de API weigerde" into Gmail's own sentence about
  // a message that cannot be found.
  if (viaApi.kind === 'failed' && isDelegatedMailbox(account)) {
    return failed(`Ophalen via de API mislukt (${viaApi.error})`);
  }
  let fetched: { raw?: Buffer; error?: string; id?: string; permMsgId?: string }[];
  let pageHtml: { html: string; status: number } | null = null;
  if (viaApi.kind === 'messages') {
    fetched = viaApi.messages.map((m) => ({ raw: m.raw, error: m.error, id: m.id }));
  } else {
    let result;
    try {
      result = await fetchThreadEmls(session.fromPartition('persist:google'), { threadId, authuser, ik });
    } catch (e) {
      return failed(`Ophalen mislukt (${(e as Error).message})`);
    }
    fetched = result.messages;
    pageHtml = result.page;
  }
  if (fetched.length === 0 && pageHtml) {
    // An own account may still be saved by the page, so it is allowed to try. When that comes
    // back empty too, the API's reason is the one to report: it is what actually went wrong,
    // and the page's explanation is about a route this mail was never going to arrive by.
    if (viaApi.kind === 'failed') {
      return failed(`Ophalen via de API mislukt (${viaApi.error})`);
    }
    const result = { page: pageHtml };
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

  const all: SavedMessage[] = [];
  const failedRecords: LogRecord[] = [];
  for (const f of fetched) {
    if (f.raw) {
      all.push({
        raw: f.raw,
        headers: parseHeaders(f.raw.toString('utf8')),
        id: f.id,
        permMsgId: f.permMsgId,
      });
    } else {
      failedRecords.push({ ts, account, threadId, error: f.error ?? 'onbekende fout' });
    }
  }
  if (all.length === 0) return failed(fetched[0]?.error ?? 'Geen bericht opgehaald', fetched.length);

  // One mail out of the conversation, not the conversation in pieces. The last message
  // quotes the ones before it, which is the whole reason a thread gets dragged: something
  // to read the exchange in. Fetching all of them was still not wasted — it is how the
  // newest one is known to be the newest, and how it is complete rather than whatever a
  // collapsed page happened to link to.
  //
  // Which message that is does depend on the drag. A row that stands for one message names
  // it, and then it is that one: the replies that came after it are what the drag is meant
  // to leave behind, and the older ones are inside it as quoted text either way.
  const dragged = draggedMessage(all, message);
  const chosen = dragged ?? newestMessage(all);
  const ok = chosen ? [chosen] : [];
  if (message && !dragged) {
    notifyLog(`[maildrop] ${threadId}: gesleept bericht niet in de conversatie gevonden`);
  }
  if (all.length > 1) {
    notifyLog(
      `[maildrop] ${threadId}: ${all.length} berichten, alleen ${dragged ? 'het gesleepte' : 'het laatste'} bewaard`,
    );
  }

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
    // One mail per drag now, so this counts what was dragged rather than messages.
    total: 1,
    saved: savedRefs(root, files, ok, threadId),
  };
}

function savedRefs(
  root: string,
  files: string[],
  messages: SavedMessage[],
  threadId: string,
): SavedRef[] {
  return messages.map((m, i) => ({
    file: join(root, files[i]),
    messageId: m.headers.messageId,
    subject: m.headers.subject || NO_SUBJECT,
    threadId,
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


//===========================
// OAuth config and tokens
//===========================

function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** The config text in force: the machine's own if it has a usable one, otherwise the copy
 * shipped in the app. Both readers below go through this so they can never disagree about
 * which project the app is talking to — the push settings live in the same file as the
 * credentials, and picking them from different sources would link accounts against one
 * project and subscribe for notifications against another. See oauth-source.ts for the
 * precedence and oauth-bundled.ts for where the shipped copy lives. */
function oauthConfigText(): string | null {
  return chooseOAuthConfigText(readIfPresent(OAUTH_CONFIG_PATH), readBundledOAuthConfig());
}

/** Whether this address is a mailbox reached by delegation rather than one of the user's own
 * accounts. Read from the profiles rather than guessed from the address, so a mailbox the
 * app does not know about is not quietly treated as delegated. */
function isDelegatedMailbox(email: string): boolean {
  const wanted = email.trim().toLowerCase();
  return profiles.some((p) => p.kind === 'delegated' && p.email.toLowerCase() === wanted);
}

/** Where to ask for a token for a mailbox nobody signed into. Absent means the relay is not
 * configured, and copying to delegated mailboxes stays off — the same optional shape push
 * config has. */
function delegatedTokenUrl(): string | null {
  const text = oauthConfigText();
  if (text === null) return null;
  try {
    const raw = JSON.parse(text) as { delegatedTokenUrl?: unknown };
    const url = typeof raw.delegatedTokenUrl === 'string' ? raw.delegatedTokenUrl.trim() : '';
    return url === '' ? null : url;
  } catch {
    return null;
  }
}

/** Where to ask which mailboxes this person may reach. Absent means discovery stays off and
 * the switcher scrape is the only source, which is what it is today.
 *
 * Environment before file, the rule push already follows (`push-config.ts:34`), and for the
 * same reason: a relay on loopback has to be testable without editing the one file that holds
 * the client secret. Read before the file is even opened, so it works on a machine that has no
 * config at all.
 *
 * An env var that is set but unusable is not quietly replaced by the file. It was set on
 * purpose; falling back would hide the mistake behind behaviour that looks like it worked,
 * which is the failure mode the whole config path is written to avoid. */
function delegatedMailboxesUrl(): string | null {
  const fromEnv = (process.env.GMAIL_DELEGATED_MAILBOXES_URL ?? '').trim();
  if (fromEnv !== '') return parseMailboxesUrl(fromEnv);
  const text = oauthConfigText();
  if (text === null) return null;
  try {
    const raw = JSON.parse(text) as { delegatedMailboxesUrl?: unknown };
    return parseMailboxesUrl(raw.delegatedMailboxesUrl);
  } catch {
    return null;
  }
}

/** Tokens the relay handed out, per mailbox. They live an hour; without this every drag
 * would cost a fresh mint and a delegates-list read per mailbox. */
const delegatedTokens = new Map<string, CachedToken>();

/** The user's own accounts, active one first: it is the one the person was looking at, and
 * usually the one whose delegation (or discoverable mailbox list) they are thinking of.
 * Shared by every caller that asks the relay something on the user's behalf, so trying the
 * same account in the same order is not reimplemented per caller. */
function requestersInOrder(): Profile[] {
  const active = manager?.activeKey();
  const own = profiles.filter((p) => p.kind === 'authuser');
  return [...own.filter((p) => keyOf(p) === active), ...own.filter((p) => keyOf(p) !== active)];
}

/** A token for a mailbox that has none of its own, via the relay.
 *
 * The user's own accounts are tried, active one first, and the first token the relay grants
 * is used. That cannot widen anyone's access: the relay checks Google's delegation record on
 * every attempt, so trying is how the app finds the access you already have rather than how
 * it gets any. It also means a copy does not fail merely because the wrong tab was in front.
 *
 * Returns null with a reason, so the caller can report something truer than "Verbinding
 * verlopen" — which is what a delegated mailbox used to get, for an expiry it never had. */
async function delegatedTokenFor(email: string): Promise<DelegatedTokenOutcome> {
  const url = delegatedTokenUrl();
  if (!url) return { ok: false, error: 'Relay voor gedelegeerde postvakken niet ingesteld' };

  const cached = delegatedTokens.get(email.toLowerCase());
  if (isUsable(cached, Date.now())) return { ok: true, token: cached!.accessToken };

  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return { ok: false, error: 'Koppeling niet ingesteld' };

  let lastError = 'Geen van je accounts heeft toegang tot dit postvak';
  for (const requester of requestersInOrder()) {
    const requesterToken = await accessTokenFor(cfg, oauthTokens, requester.email);
    if (!requesterToken) continue;
    const result = await requestDelegatedToken({ url, requesterToken, target: email });
    if (result.ok) {
      delegatedTokens.set(email.toLowerCase(), cacheEntry(result.accessToken, result.expiresIn, Date.now()));
      console.log(`[delegated] ${requester.email} -> ${email}: granted`);
      return { ok: true, token: result.accessToken };
    }
    lastError = result.error;
    // Only a delegation refusal says nothing about the next account; everything else is
    // about the request or the relay, and asking again would just repeat it.
    if (!shouldTryAnotherRequester(result.status)) break;
  }
  return { ok: false, error: lastError };
}

/** What to tell someone whose mailbox Gmail would not let a token into.
 *
 * The two kinds fail for reasons that need different actions: an own account has a link that
 * can be renewed by reconnecting, a delegated mailbox has no link of its own and its access
 * is someone else's to grant. Whatever Google's own wording was, it is not this — it names an
 * OAuth credential and links to the developer console, which is a sentence for whoever built
 * the app and not for whoever is trying to file an e-mail. */
function mailboxRefusedText(email: string): string {
  return isDelegatedMailbox(email) ? 'Geen toegang tot dit postvak' : 'Verbinding verlopen';
}

/** Drops a cached relay token, for when Gmail rejects it. A delegation can be revoked while
 * a token from it is still inside its hour, and the cache would otherwise keep handing out
 * the dead one until it expired on the clock. */
function forgetDelegatedToken(email: string): void {
  delegatedTokens.delete(email.toLowerCase());
}

/** A token for a mailbox, whichever kind it is: the user's own OAuth token, or one the relay
 * mints for a mailbox they are a delegate of. One entry point so every caller treats the two
 * the same — the label list and the copy path both used to know only about the first, which
 * is why a shared mailbox could not be picked at all. */
async function mailboxToken(email: string): Promise<DelegatedTokenOutcome> {
  if (isDelegatedMailbox(email)) return delegatedTokenFor(email);
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return { ok: false, error: 'Niet gekoppeld' };
  const token = await accessTokenFor(cfg, oauthTokens, email);
  return token ? { ok: true, token } : { ok: false, error: 'Verbinding verlopen' };
}

/** A token for a mailbox after Gmail refused the one it had, whichever kind it is.
 *
 * Recovering from a 401 differs per kind and using the wrong one is silent: a delegated
 * mailbox has no refresh token to force, and an own account has no relay entry to forget. A
 * delegation can be revoked while a token from it is still inside its hour, so the cached one
 * has to go before asking again. */
async function freshTokenAfter401(email: string): Promise<string | null> {
  if (isDelegatedMailbox(email)) {
    forgetDelegatedToken(email);
    const again = await delegatedTokenFor(email);
    return again.ok ? again.token : null;
  }
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return null;
  const fresh = await forceRefresh(cfg, oauthTokens, email);
  if (!fresh) {
    // Only an own account can have a link that expired, so only it may be flagged for one.
    refreshFailures.add(email);
    scheduleOAuthHealthCheck();
    return null;
  }
  refreshFailures.delete(email);
  return fresh;
}

/** The access-token dance for any mailbox: use the token it has, and on a 401 recover the way
 * that mailbox can and try once more. withTokenFor does the same for the user's own accounts
 * only, which is exactly what shut the API route to a shared mailbox — no OAuth token can
 * exist for a mailbox nobody signs into, so a drag out of one fell back to scraping Gmail's
 * page, and that page cannot be reached without the /d/<token>/ part of the URL a drag does
 * not carry. It came back as HTTP 403.
 *
 * Null means no token can be had at all, which tells the caller this mailbox has no API route
 * rather than that the API failed. */
async function withMailboxToken(
  email: string,
): Promise<(<T>(fn: (token: string) => Promise<T>) => Promise<T>) | null> {
  const first = await mailboxToken(email);
  if (!first.ok) return null;
  let token = first.token;
  // Once per runner, not per call: a token that is still refused after a fresh mint is refused
  // for a reason no amount of reminting changes, and a label drag is hundreds of calls.
  let mayRecover = true;
  return async <T>(fn: (token: string) => Promise<T>): Promise<T> => {
    try {
      return await fn(token);
    } catch (e) {
      if (!mayRecover || !(e instanceof GmailHttpError) || e.status !== 401) throw e;
      mayRecover = false;
      const fresh = await freshTokenAfter401(email);
      if (!fresh) throw e;
      token = fresh;
      return await fn(fresh);
    }
  };
}

function oauthConfig(): OAuthConfig | null {
  const text = oauthConfigText();
  if (text === null) return null;
  try {
    const raw = JSON.parse(text);
    if (typeof raw?.clientId === 'string' && typeof raw?.clientSecret === 'string') {
      return { clientId: raw.clientId, clientSecret: raw.clientSecret };
    }
  } catch {
  }
  return null;
}

function pushConfig(): PushConfig | null {
  const text = oauthConfigText();
  try {
    return parsePushConfig(text === null ? null : JSON.parse(text), process.env);
  } catch {
    return parsePushConfig(null, process.env);
  }
}


//===========================
// OAuth health
//===========================

let healthTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleOAuthHealthCheck(): void {
  if (healthTimer) clearTimeout(healthTimer);
  healthTimer = setTimeout(() => void checkOAuthHealth(), 1500);
}

const refreshFailures = new Set<string>();

const pushRefusals = new Set<string>();

/** The one place the panel's picture of linking is sent. Reports whether this machine can
 * link at all as well as the per-account statuses, because those are different facts and
 * an empty list is the honest answer to both "nothing is wrong" and "nothing is possible". */
function pushOAuthStatus(): void {
  mainWindow?.webContents.send(IPC.OAUTH_STATUS_CHANGED, {
    configured: oauthConfig() !== null,
    accounts: oauthStatuses,
  });
}

async function checkOAuthHealth(): Promise<void> {
  const cfg = oauthConfig();
  // Split from the guard below on purpose. A machine with no OAuth config is not a machine
  // with nothing to report — it is the one state where the panel would otherwise look
  // identical to a healthy one, which is how an install with no consent screen, no status
  // and no banner reached someone who then had to ask why.
  if (!cfg) {
    oauthStatuses = [];
    pushOAuthStatus();
    return;
  }
  if (!oauthTokens || !mainWindow || mainWindow.isDestroyed()) return;

  const ownEmails = profiles.filter((p) => p.kind === 'authuser').map((p) => p.email);
  for (const email of ownEmails) {
    const token = oauthTokens.get(email);
    if (!token) continue;
    const fresh = await accessTokenFor(cfg, oauthTokens, email);
    if (fresh) refreshFailures.delete(email);
    else refreshFailures.add(email);
  }

  // One object, handed to both functions, so the banner and the accounts panel can never
  // describe the same accounts differently. Its closures are not read once — OAuthStore.get
  // hits the filesystem on every call, and accountsNeedingReconnect below calls
  // accountOAuthStatuses again internally, so the token file is read roughly twice as often
  // per health check as a single pass would suggest. That is fine here: both passes are
  // synchronous with no `await` between them, so nothing can change underneath them, and at
  // a handful of accounts every five minutes the extra reads cost nothing worth avoiding.
  const health = {
    ownEmails,
    hasToken: (e: string) => oauthTokens!.get(e) !== undefined,
    refreshFailed: (e: string) => refreshFailures.has(e),
    pushConfigured: pushConfig() !== null,
    missingScopes: (e: string) => {
      const token = oauthTokens!.get(e);
      return token !== undefined && !hasScopes(token);
    },
    pushRefused: (e: string) => pushRefusals.has(e),
  };
  oauthStatuses = accountOAuthStatuses(health);
  pushOAuthStatus();
  showReconnectBanner(accountsNeedingReconnect(health));
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


//===========================
// Copying mail to a mailbox
//===========================

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

/** Every conversation in a label through the Gmail API, or null when this mailbox has no API
 * route to it. The token goes through withMailboxToken for the reason threadMessagesViaApi
 * carries: a mailbox reached by delegation has no OAuth token of its own, and the page route
 * this falls back to cannot reach one at all. */
async function collectLabelViaApi(
  account: string,
  label: string,
): Promise<{ collected: CollectedThread[]; capped: boolean } | null> {
  if (!account) return null;
  const withToken = await withMailboxToken(account);
  if (!withToken) return null;

  let list: { threadIds: string[]; capped: boolean };
  try {
    const labelId = await withToken((token) => fetchLabelId(token, label));
    if (!labelId) return null;
    list = await withToken((token) => listLabelThreadIds(token, labelId, MAX_THREADS));
  } catch {
    return null;
  }

  const collected = await mapLimit(list.threadIds, THREAD_FETCH_LIMIT, async (threadId) => {
    try {
      const raws = await withToken((token) => fetchThreadRaw(token, threadId));
      const messages: SavedMessage[] = raws.map((raw) => ({
        raw,
        headers: parseHeaders(raw.toString('utf8')),
      }));
      return {
        thread: { threadId, subject: messages[0]?.headers.subject || NO_SUBJECT },
        messages,
        error: messages.length === 0 ? 'Geen bericht in dit gesprek' : undefined,
      };
    } catch (e) {
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

  // Per conversation the last message, for the reason newestMessage carries: what is wanted
  // is one mail to read the exchange in. A label of forty threads becomes forty mails, not
  // four hundred.
  for (const c of collected) {
    const newest = newestMessage(c.messages);
    c.messages = newest ? [newest] : [];
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
  // Per thread rather than over the flat list: files runs across every conversation in the
  // label, and a copy has to know which messages belong together or it files each one as its
  // own thread in the target mailbox.
  const saved: SavedRef[] = [];
  let at = 0;
  for (const c of collected) {
    saved.push(...savedRefs(root, files.slice(at, at + c.messages.length), c.messages, c.thread.threadId));
    at += c.messages.length;
  }
  return { items, saved };
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
    const r = await saveOneThread(
      ts,
      account,
      root,
      item.threadId,
      payload.authuser,
      payload.ik,
      item.message ?? null,
    );
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


//===========================
// Notification cards
//===========================

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

function activateNotification(
  accountKey: string,
  surface: Surface,
  threadId?: string,
  subject?: string,
): void {
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
  // No thread id here means the lookup could not identify the mail — the view was on
  // another label, or showing a conversation, so there was no list to match the subject
  // against. The subject itself is still a lead, and Gmail's own search follows it; only
  // when there is not even that does the click settle for the account.
  notifyLog(
    `[notify] activate ${accountKey} surface=${surface} thread=${threadId ?? 'none'} subject=${JSON.stringify(subject ?? '')} mode=${windowMode ? 'window' : 'inline'}`,
  );
  // A window of its own means exactly that: popOutThread borrows the mail view to reach
  // Gmail's pop-out button and then puts it back, so the main window is not left showing
  // the message as well.
  if (threadId && surface === 'mail' && windowMode) {
    // The subject travels with it because the pop-out has to wait for Gmail to actually
    // arrive on the thread, and the title is the only place the page says it has.
    void manager?.popOutThread(accountKey, threadId, subject).then((ok) => {
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
  if (surface !== 'mail') return;
  if (threadId) manager?.openMailThread(accountKey, threadId);
  else if (subject) manager?.openMailSearch(accountKey, subject);
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

// The one place a toast is raised, and the one place that decides where it goes.
//
// The app's own stack first, always: it carries the account, honours every setting, and
// opens the mail when clicked. A stack that cannot paint is repaired rather than routed
// around — thrown away and built again, which is the only thing that has ever fixed it.
//
// The Windows shelf is what is left when that fails, and it is a poor stand-in: no
// account, no settings, dead on click. It was taken out entirely, and that was a step too
// far — a stack that could not paint then meant no notification at all, which is the one
// outcome worse than a poor one. So it is back, but only after the repair has been tried
// and refused, and it says so in the log: a system notification now means the stack is
// broken, and the lines above it in notify.log say why.
//
// A null controller happens twice in the app's life, before createWindow and after the
// main window closes; there is no stack to put a card in then and nothing to repair.
function showToast(input: ToastInput): void {
  if (!toasts) {
    notifyLog(`[toast] no stack at all to show "${input.title}" in — falling back to Windows`);
    systemNotify(input.title, input.body);
    return;
  }
  if (toastWindow?.isBroken() && !repairToastStack()) {
    notifyLog(`[toast] stack cannot be repaired — "${input.title}" goes to Windows instead`);
    systemNotify(input.title, input.body);
    return;
  }
  notifyLog(`[toast] stack draws "${input.title}"`);
  toasts.show(input);
}

// The stand-in itself. Guarded rather than trusted, because the whole reason it is here is
// that a notification must not be lost, and an unguarded throw would lose it just as
// thoroughly as the stack that failed.
function systemNotify(title: string, body: string): void {
  try {
    if (!Notification.isSupported()) return;
    new Notification({ title, body }).show();
  } catch (e) {
    notifyLog(`[toast] even the system notification failed: ${String(e)}`);
  }
}

// Called on the way into broken as well as before a raise, because the two cover different
// cards: the cards already in the stack when the page died are past showToast's fork and
// nothing would ever look at them again, and a rebuild alone would not redraw them. The
// window bounds the attempts itself — a page that is broken for a reason rebuilding it
// cannot fix must not turn every notification into a new window — and refresh() is what
// puts the queued stack in front of the window that comes back.
function repairToastStack(): boolean {
  if (!toastWindow?.rebuild()) return false;
  toasts?.refresh();
  return true;
}

// The end of the line for a stack that has given up.
//
// showToast's fork only ever redirects the *next* notification. The cards already in the
// controller when the page died are past it — they were accepted while the window still
// looked healthy, they are what the rebuild was trying to save, and once the attempts are
// spent nothing would ever look at them again. That is the silence this exists to break:
// mail arrived, the log said the stack drew it, and nothing was on screen. The controller
// hands the stack over and empties itself in one call, so a second attempt finds nothing
// and nothing is raised twice.
//
// A summary has no cards left to raise — each one was released as it was folded into the
// count — so what leaves is the count itself.
function drainToSystem(): void {
  const held = toasts?.drain();
  if (!held) return;
  for (const toast of held.toasts) {
    notifyLog(`[toast] draining "${toast.title}" to Windows — the stack cannot paint`);
    systemNotify(toast.title, toast.body);
  }
  if (!held.summary) return;
  const L = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true);
  notifyLog(`[toast] draining a summary of ${held.summary.count} to Windows`);
  systemNotify(app.getName(), L.collapsedNotifications(held.summary.count));
}

// What a card was holding while it was on screen, released when it leaves by any route
// other than a click. A click consumes them itself, in activateToast; nothing consumed
// them on the other four routes, so a dismissed relayed card left an entry in
// webNotifySources pinning a live WebContents — in a map Gmail's page can grow in a loop —
// and a dismissed download card left its path behind. Wired to the controller's onDiscard
// rather than called from each site, because the collapse into a summary is a departure no
// call site sees.
function forgetToastResources(toast: Toast): void {
  if (toast.webNotifyId) webNotifySources.delete(toast.webNotifyId);
  if (toast.kind === 'download' && toast.threadId) downloadClickPaths.delete(toast.threadId);
}

/** How much of the inbox is fetched to recognise one notification in, and how long that is
 * allowed to take before the click goes on without it. The click is a person waiting, so
 * the deadline is short and missing it is not an error: the page's own lookup is still
 * there, and it is what used to answer alone. */
const NOTIFY_LOOKUP_MESSAGES = 8;
const NOTIFY_LOOKUP_TIMEOUT_MS = 2500;

/** Resolves to `fallback` if `work` has not finished in time, and lets a rejection resolve
 * the same way: nothing here is worth failing a click over. */
function withDeadline<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    const settle = (value: T): void => {
      clearTimeout(timer);
      resolve(value);
    };
    void work.then(settle, () => settle(fallback));
  });
}

/** Which mail the notification was about, asked of the Gmail API.
 *
 * A handful of the newest inbox messages, their sender and subject, and the match made
 * against the text the notification drew. That is one list request and a few metadata ones
 * — only ever on a click, never on arrival, so mail nobody opens costs nothing.
 *
 * Delegated mailboxes have no token of their own and fall out at the first line, which is
 * correct: for those the page's DOM is the only lookup there has ever been. */
async function lookupNotifiedMessage(
  email: string,
  notified: NotifiedMail,
): Promise<MessageMeta | null> {
  const withToken = withTokenFor(email);
  if (!withToken) return null;
  try {
    const ids = await withToken((t) => fetchRecentInboxIds(t, NOTIFY_LOOKUP_MESSAGES));
    const metas = await mapLimit(ids, 4, (id) => withToken((t) => fetchMessageMeta(t, id)));
    return pickNotifiedMessage(
      metas.filter((m): m is MessageMeta => m !== null),
      notified,
    );
  } catch (e) {
    notifyLog(`[notify] api lookup failed for ${email}: ${(e as Error).message}`);
    return null;
  }
}

/** A card raised from Gmail's own notification was clicked.
 *
 * Three answers, in order of how sure each one is. The API knows exactly which mail it was
 * and hands back its thread id. Failing that the source view is asked, which matches the
 * subject against whatever rows it is rendering — a guess, and the reason this order is
 * this way round. Failing that too, the account is opened, which at least lands in the
 * right mailbox.
 *
 * The source is dropped before any of it: whichever answer wins, this card is spent, and a
 * second click cannot arrive on a card the stack has already removed. */
async function openNotifiedThread(toast: Toast): Promise<void> {
  const key = toast.webNotifyId!;
  const source = webNotifySources.get(key);
  webNotifySources.delete(key);
  if (source) {
    const found = await withDeadline(
      lookupNotifiedMessage(source.email, source.notified),
      NOTIFY_LOOKUP_TIMEOUT_MS,
      null,
    );
    if (found && toast.account) {
      notifyLog(`[notify] click ${key}: the api says thread=${found.threadId}`);
      activateNotification(toast.account.key, 'mail', found.threadId, source.notified.subject);
      return;
    }
    // The page-side id goes back, never the key we filed it under: the page's own map is
    // keyed by the name it made up, and knows nothing about which WebContents it is.
    if (!source.wc.isDestroyed()) {
      notifyLog(`[notify] click ${key}: the api did not recognise it, asking the view`);
      source.wc.send(IPC.WEB_NOTIFY_CLICK, source.pageId);
      return;
    }
  }
  // Nothing left that could resolve the thread. Showing the account beats swallowing the
  // click.
  notifyLog(`[notify] click ${key}: no source and no match, opening the account`);
  if (toast.account) activateNotification(toast.account.key, 'mail');
}

function activateToast(toast: Toast): void {
  if (toast.webNotifyId) {
    void openNotifiedThread(toast);
    return;
  }
  if (toast.kind === 'mail' && toast.account) {
    activateNotification(toast.account.key, 'mail', toast.threadId);
    return;
  }
  if (toast.kind === 'download' && toast.threadId) {
    const action = downloadClickPaths.get(toast.threadId);
    downloadClickPaths.delete(toast.threadId);
    if (action === 'open-file') void shell.openPath(toast.threadId);
    else if (action === 'show-in-folder') shell.showItemInFolder(toast.threadId);
    return;
  }
  if (toast.kind === 'update' || toast.kind === 'error') {
    openSettingsPanel();
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

// Archive and mark-read from the card. The card is already gone by the time this runs —
// the controller removes it before calling — because a button that leaves its card sitting
// there while a request is in flight invites a second click on the same message. A failure
// is logged and not surfaced: the mail is still in the inbox, which is the same state the
// user would have been in had they never clicked.
async function runToastAction(toast: Toast, action: ToastAction): Promise<void> {
  const email = toast.account?.email;
  const messageId = toast.messageId;
  if (!email || !messageId) return;
  const withToken = withTokenFor(email);
  if (!withToken) return;
  try {
    if (action === 'archive') await withToken((t) => archiveMessage(t, messageId));
    else await withToken((t) => markMessageRead(t, messageId));
  } catch (e) {
    console.warn(`[toast] ${action} failed for ${email}:`, e);
  }
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
  // Which of the two notification paths raised a card decides how exact its click can be,
  // and nothing downstream records it. This one is push: the thread id comes from the Gmail
  // API and is the mail itself, so a click that still lands wrong is about opening, not
  // about finding.
  notifyLog(`[notify] raise push ${email} thread=${meta.threadId}`);
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


//===========================
// Push and sync
//===========================

// The access-token dance for one account: use what we have, and on a 401 force a refresh
// and try once more. Lifted out of syncRunnerFor because the toast actions need the same
// thing for whichever account the card belongs to, long after the sync that raised it.
function withTokenFor(email: string): (<T>(fn: (token: string) => Promise<T>) => Promise<T>) | null {
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return null;
  return async <T>(fn: (token: string) => Promise<T>): Promise<T> => {
    const token = await accessTokenFor(cfg, oauthTokens!, email);
    if (!token) throw new Error('no token');
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
}

function syncRunnerFor(email: string): { run(): Promise<void> } | null {
  const existing = syncRunners.get(email);
  if (existing) return existing;
  if (!history) return null;

  const withToken = withTokenFor(email);
  if (!withToken) return null;

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
    coveredSince: () => coverage.since(email) ?? apiSyncSince.get(email) ?? null,
    isExpiredCursor: (e) => e instanceof GmailHttpError && e.status === 404,
    onOutcome: (outcome) => {
      reportApiUnread(email, outcome.unread);
      // Only the relay's own mail cards go here. With it off, this same sync still runs —
      // on a timer and on every notification Gmail's page raises — and a card per message
      // would be a second card for mail the page has already announced. What the sync is
      // for then is the line below it: the code in the mail, and a cursor that moved.
      if (RELAY_PUSH_ENABLED) for (const meta of outcome.notify) notifyNewMail(email, meta);
      for (const meta of outcome.notify) void handleVerificationCode(email, meta, withToken);
    },
    onError: (e) => console.warn(`[sync] sync mislukte voor ${email}:`, e),
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

/** Whether the relay drives new mail.
 *
 * Off, and the notifications come from Gmail's own page instead — the shim in preload.ts,
 * raising the same cards through the same stack. The two cannot both run: push coverage is
 * what tells a view to keep quiet, so an account the relay delivers for is an account whose
 * page stops notifying, and turning this back on turns that back on with it. Every line the
 * relay needs is still here and still tested; what it has never had on this machine is a
 * relayUrl and a pushTopic in the config file, without which startRelayPush() returned on
 * the spot anyway — this only says so out loud.
 *
 * The API side below does not hang on it. That keeps running either way, because it is how
 * a verification code gets copied and how the history cursor stays fresh, neither of which
 * the relay was ever the point of. */
const RELAY_PUSH_ENABLED: boolean = false;

/** When the API sync started watching this mailbox. The same question push answers with its
 * coverage moment — mail older than this was already in the inbox and must stay quiet — but
 * deliberately not the same answer. Coverage means "the relay delivers for this account",
 * and it delivers for none; writing this into it would tell every mail view to go silent on
 * behalf of a sync that raises no notifications at all, and the app would go quiet. */
const apiSyncSince = new Map<string, number>();

/** Slow on purpose. Every notification from the page runs a sync of its own the moment it
 * arrives, so this is only the net underneath: mail that notified nobody — quiet hours, an
 * account with notifications off, a category Gmail keeps to itself — whose code still
 * deserves copying and whose history id still has to move. */
const API_SYNC_MS = 5 * 60_000;
let apiSyncTimer: ReturnType<typeof setInterval> | null = null;

/** The API half, without a relay to start it. Idempotent, and called from everywhere
 * startMailSync is: accounts arrive, are removed, or get a token long after they appeared. */
function startApiSync(): void {
  const wanted = new Set(pushableEmails());
  for (const email of apiSyncSince.keys()) if (!wanted.has(email)) apiSyncSince.delete(email);
  for (const email of wanted) {
    if (apiSyncSince.has(email)) continue;
    // Set before the first run, never after: that run writes the baseline cursor, and a
    // moment stamped afterwards would place every message it just skipped in the future.
    apiSyncSince.set(email, Date.now());
    void syncRunnerFor(email)?.run();
  }
  if (apiSyncTimer || wanted.size === 0) return;
  apiSyncTimer = setInterval(() => {
    for (const email of apiSyncSince.keys()) void syncRunnerFor(email)?.run();
  }, API_SYNC_MS);
}

/** Everything that keeps the mailboxes current: the API sync always, the relay only while
 * it is switched on. */
function startMailSync(): void {
  startApiSync();
  if (!RELAY_PUSH_ENABLED) return;
  startRelayPush();
}

function startRelayPush(): void {
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


//===========================
// The main window
//===========================

let firstWindow = true;

function createWindow(): void {
  // Opened before anything can raise a notification, so the first mail of the session is
  // in it. Where: beside prefs.json in userData, as notify.log.
  openNotifyLog(join(app.getPath('userData'), 'notify.log'));
  notifyLog(`[notify] --- app start, ${app.getVersion()}${DEV_URL ? ' (dev)' : ''} ---`);
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
    (accountKey, surface, threadId, subject) =>
      activateNotification(accountKey, surface, threadId, subject),
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
    () => raiseOverlays(),
  );

  // Built and torn down with the main window: a stack floating over a closed app is
  // nonsense. Where it appears is not the window's business — the stack always goes to
  // the primary display, whichever screen the app itself has been dragged to.
  toastWindow = new ToastWindow(
    SIDEBAR_PRELOAD_PATH,
    DEV_URL ? `${DEV_URL}/toasts` : 'app://bundle/toasts.html',
    () => (prefs?.getAll().reneMode ? RENE_ZOOM_FACTOR : 1),
    () => toasts?.markReady(),
    // Rebuild while there is a rebuild left, and when there is not, get what is queued out
    // by the only route still open. Ignoring this answer is how a broken stack turned into
    // no notification at all rather than a plain one.
    () => {
      if (!repairToastStack()) drainToSystem();
    },
  );
  toasts = new ToastController({
    window: toastWindow,
    locale: () => currentLocale(),
    reneMode: () => prefs?.getAll().reneMode === true,
    dark: () => isDarkTheme(prefs?.getAll().theme ?? 'system', nativeTheme.shouldUseDarkColors),
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
    onDiscard: (toast) => forgetToastResources(toast),
  });
  mainWindow.on('closed', () => {
    toasts?.destroy();
    toasts = null;
    toastWindow = null;
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
      setTimeout(() => void refreshDelegatedUrls(), 7000);
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


//===========================
// Updates
//===========================

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
  // A system toast made its own noise; ours does not. Without this the update and the
  // failed account link are the only two app toasts that arrive in silence, which reads
  // as a missed notification rather than a quiet one. The shared 1.5s throttle in
  // playNotificationSound is what keeps a burst from turning into a chord.
  if (prefs) playNotificationSound(prefs.getAll());
}
// A download that failed once is not a download that cannot be done. The sha512 mismatch
// reported from the field was answered by clicking download again a few times, which is
// the shape of a bad transfer rather than a bad release: electron-updater throws the
// cached file away behind a failed attempt, so the next one starts clean and there is
// nothing left over to fail the same way. Doing that here means the person is not asked to
// work it out. The error is still shown, just only once there is nothing left to try — and
// the failures that will never come good, an invalid signature above all, are not retried
// at all. See update-retry.ts.
function downloadUpdate(): void {
  updateRequested = true;
  if (downloadRetryTimer) {
    clearTimeout(downloadRetryTimer);
    downloadRetryTimer = null;
  }
  downloadAttempt = 0;
  attemptUpdateDownload();
}

function attemptUpdateDownload(): void {
  downloadRetryTimer = null;
  downloadAttempt += 1;
  const attempt = downloadAttempt;
  // A failed download reports itself twice: electron-updater emits `error` on its way to
  // rejecting the promise. The event arrives first and knows nothing about the retry that
  // is about to happen, so on its own it would flash an error state this function takes
  // back a moment later — and an error state is what pops the tray dialog. Whether a
  // download failure is worth reporting is decided here and nowhere else.
  downloadInFlight = true;
  autoUpdater
    .downloadUpdate()
    .then(() => {
      downloadInFlight = false;
    })
    .catch((err) => {
      downloadInFlight = false;
      const message = String(err?.message || err);
      if (!shouldRetryDownload(message, attempt)) {
        updateLog?.error(`download failed after ${attempt} attempt(s): ${message}`);
        sendUpdate({ state: 'error', message });
        return;
      }
      updateLog?.warn(`download attempt ${attempt} failed, retrying: ${message}`);
      // Held at downloading rather than flashed through error: nothing has gone wrong yet
      // that the person could act on, and a percentage that starts over is the honest
      // picture of a transfer that is starting over.
      sendUpdate({ state: 'downloading', percent: 0 });
      downloadRetryTimer = setTimeout(attemptUpdateDownload, UPDATE_RETRY_DELAY_MS);
    });
}
function installUpdate(): void {
  isQuitting = true;
  autoUpdater.quitAndInstall();
}


//===========================
// System integration
//===========================

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


//===========================
// Tray
//===========================

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


//===========================
// Opening things
//===========================

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
  // A deliberate test should always be heard, so the throttle is reset first. Whether it
  // may sound at all is playNotificationSound's decision, not this one's.
  lastSoundAt = 0;
  playNotificationSound(p);
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


//===========================
// Downloads and sessions
//===========================

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

// What a notification Gmail's page raised was, kept for as long as its card is up.
//
// The text is here rather than only in the page because it is what identifies the mail
// again: the API is asked first, and it is asked about this sender and this subject —
// unfolded and unreplaced, which is not what the card ended up showing when the privacy
// settings are on. The view is kept alongside for when the API cannot answer, since its
// DOM is the older lookup and still the fallback. Keyed by webNotifySourceKey rather than
// by the page-side id alone, which is only unique within one view; the page-side id is
// kept as well, because that is the name the page itself will recognise on the way back.
const webNotifySources = new Map<
  string,
  { wc: Electron.WebContents; pageId: string; email: string; notified: NotifiedMail }
>();

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
  if (prefs) playNotificationSound(prefs.getAll());
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


//===========================
// Updater wiring
//===========================

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
  // electron-updater logs to `console` by default, which a packaged Windows build has no
  // attachment for, so everything it says about a failed update is written to nowhere.
  // That is why the sha512 report could not be traced any further than its dialog.
  updateLog = createUpdateLog(join(app.getPath('userData'), 'update.log'));
  autoUpdater.logger = updateLog;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => {
    sendUpdate({ state: 'available', version: info.version });
    maybeNotifyUpdate(info.version);
  });
  autoUpdater.on('update-not-available', (info) => sendUpdate({ state: 'not-available', version: info.version }));
  autoUpdater.on('error', (err) => {
    // A download decides its own reporting in attemptUpdateDownload, which may be about to
    // retry this. Everything else — a failed check above all — is reported here.
    if (downloadInFlight) return;
    sendUpdate({ state: 'error', message: String(err?.message || err) });
  });
  autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => {
    sendUpdate({ state: 'downloaded', version: info.version });
    if (updateRequested) {
      isQuitting = true;
      autoUpdater.quitAndInstall();
    }
  });
}


//===========================
// Notification setup
//===========================

function setupNotifications(): void {
  if (process.platform === 'win32') app.setAppUserModelId('com.gmaildesktop.app');
  const ses = session.fromPartition(SESSION_PARTITION);
  // Everything except notifications, which the app draws itself — see
  // sessionPermissionAllowed for why granting them put mail on the Windows shelf.
  ses.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(sessionPermissionAllowed(permission)),
  );
  ses.setPermissionCheckHandler((_wc, permission) => sessionPermissionAllowed(permission));
}


//===========================
// IPC handlers
//===========================

function registerIpc(): void {
  ipcMain.on(IPC.SWITCH_SURFACE, (_e, arg: { key: string; surface: Surface }) => {
    const p = profiles.find((x) => keyOf(x) === arg.key);
    if (!p) return;
    openSurfaceForAccount(p.ref, arg.surface);
  });
  ipcMain.on(IPC.REDETECT, () => redetect());
  ipcMain.on(IPC.ADD_ACCOUNT, () => addAccount());
  // "Look for delegated mailboxes" now asks the relay instead of reading Gmail's account
  // menu, so it no longer has to bring account 0 to the front and put it back: nothing is
  // read from a page. Whatever it finds is added straight away rather than offered as a
  // suggestion — the app is not guessing any more, it is being told, and there is nothing
  // for the user to confirm about a delegation Google has already recorded.
  ipcMain.on(IPC.ADD_DELEGATED, () => {
    void refreshDelegatedFromApi({ asked: true });
  });
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
  // Whatever a page has to say about itself. Tagged with the account when the sender is one
  // of the mail views, since "Gmail raised a notification" is only half an answer without
  // knowing which mailbox said it.
  ipcMain.on(IPC.VIEW_LOG, (e, message: unknown) => {
    if (typeof message !== 'string' || !message) return;
    const key = manager?.keyForWebContents(e.sender) ?? null;
    const who = profiles.find((p) => keyOf(p) === key)?.email ?? key ?? `view ${e.sender.id}`;
    notifyLog(`[view ${who}] ${message.slice(0, 300)}`);
  });
  // The page is listening and wants the stack. This is the handshake that matters; the
  // did-finish-load one is kept because it costs nothing and covers a page that somehow
  // never asks.
  ipcMain.on(IPC.TOAST_READY, () => toasts?.markReady());
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
  // Gmail raised a notification in one of its views. The account comes from which view
  // sent it, never from the page, and the privacy replacement is applied here so that one
  // place decides it for both notification paths. Push-covered accounts never get here:
  // notificationsAllowed already told that view to keep quiet.
  ipcMain.on(IPC.WEB_NOTIFY_SHOW, (e, arg: { id: string; title: string; body: string }) => {
    if (!prefs) return;
    // The id is template-stringified into the source key, so any type would be accepted
    // and would file the click under a name nothing can look up again. Checked the same
    // way profile-view-manager checks NOTIFICATION_ACTIVATE's thread id, and for the same
    // reason: what is on the other end of this channel is Google's page, not ours.
    if (typeof arg?.id !== 'string') {
      notifyLog(`[notify] a view raised a notification with a ${typeof arg?.id} id — dropped`);
      return;
    }
    const accountKey = manager?.keyForWebContents(e.sender) ?? null;
    const profile = accountKey ? profiles.find((p) => keyOf(p) === accountKey) : undefined;
    // Both of these are silent losses, and both have a cause worth naming: a view the
    // manager no longer recognises (it was discarded, or it is a pop-out), or an account
    // that has since been removed.
    if (!profile) {
      notifyLog(
        `[notify] a notification arrived from a view with no account (key=${accountKey ?? 'unknown'}) — dropped`,
      );
      return;
    }
    const p = prefs.getAll();
    const hidden = hiddenNotificationText(p);
    const L = nativeLabels(currentLocale(), p.reneMode === true);
    const sourceKey = webNotifySourceKey(e.sender.id, arg.id);
    // Kept as Gmail wrote it, which is not what the card will show: the privacy settings
    // may replace both lines below, and the API is asked about the mail, not about the
    // card. Coerced because this is Google's page on the other end and `title: string` is
    // the signature, not a promise.
    const notified: NotifiedMail = { sender: String(arg.title ?? ''), subject: String(arg.body ?? '') };
    webNotifySources.set(sourceKey, { wc: e.sender, pageId: arg.id, email: profile.email, notified });
    // The other path: Gmail's own page, which sends no thread id, so a click has to work
    // out which mail this was — the API first, the page's DOM after. Paired with the line
    // whichever of the two answered writes on that click.
    notifyLog(
      `[notify] raise web ${profile.email} src=${sourceKey} subject=${JSON.stringify(notified.subject.slice(0, 60))}` +
        ` persist=${notificationPersist(p, profile.email)} silent=${notificationSilent(p, profile.email, 'mail')}` +
        `${hidden.hiddenSender || hidden.hiddenSubject ? ' (text hidden by the privacy settings)' : ''}`,
    );
    showToast({
      kind: 'mail',
      title: hidden.hiddenSender ?? arg.title,
      body: hidden.hiddenSubject ?? (arg.body || L.noSubject),
      account: toastAccountFor(profile.email),
      webNotifyId: sourceKey,
      persist: notificationPersist(p, profile.email),
    });
    if (!notificationSilent(p, profile.email, 'mail')) playNotificationSound(p);
    // Gmail's page just said mail arrived, which is the one thing the relay was subscribed
    // to hear. So the API side is told the same way: the sync that copies a verification
    // code and moves the history cursor runs now, rather than up to five minutes from now.
    void syncRunnerFor(profile.email)?.run();
  });
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
    // Delegated mailboxes belong in this list. They were filtered out because they have no
    // OAuth token of their own and there was no other way to read their labels, which meant
    // a shared mailbox could never be picked as a copy target — it was simply not offered,
    // so it read as "I cannot find it" rather than as a missing feature. The relay supplies
    // the token now.
    const targetable = profiles.filter(
      (p) =>
        (p.kind === 'authuser' || p.kind === 'delegated') &&
        (!lastDropSource || p.email !== lastDropSource),
    );
    if (!cfg || !oauthTokens) {
      return {
        accounts: targetable.map((p) => ({ email: p.email, labels: [], error: 'Niet gekoppeld' })),
      };
    }
    // One mailbox may not hold up the others. This ran in sequence, so a mailbox whose token
    // or label list was slow to arrive stopped the window at "Labels ophalen…" for every
    // account behind it — and before the deadlines in gmail-api.ts and delegated-token.ts,
    // one that never arrived stopped it for good. mapLimit keeps the answers in input order,
    // so the columns stay where the user expects them.
    const tokens = oauthTokens;
    const accounts: AccountLabels[] = await mapLimit(targetable, 4, async (p) => {
      const got = await mailboxToken(p.email);
      if (!got.ok) return { email: p.email, labels: [], error: got.error };
      const token = got.token;
      try {
        return { email: p.email, labels: await fetchLabels(token) };
      } catch (e) {
        // 403 counts as a refusal too. Gmail answers a token it will not let in with either
        // status — a request it reads as carrying no credential comes back as "Request is
        // missing required authentication credential", and that sentence, with its link to
        // Google's console documentation, was being printed under the mailbox name for
        // someone to read. Only 401 was recovered from, so a 403 skipped the fresh token and
        // went straight to showing Google's own English.
        const refused = e instanceof GmailHttpError && (e.status === 401 || e.status === 403);
        if (e instanceof GmailHttpError) {
          console.warn(
            `[labels] ${p.email} (${isDelegatedMailbox(p.email) ? 'gedelegeerd' : 'eigen'}) HTTP ${e.status}: ${e.message}`,
          );
        }
        // Recovering from a 401 differs per kind, and using the wrong one is silent: a
        // delegated mailbox has no refresh token to force, and an own account has no relay
        // entry to forget. A delegation can be revoked while a token from it is still inside
        // its hour, so the cached one has to go before asking again.
        let fresh: string | null = null;
        if (refused && isDelegatedMailbox(p.email)) {
          forgetDelegatedToken(p.email);
          const again = await delegatedTokenFor(p.email);
          fresh = again.ok ? again.token : null;
        } else if (refused) {
          fresh = await forceRefresh(cfg, tokens, p.email);
        }
        if (fresh) {
          try {
            const labels = await fetchLabels(fresh);
            if (!isDelegatedMailbox(p.email)) refreshFailures.delete(p.email);
            return { email: p.email, labels };
          } catch (e2) {
            // A brand-new token refused as well says the same thing as the first refusal, so
            // it gets the same sentence. This branch is how Google's English reached the
            // screen even after the rewriting below was added: it sat in front of it.
            if (e2 instanceof GmailHttpError && (e2.status === 401 || e2.status === 403)) {
              console.warn(`[labels] ${p.email} ook na een verse token HTTP ${e2.status}: ${e2.message}`);
              return { email: p.email, labels: [], error: mailboxRefusedText(p.email) };
            }
            return { email: p.email, labels: [], error: (e2 as Error).message };
          }
        }
        if (refused) {
          // Only an own account can have a link that expired; a delegated mailbox has none,
          // so it must not be flagged as needing a reconnect.
          if (!isDelegatedMailbox(p.email)) {
            refreshFailures.add(p.email);
            scheduleOAuthHealthCheck();
          }
          return { email: p.email, labels: [], error: mailboxRefusedText(p.email) };
        }
        return { email: p.email, labels: [], error: (e as Error).message };
      }
    });
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
      // One entry point for both kinds. A delegated mailbox has no token of its own and
      // never will — nobody signs in as a shared mailbox — so its token comes from the
      // relay, which checks Google's delegation record before handing one over.
      const got = await mailboxToken(target.email);
      if (!got.ok) {
        // Only an own account can have a link that expired; a delegated mailbox has none, so
        // it must not be flagged as needing a reconnect.
        if (!isDelegatedMailbox(target.email)) {
          refreshFailures.add(target.email);
          scheduleOAuthHealthCheck();
        }
        done += files.length;
        progress('copy', target.email);
        accounts.push({
          email: target.email,
          copied: 0,
          skipped: 0,
          total: files.length,
          error: got.error,
        });
        continue;
      }
      let token = got.token;

      let ok = 0;
      let over = 0;
      let lastError: string | undefined;
      /** Source thread id -> the thread it became in this account. */
      const threadOfCopy = new Map<string, string>();
      for (const { file, messageId, threadId: sourceThreadId } of files) {
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
        // The thread this message's conversation landed in, in this account. The first
        // message of a conversation makes it and the rest are filed under it; without that
        // Gmail files every insert as a thread of its own and a copied conversation arrives
        // in pieces. Per target account, because a thread id is only meaningful inside the
        // mailbox that issued it.
        const groupKey = sourceThreadId || file;
        const landedIn = threadOfCopy.get(groupKey);
        try {
          let inserted: { id: string | null; threadId: string | null };
          const insert = (t: string, thread?: string) => insertMessage(t, raw, labelIds, thread);
          try {
            inserted = await insert(token, landedIn);
          } catch (e) {
            if (e instanceof GmailHttpError && e.status === 400 && landedIn) {
              // Google refused the thread rather than the message: its conditions on
              // References and Subject were not met, which is a property of this one mail
              // and not a reason to lose it. It goes in on its own instead.
              console.warn(`[maildrop] ${file} paste niet in thread ${landedIn}, los ingevoegd`);
              inserted = await insert(token);
            } else {
              if (!(e instanceof GmailHttpError) || e.status !== 401) throw e;
              const fresh = await forceRefresh(cfg, oauthTokens, target.email);
              if (!fresh) {
                refreshFailures.add(target.email);
                scheduleOAuthHealthCheck();
                throw new Error('Verbinding verlopen');
              }
              token = fresh;
              refreshFailures.delete(target.email);
              inserted = await insert(token, landedIn);
            }
          }
          if (!landedIn && inserted.threadId) threadOfCopy.set(groupKey, inserted.threadId);
          ok += 1;
          records.push({
            ts,
            account: target.email,
            threadId: inserted.threadId ?? inserted.id ?? '',
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
  // The bar asks once it is listening, because ACTIVE_CHANGED for the first view is sent
  // from did-finish-load — before the React tree that would hear it has mounted.
  ipcMain.handle(IPC.ACTIVE_GET, () => activeTab());
  ipcMain.handle(IPC.OAUTH_RECONNECT_GET, () => ({ accounts: reconnectAccounts }));
  ipcMain.handle(IPC.OAUTH_STATUS_GET, () => ({
    configured: oauthConfig() !== null,
    accounts: oauthStatuses,
  }));
  // Setting the machine up from inside the app, because the alternative is what happened:
  // an install where nothing links and nothing says why, fixed by someone else copying a
  // file into AppData. The file is written through byte for byte — see oauth-config-file.ts
  // for why rebuilding it from the fields we validate would quietly break push.
  ipcMain.handle(IPC.OAUTH_CONFIG_IMPORT, async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return { ok: false };
    let checked;
    try {
      checked = checkOAuthConfigFile(readFileSync(res.filePaths[0], 'utf8'));
    } catch {
      // Unreadable is the same answer as unusable to whoever picked it.
      return { ok: false, invalid: true };
    }
    if (!checked.ok) return { ok: false, invalid: true };
    try {
      mkdirSync(dirname(OAUTH_CONFIG_PATH), { recursive: true });
      writeFileSync(OAUTH_CONFIG_PATH, checked.text, 'utf8');
    } catch (e) {
      console.warn('[oauth] could not write the config:', e);
      return { ok: false, invalid: true };
    }
    // Nothing caches the config — oauthConfig() re-reads it — so the app is linkable from
    // here on. The health check republishes the statuses, which turns every account into a
    // Verbinden button, and the API sync can start now that there is a token to sign with.
    void checkOAuthHealth();
    startMailSync();
    return { ok: true };
  });
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
    startMailSync();
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
    startMailSync();
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
    // The stack is its own window, so pushPrefs does not reach it: it draws from the state
    // the controller sends and nothing else. A card already on screen when the theme is
    // switched would otherwise keep the old one until it is dismissed.
    toasts?.refresh();
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
    // applyReneZoom only reaches the main window and the profile views. The toast window
    // is created lazily and then lives for the session, so it has to be told separately,
    // and refresh() on its own is not enough: re-sending the stack makes the page lay out
    // again but the CSS did not change, so it reports the same numbers into a window whose
    // factor moved underneath them.
    toastWindow?.applyZoom();
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


//===========================
// App lifecycle
//===========================

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
  nativeTheme.on('updated', () => {
    applyTitleBarOverlay();
    // Only matters while the choice is "system", but the resolver is the one that knows
    // that, and asking it costs a boolean.
    toasts?.refresh();
  });
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

