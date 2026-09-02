'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SettingsPanel } from './SettingsPanel';
import { Topbar } from './Topbar';
import type {
  MailDropItem,
  MailDropCopyProgress,
  MailDropCopyResult,
  MailDropCopyMode,
  MailDropExisting,
} from './MailDropModal';
import { getStrings, type UiStrings } from './strings';
import { TourGuide } from './TourGuide';
import { TourStage as TourStageView } from './TourStage';
import { planTour, type TourStage, type TourStep } from './tour-steps';
import { planTabMenu, tabMenuChoices } from './tab-menu';
import { openableSurfaces, type Surface } from '../lib/surfaces';
import { googleAppTarget, pinnedSurfacesFor } from '../lib/google-apps';
import type { NativeMenuItem } from '../lib/native-menu';
import type { ChangelogVersion } from './changelog-types';
import type { ReconnectAccount } from './reconnect-text';
import type { OAuthStatusReport } from '../lib/oauth-status';
import type { HiddenAccount } from '../lib/hidden-accounts';
import type { RecentLabelUse } from './recent-labels';
import type { ComposeAccountAsk } from '../lib/compose-account';
import type { DelegatedPickerAsk } from '../lib/delegated-picker';
import type { SettingsSection } from './settings/nav';
import type { MailDropFolderStatus } from '../../electron/core/ipc';
import type { ToastAction, ToastState } from '../lib/toast';

// The page that carries the bar and the settings panel: all state and all IPC live
// here, the drawing lives in Topbar and SettingsPanel. The Prefs, UpdateState and
// DownloadRecord shapes are copied from electron/ rather than imported, because an
// `import type` from the main process pulls Electron into this page's bundle.
//
// A provisional tab comes from the remembered bar before detection has recovered its
// address. Main cannot open one, so it is never marked active and a click on it is
// remembered by address. An app opening outside the app must not move the active tab, or
// the bar points at a tab with no view behind it.


//===========================
// Types
//===========================

export interface Profile {
  key: string;
  kind: 'authuser' | 'delegated';
  index: number;
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
  hasCalendar: boolean;
  order?: number;
  label?: string;
  provisional?: boolean;
  hasMail?: boolean;
}
export type { Surface };

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'no-release'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'dev';

export interface UpdateStatus {
  state: UpdateState;
  currentVersion?: string;
  version?: string;
  percent?: number;
  message?: string;
}

export interface AccountPref {
  order?: number;
  label?: string;
  zoom?: number;
  notify?: boolean;
  calendarNotify?: boolean;
  badgeCount?: boolean;
  notifySound?: boolean;
  notifyPersist?: boolean;
}
export interface Prefs {
  window: { width: number; height: number; x?: number; y?: number; maximized: boolean };
  autoStart: boolean;
  launchMinimized: boolean;
  theme: 'system' | 'light' | 'dark';
  notificationOpen: 'app' | 'window';
  notifications: {
    dnd: boolean;
    dndUntil?: number;
    quietHours: { enabled: boolean; start: string; end: string };
    showSender: boolean;
    showSubject: boolean;
    sound: boolean;
    soundName: string;
    volume: number;
    googleApps: boolean;
  };
  accounts: Record<string, AccountPref>;
  mailDrop: { folder: string };
  appearance: {
    showUnreadBadges: boolean;
    tray: { enabled: boolean; selectUnreadOnClick: boolean; color: 'system' | 'light' | 'dark' };
    restrictMinWindowSize: boolean;
  };
  downloads: {
    folder: string;
    saveAsDialog: boolean;
    openFolderWhenDone: boolean;
    notify: boolean;
    notifyClick: DownloadClickAction;
  };
  phishing: { confirmExternalLinks: boolean; trustedHosts: string[] };
  updates: { autoCheck: boolean; notify: boolean; allowPrerelease?: boolean };
  googleApps: {
    openInApp: boolean;
    alwaysNewWindow: boolean;
    excluded: string[];
    showAccountLabel: boolean;
    showAccountColor: boolean;
    pinned: string[];
  };
  verificationCodes: {
    autoCopy: boolean;
    confidence: 'medium' | 'high';
    markRead: boolean;
    deleteAfter: boolean;
  };
  advanced: { hardwareAcceleration: boolean; lowMemory?: boolean };
  tour: { seen: boolean };
  reneMode: boolean;
  language: 'system' | 'en' | 'nl';
  locale: 'en' | 'nl';
}

export interface DownloadRecord {
  filename: string;
  path: string;
  url: string;
  bytes: number;
  startedAt: number;
  state: 'completed' | 'cancelled' | 'interrupted';
}

export type DownloadClickAction = 'show-in-folder' | 'open-file' | 'nothing';

interface DesktopBridge {
  onProfilesChanged(cb: (profiles: Profile[]) => void): void;
  onUnreadChanged(cb: (counts: Record<string, number>) => void): void;
  onActiveChanged(cb: (active: { key: string; surface: Surface } | null) => void): void;
  getActive(): Promise<{ key: string; surface: Surface } | null>;
  switchSurface(key: string, surface: Surface): void;
  redetect(): void;
  addAccount(): void;
  addDelegated(): void;
  onDelegatedPickerAsk(cb: (ask: DelegatedPickerAsk) => void): void;
  pickDelegated(emails: string[]): void;
  closeDelegatedPicker(): void;
  setColor(email: string, color: string): void;
  removeAccount(email: string): void;
  getHiddenAccounts(): Promise<HiddenAccount[]>;
  unhideAccount(email: string): void;
  onHiddenAccounts(cb: (hidden: HiddenAccount[]) => void): void;
  toggleSettings(open: boolean): void;
  popupMenu(items: NativeMenuItem[], anchor?: { x: number; y: number }): Promise<string | null>;
  onSettingsForceClose(cb: () => void): void;
  onSettingsForceOpen(cb: (section?: string) => void): void;
  checkForUpdate(): void;
  downloadUpdate(): void;
  installUpdate(): void;
  /** Resolves to whether a compose window opened, which is what lets the panel decide
   * between clearing the box and leaving the text where it is. */
  sendFeedback(input: { text: string; includeDiagnostics: boolean }): Promise<boolean>;
  onUpdateStatus(cb: (status: UpdateStatus) => void): void;
  setAutoStart(v: boolean): void;
  setLaunchMinimized(v: boolean): void;
  setAppearance(patch: {
    showUnreadBadges?: boolean;
    tray?: { enabled?: boolean; selectUnreadOnClick?: boolean };
    restrictMinWindowSize?: boolean;
  }): void;
  setDownloadPrefs(patch: {
    folder?: string;
    saveAsDialog?: boolean;
    openFolderWhenDone?: boolean;
    notify?: boolean;
    notifyClick?: DownloadClickAction;
  }): void;
  setPhishing(patch: { confirmExternalLinks?: boolean; trustedHosts?: string[] }): void;
  setUpdatePrefs(patch: {
    autoCheck?: boolean;
    notify?: boolean;
    allowPrerelease?: boolean;
  }): void;
  setAdvanced(patch: { hardwareAcceleration?: boolean; lowMemory?: boolean }): void;
  setTourActive(active: boolean): void;
  isFirstRun(): Promise<boolean>;
  setTourSeen(v: boolean): void;
  setVerificationCodes(patch: {
    autoCopy?: boolean;
    confidence?: 'medium' | 'high';
    markRead?: boolean;
    deleteAfter?: boolean;
  }): void;
  getDownloadHistory(): Promise<DownloadRecord[]>;
  clearDownloadHistory(): void;
  revealDownload(path: string): void;
  openDownload(path: string): void;
  onDownloadHistoryChanged(cb: () => void): void;
  onPlayNotificationSound(cb: (arg: { name: string; volume: number }) => void): void;
  setGoogleApps(patch: {
    openInApp?: boolean;
    alwaysNewWindow?: boolean;
    excluded?: string[];
    showAccountLabel?: boolean;
    showAccountColor?: boolean;
    pinned?: string[];
  }): void;
  setNotificationExtras(patch: {
    showSender?: boolean;
    showSubject?: boolean;
    sound?: boolean;
    soundName?: string;
    volume?: number;
    googleApps?: boolean;
  }): void;
  testNotification(): void;
  pickDownloadFolder(): Promise<string>;
  onPrefsChanged(cb: (prefs: Prefs) => void): void;
  setAccountPref(arg: { email: string; label?: string; notify?: boolean; calendarNotify?: boolean; badgeCount?: boolean; notifySound?: boolean; notifyPersist?: boolean }): void;
  setAccountOrder(emails: string[]): void;
  setNotifications(arg: { dnd: boolean; quietHours: { enabled: boolean; start: string; end: string } }): void;
  setTheme(theme: 'system' | 'light' | 'dark'): void;
  setLanguage(v: 'system' | 'en' | 'nl'): void;
  setNotificationOpen(v: 'app' | 'window'): void;
  setReneMode(v: boolean): void;
  requestDefaultMail(): void;
  isOverlay: boolean;
  onMailDropPreview(cb: (arg: { items: MailDropItem[]; tree?: unknown }) => void): void;
  closeMailDropPreview(): void;
  getMailDropPreview(): Promise<{ items: MailDropItem[]; tree?: unknown }>;
  getLabels(): Promise<{ accounts: { email: string; labels: { id: string; name: string }[]; error?: string }[] }>;
  getRecentLabels(): Promise<RecentLabelUse[]>;
  getMailDropExisting(): Promise<MailDropExisting>;
  onMailDropExisting(cb: (arg: MailDropExisting) => void): void;
  copyMailDrop(
    targets: { email: string; labelIds: string[]; tree?: { parentLabelId: string | null } }[],
    mode?: MailDropCopyMode,
  ): Promise<MailDropCopyResult>;
  onMailDropCopyProgress(cb: (arg: MailDropCopyProgress) => void): void;
  onReconnectList(cb: (arg: { accounts: ReconnectAccount[] }) => void): void;
  getReconnectList(): Promise<{ accounts: ReconnectAccount[] }>;
  reconnectOAuth(email: string): Promise<{ ok: boolean; error?: string }>;
  getOAuthStatus(): Promise<OAuthStatusReport>;
  onOAuthStatus(cb: (arg: OAuthStatusReport) => void): void;
  importOAuthConfig(): Promise<{ ok: boolean; invalid?: boolean }>;
  getMailDropFolder(): Promise<MailDropFolderStatus>;
  pickMailDropFolder(): Promise<MailDropFolderStatus>;
  openMailDropFolder(): void;
  onDefaultMailStatus(cb: (isDefault: boolean) => void): void;
  getChangelog(): Promise<ChangelogVersion[]>;
  onComposeAccountAsk(cb: (arg: ComposeAccountAsk) => void): void;
  pickComposeAccount(index: number | null): void;
  reportComposeAccountSize(size: { width: number; height: number }): void;
  onToastState(cb: (state: ToastState) => void): void;
  toastReady(): void;
  onToastHoverEnd(cb: () => void): void;
  reportToastSize(size: { width: number; height: number }): void;
  activateToast(id: string): void;
  dismissToast(id: string): void;
  dismissAllToasts(): void;
  runToastAction(arg: { id: string; action: ToastAction }): void;
  setToastHovered(hovered: boolean): void;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}


//===========================
// Constants
//===========================

// A key no real profile can carry: main builds them from an authuser index or a delegated
// address, so nothing it pushes will ever collide, and open() can refuse this one by name.
const TOUR_DEMO_KEY = 'tour-demo';

// The example tab carries a count so it reads as a real tab beside the real ones. It used to
// be here to back the tab step's claim about what the number means; that claim is gone from
// the copy, and looking like the genuine article is reason enough on its own.
const TOUR_DEMO_UNREAD = 3;

// What the bar borrows when nothing is pinned. Drive is in APP_SURFACES, so it is openable for
// any own account and its icon is one everybody recognises.
const TOUR_DEMO_PINNED: readonly Surface[] = ['drive'];


//===========================
// Page
//===========================

export default function AppShell() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [active, setActive] = useState<{ key: string; surface: Surface } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sectionRequest, setSectionRequest] = useState<
    { section: SettingsSection; seq: number } | undefined
  >(undefined);
  // The feedback message lives here and not in its section: the section unmounts on every
  // switch and on close, and a half-written report must survive that.
  const [feedbackDraft, setFeedbackDraft] = useState('');
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' });
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const S = getStrings(prefs?.locale ?? 'en', prefs?.reneMode === true);
  const [isDefaultMail, setIsDefaultMail] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [tourSteps, setTourSteps] = useState<TourStep[] | null>(null);
  const [tourStage, setTourStage] = useState<TourStage>(null);
  // Once per session, whether the tour ran to the end or was waved away. Without this the
  // effect below would start it again on the next profile push, because prefs.tour.seen
  // only turns true after a round trip through main.
  const tourStarted = useRef(false);
  // State and not a ref: arming happens after an await, and a ref would leave the effect
  // below sitting on the value it read before the answer arrived.
  const [tourArmed, setTourArmed] = useState(false);
  const touring = tourSteps !== null;

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    bridge.onProfilesChanged((list) => {
      setProfiles(list);
      // only until main has spoken: the first non-provisional tab is a different question,
      // and at startup a ready delegated mailbox would win over authuser 0's mail
      setActive((cur) => {
        if (cur) return cur;
        const first = list.find((p) => !p.provisional);
        return first ? { key: first.key, surface: 'mail' } : null;
      });
    });
    bridge.onActiveChanged((a) => setActive(a));
    void bridge.getActive().then((a) => {
      if (a) setActive(a);
    });
    bridge.onUnreadChanged(setUnread);
    bridge.onSettingsForceClose(() => setSettingsOpen(false));
    bridge.onSettingsForceOpen((section) => {
      setSettingsOpen(true);
      if (section) askSection(section as SettingsSection);
    });
    bridge.onUpdateStatus(setUpdate);
    bridge.onPrefsChanged((p) => setPrefs(p as Prefs));
    bridge.onDefaultMailStatus(setIsDefaultMail);
    // On a fresh install nobody presses the plus button: the Gmail view is already open on a
    // sign-in page, you sign in there, and detection pushes the account like any other. So the
    // tour cannot hang off addAccount alone -- it also arms when main says this launch found no
    // own account remembered on disk, which is the one honest test for a first ever run.
    void bridge.isFirstRun().then((first) => {
      if (first) setTourArmed(true);
    });
  }, []);

  const popupMenu = useCallback(
    async (items: NativeMenuItem[], anchor?: { x: number; y: number }) =>
      (await window.desktop?.popupMenu(items, anchor)) ?? null,
    [],
  );

  useEffect(() => {
    if (!pendingEmail) return;
    const row = profiles.find((p) => p.email.toLowerCase() === pendingEmail);
    if (!row) {
      setPendingEmail(null);
      return;
    }
    if (row.provisional) return;
    setPendingEmail(null);
    // Same guard as `open()` below: a row that settled into a URL-less delegated mailbox
    // has nothing for ensureView to load. Without this the tab would highlight as active
    // while its view never opens.
    if (row.kind === 'delegated' && row.hasMail === false) return;
    setActive({ key: row.key, surface: 'mail' });
    window.desktop?.switchSurface(row.key, 'mail');
  }, [profiles, pendingEmail]);

  useEffect(() => {
    const choice = prefs?.theme ?? 'system';
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = choice === 'dark' || (choice === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.classList.toggle('light', !dark);
    };
    apply();
    if (choice === 'system') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [prefs?.theme]);

  // The Gmail views stay hidden for exactly as long as the tour is on screen. This used to be
  // a hide in startTour paired with an unhide in endTour, and that pairing is what put Gmail
  // back over a running tour: TourGuide decides when the tour is over, so anything that
  // remounted it sent the unhide while the walk was still going. Tying it to the tour's own
  // presence instead means the two cannot drift apart.
  useEffect(() => {
    if (!touring) return;
    window.desktop?.setTourActive(true);
    return () => window.desktop?.setTourActive(false);
  }, [touring]);

  // The tour belongs to the moment somebody gets their first mailbox in this app, and armed is
  // what separates that from a returning user's accounts simply being detected at startup. It
  // is set two ways: main saying this launch found nothing remembered on disk, which is a fresh
  // install however the account arrives, and the plus button, for an empty bar that had one
  // before. Firing on a mailbox appearing alone would walk a returning user through a bar they
  // have used for months.
  //
  // A provisional tab is one remembered from the bar before detection has recovered its
  // address, so it cannot carry the steps that talk about tabs and does not count as arrival.
  useEffect(() => {
    if (!tourArmed || tourStarted.current) return;
    if (!prefs || prefs.tour.seen) return;
    if (!profiles.some((p) => !p.provisional)) return;
    if (settingsOpen) closeSettings();
    startTour();
  }, [tourArmed, profiles, prefs, settingsOpen, active]);

  function open(key: string, surface: Surface) {
    // The tour's example tab has no view behind it, and ensureView would throw on its index
    if (key === TOUR_DEMO_KEY) return;
    if (settingsOpen) setSettingsOpen(false);
    const row = profiles.find((p) => p.key === key);
    if (row?.provisional) {
      setPendingEmail(row.email.toLowerCase());
      return;
    }
    // Known by address, with no URL to load. Opening it would reach
    // SURFACE_CONFIG.mail.url and throw; the tooltip is what tells the user why.
    if (row && row.kind === 'delegated' && row.hasMail === false) return;
    setPendingEmail(null);
    const target =
      surface === 'mail' || !prefs
        ? 'in-app'
        : googleAppTarget(surface, prefs.googleApps);
    if (target !== 'external') setActive({ key, surface });
    window.desktop?.switchSurface(key, surface);
  }
  function addAccount() {
    if (settingsOpen) setSettingsOpen(false);
    armTour();
    window.desktop?.addAccount();
  }
  function addDelegated() {
    if (settingsOpen) setSettingsOpen(false);
    armTour();
    // Nothing to track here any more. This used to raise a "looking…" state that a
    // suggestion message cleared; discovery now asks the relay and whatever it finds arrives
    // through onProfilesChanged like any other account, so the tab appearing in the bar is
    // the feedback.
    window.desktop?.addDelegated();
  }
  function redetect() {
    if (settingsOpen) setSettingsOpen(false);
    window.desktop?.redetect();
  }
  function openSettings() {
    setSettingsOpen(true);
    window.desktop?.toggleSettings(true);
  }
  // Every ask carries its own sequence number: asking for the same section twice has to move
  // the panel twice, because the user can have navigated away in between.
  function askSection(section: SettingsSection) {
    setSectionRequest((prev) => ({ section, seq: (prev?.seq ?? 0) + 1 }));
  }
  function openFeedback() {
    openSettings();
    askSection('feedback');
  }
  function closeSettings() {
    setSettingsOpen(false);
    window.desktop?.toggleSettings(false);
    // Forget which section was asked for. The panel is unmounted while closed, so a request
    // left standing would decide where the gear opens for the rest of the session.
    setSectionRequest(undefined);
  }
  function reorder(fromEmail: string, toEmail: string) {
    if (fromEmail === toEmail) return;
    const emails = profiles.map((p) => p.email);
    const from = emails.indexOf(fromEmail);
    const to = emails.indexOf(toEmail);
    if (from < 0 || to < 0) return;
    emails.splice(to, 0, emails.splice(from, 1)[0]);
    window.desktop?.setAccountOrder(emails);
  }

  // What the bar draws while the tour is up, and which mailbox the demo panel names. The
  // panel shows a real address rather than a made-up one, so nobody has to wonder whether
  // they are looking at their own mail.
  const barProfiles = barProfilesFor(profiles, touring, S);
  const barUnread = touring ? { ...unread, [TOUR_DEMO_KEY]: TOUR_DEMO_UNREAD } : unread;
  // Nothing pinned means the pinned step has nothing to point at, so the bar borrows one for
  // the length of the tour. Drive rather than Calendar: Calendar only appears for a mailbox
  // that has one, and a stand-in that is itself conditional is no stand-in.
  const demoPinned: readonly Surface[] = touring && !hasPinnedApps() ? TOUR_DEMO_PINNED : [];
  const stageMailbox =
    (active ? profiles.find((p) => p.key === active.key)?.email : undefined) ??
    profiles[0]?.email ??
    '';

  /**
   * Whether the active mailbox has any Google apps pinned to the bar
   *
   * @returns false when nothing is pinned, or when no mailbox is active yet
   */
  function hasPinnedApps(): boolean {
    const row = active ? (profiles.find((p) => p.key === active.key) ?? null) : null;
    if (!row || !prefs) return false;
    return pinnedSurfacesFor(prefs.googleApps.pinned, openableSurfaces(row)).length > 0;
  }

  /**
   * Arms the tour, if this is somebody's first mailbox and they have not seen it
   *
   * Called from every path that adds one, so where the user pressed the button does not
   * decide whether they get the tour.
   */
  function armTour() {
    if (prefs?.tour.seen === false && profiles.length === 0) setTourArmed(true);
  }

  function startTour() {
    tourStarted.current = true;
    setTourSteps(planTour());
  }

  function endTour() {
    setTourSteps(null);
    setTourStage(null);
    window.desktop?.setTourSeen(true);
  }

  /**
   * Draws the stage a step asked for, and re-asserts that the tour owns the window
   *
   * The second half is the same move OverlayView.raise() makes, for the same reason: being the
   * only thing on screen is not something the tour keeps by itself. One stray showActive()
   * would otherwise leave Gmail painted over the rest of the walk, and every step is a free
   * chance to put that right.
   *
   * @param stage
   */
  function showStage(stage: TourStage) {
    setTourStage(stage);
    window.desktop?.setTourActive(true);
  }

  function replayTour() {
    closeSettings();
    startTour();
  }

  /**
   * Pops the real OS tab menu, fixed under the tab it belongs to
   *
   * Under the tab and never at the cursor: the cursor is wherever the mouse happens to rest
   * when the step arrives, and a menu floating in the middle of the window explains nothing
   * about right-clicking a tab.
   *
   * The mailbox you are signed in to comes first, because that is the tab the eye is on and
   * its menu is true of the account you actually have. A delegated tab yields Calendar at
   * most and one without a calendar yields no menu at all, so if the active tab is that, the
   * search moves on to a tab that does have one. The example mailbox is the last resort, and
   * only reachable on a first run, where it is in the bar and therefore has a tab to sit
   * under.
   *
   * Whatever is chosen is dropped on the floor: the tour is a walk, not a wizard.
   */
  function showTabMenu() {
    const hasMenu = (p: Profile) => tabMenuChoices(p).length > 0;
    const activeRow = active ? profiles.find((p) => p.key === active.key) : undefined;
    const subject =
      (activeRow && hasMenu(activeRow) ? activeRow : undefined) ??
      profiles.find((p) => !p.provisional && hasMenu(p)) ??
      demoProfile(S);
    void popupMenu(
      planTabMenu(displayName(subject), tabMenuChoices(subject)),
      tabAnchor(subject.key),
    );
  }

  return (
    <div className="relative flex h-screen w-full flex-col bg-neutral-100 text-neutral-800 dark:bg-neutral-950 dark:text-neutral-200">
      <Topbar
        profiles={barProfiles}
        unread={barUnread}
        prefs={prefs}
        active={active}
        labelFor={displayName}
        settingsOpen={settingsOpen}
        update={update}
        strings={S}
        demoPinned={demoPinned}
        onOpen={open}
        onPopupMenu={popupMenu}
        onAddAccount={addAccount}
        onAddDelegated={addDelegated}
        onOpenSettings={openSettings}
        onOpenFeedback={openFeedback}
        onInstallUpdate={() => window.desktop?.installUpdate()}
        onReorder={reorder}
      />

      {settingsOpen && (
        <SettingsPanel
          profiles={profiles}
          sectionRequest={sectionRequest}
          feedbackDraft={feedbackDraft}
          onFeedbackDraftChange={setFeedbackDraft}
          onClose={closeSettings}
          onRedetect={redetect}
          update={update}
          onCheckUpdate={() => window.desktop?.checkForUpdate()}
          onDownloadUpdate={() => window.desktop?.downloadUpdate()}
          onInstallUpdate={() => window.desktop?.installUpdate()}
          prefs={prefs}
          onSetAutoStart={(v) => window.desktop?.setAutoStart(v)}
          onSetLaunchMinimized={(v) => window.desktop?.setLaunchMinimized(v)}
          onSetNotifications={(a) => window.desktop?.setNotifications(a)}
          isDefaultMail={isDefaultMail}
          onRequestDefaultMail={() => window.desktop?.requestDefaultMail()}
          onReplayTour={replayTour}
          onAddAccount={addAccount}
        />
      )}
      <TourStageView stage={tourStage} email={stageMailbox} S={S} />
      {tourSteps && (
        <TourGuide
          steps={tourSteps}
          S={S}
          onStage={showStage}
          onTabMenu={showTabMenu}
          onEnd={endTour}
        />
      )}
    </div>
  );
}


//===========================
// Helper functions
//===========================

function displayName(p: Profile): string {
  return (p.label && p.label.trim()) || p.name || p.email;
}

/**
 * The example mailbox the tour puts in the bar
 *
 * A first run has one account and no delegated mailbox, so the steps about switching tabs,
 * reordering them and their right-click menu would point at a strip with a single tab in it.
 * This is what they point at instead. `authuser` with a calendar on purpose: it is what makes
 * the tab menu offer its full set, which is the thing that step is about.
 *
 * @param S the active string set, so the tab is named in the user's own language
 * @returns {Profile} a profile with a key nothing will ever open
 */
function demoProfile(S: UiStrings): Profile {
  return {
    key: TOUR_DEMO_KEY,
    kind: 'authuser',
    index: -1,
    email: 'example@example.invalid',
    name: S.tourDemoTabName,
    avatarUrl: '',
    color: '#a142f4',
    hasCalendar: true,
  };
}

/**
 * The bar's tabs while the tour runs
 *
 * @param profiles what main actually reported
 * @param touring whether the tour is on screen
 * @param S
 * @returns the real tabs, with the example one appended while there is nothing to demonstrate
 */
function barProfilesFor(profiles: Profile[], touring: boolean, S: UiStrings): Profile[] {
  if (!touring || profiles.length >= 2) return profiles;
  return [...profiles, demoProfile(S)];
}

/**
 * Where a tab's bottom-left corner is, for a menu that has to sit under it
 *
 * In CSS pixels, which is what main converts by the window's zoom factor.
 *
 * Falls back to the tab strip itself rather than to undefined, because undefined means the
 * cursor and a menu at the cursor is the whole thing this exists to prevent. The strip is
 * always in the bar, so the menu lands under the tabs even when one particular tab cannot be
 * found.
 *
 * @param key the profile key the tab carries in data-tab-key
 * @returns {{x: number, y: number}|undefined} undefined only when the bar itself is not drawn
 */
function tabAnchor(key: string): { x: number; y: number } | undefined {
  const target =
    document.querySelector(`[data-tab-key="${key}"]`) ??
    document.querySelector('[data-tour="tabs"]');
  if (!target) return undefined;
  const r = target.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.bottom) };
}
