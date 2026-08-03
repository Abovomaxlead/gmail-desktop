'use client';

import { useCallback, useEffect, useState } from 'react';
import { SettingsPanel } from './SettingsPanel';
import { Topbar } from './Topbar';
import type {
  MailDropItem,
  MailDropCopyProgress,
  MailDropCopyResult,
  MailDropCopyMode,
} from './MailDropModal';
import { getStrings } from './strings';
import type { Surface } from '../lib/surfaces';
import type { NativeMenuItem } from '../lib/native-menu';
import type { ChangelogVersion } from './changelog-types';
import type { ReconnectAccount } from './reconnect-text';

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
}
export type { Surface };

export interface DelegatedSuggestion {
  email: string;
  mailUrl: string;
}

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
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
  theme: 'system' | 'light' | 'dark';
  notificationOpen: 'app' | 'window';
  // `dndUntil` is epoch-ms en komt alleen uit het hoofdproces: het tray-menu zet
  // een tijdelijke demping ("30 minuten stil") en `prefs-store` bewaart hem, en
  // het hoofdproces ruimt hem zelf op als hij verlopen is. Het paneel leest hem
  // wel (het puntje bij Meldingen) maar schrijft hem niet — daarom staat het
  // veld hier en niet in de argumenten van `setNotifications` hieronder.
  notifications: {
    dnd: boolean;
    dndUntil?: number;
    quietHours: { enabled: boolean; start: string; end: string };
  };
  accounts: Record<string, AccountPref>;
  mailDrop: { folder: string };
  reneMode: boolean;
}

interface DesktopBridge {
  onProfilesChanged(cb: (profiles: Profile[]) => void): void;
  onUnreadChanged(cb: (counts: Record<string, number>) => void): void;
  switchSurface(key: string, surface: Surface): void;
  redetect(): void;
  addAccount(): void;
  addDelegated(): void;
  addDelegatedSuggestion(arg: { email: string; mailUrl: string }): void;
  onDelegatedSuggestions(cb: (arg: { suggestions: DelegatedSuggestion[] }) => void): void;
  setColor(email: string, color: string): void;
  removeAccount(email: string): void;
  toggleSettings(open: boolean): void;
  // Laat main een echt OS-menu openen; levert het gekozen id of null.
  popupMenu(items: NativeMenuItem[]): Promise<string | null>;
  onSettingsForceClose(cb: () => void): void;
  onSettingsForceOpen(cb: () => void): void;
  checkForUpdate(): void;
  downloadUpdate(): void;
  installUpdate(): void;
  onUpdateStatus(cb: (status: UpdateStatus) => void): void;
  setAutoStart(v: boolean): void;
  onPrefsChanged(cb: (prefs: Prefs) => void): void;
  setAccountPref(arg: { email: string; label?: string; notify?: boolean; calendarNotify?: boolean; badgeCount?: boolean; notifySound?: boolean; notifyPersist?: boolean }): void;
  setAccountOrder(emails: string[]): void;
  setNotifications(arg: { dnd: boolean; quietHours: { enabled: boolean; start: string; end: string } }): void;
  setTheme(theme: 'system' | 'light' | 'dark'): void;
  setNotificationOpen(v: 'app' | 'window'): void;
  setReneMode(v: boolean): void;
  setDefaultMail(): void;
  isOverlay: boolean;
  onMailDropPreview(cb: (arg: { items: MailDropItem[] }) => void): void;
  closeMailDropPreview(): void;
  getMailDropPreview(): Promise<{ items: MailDropItem[] }>;
  getLabels(): Promise<{ accounts: { email: string; labels: { id: string; name: string }[]; error?: string }[] }>;
  copyMailDrop(
    targets: { email: string; labelIds: string[] }[],
    mode?: MailDropCopyMode,
  ): Promise<MailDropCopyResult>;
  onMailDropCopyProgress(cb: (arg: MailDropCopyProgress) => void): void;
  onReconnectList(cb: (arg: { accounts: ReconnectAccount[] }) => void): void;
  getReconnectList(): Promise<{ accounts: ReconnectAccount[] }>;
  reconnectOAuth(email: string): Promise<{ ok: boolean; error?: string }>;
  getMailDropFolder(): Promise<string>;
  pickMailDropFolder(): Promise<string>;
  openMailDropFolder(): void;
  onDefaultMailStatus(cb: (isDefault: boolean) => void): void;
  getChangelog(): Promise<ChangelogVersion[]>;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

function displayName(p: Profile): string {
  return (p.label && p.label.trim()) || p.name || p.email;
}

// De pagina die de balk en het instellingenpaneel draagt: hier zit alle staat en
// alle IPC, het tekenwerk zit in Topbar en SettingsPanel. Heette Sidebar toen de
// navigatie nog een kolom links was.
export default function AppShell() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [active, setActive] = useState<{ key: string; surface: Surface } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Gevuld zodra een sleep is opgeslagen; null = geen modal.
  const [dropItems, setDropItems] = useState<MailDropItem[] | null>(null);
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' });
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [suggestions, setSuggestions] = useState<DelegatedSuggestion[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);
  const S = getStrings(prefs?.reneMode === true);
  const [isDefaultMail, setIsDefaultMail] = useState(false);

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    bridge.onProfilesChanged((list) => {
      setProfiles(list);
      // Keep the active selection valid: re-derive if the active profile vanished.
      setActive((cur) => {
        if (cur && list.some((p) => p.key === cur.key)) return cur;
        return list[0] ? { key: list[0].key, surface: 'mail' } : null;
      });
    });
    bridge.onUnreadChanged(setUnread);
    bridge.onDelegatedSuggestions(({ suggestions: s }) => {
      setSuggestions(s);
      setScanning(false);
      setScanDone(true);
    });
    bridge.onSettingsForceClose(() => setSettingsOpen(false));
    bridge.onSettingsForceOpen(() => setSettingsOpen(true));
    bridge.onMailDropPreview(({ items }) => setDropItems(items));
    bridge.onUpdateStatus(setUpdate);
    bridge.onPrefsChanged((p) => setPrefs(p as Prefs));
    bridge.onDefaultMailStatus(setIsDefaultMail);
  }, []);

  // De menu's van de balk zijn OS-menu's van het main-proces: die staan boven de
  // native Gmail-views, dus hoeft er niets weggeduwd en teruggezet te worden.
  const popupMenu = useCallback(
    async (items: NativeMenuItem[]) => (await window.desktop?.popupMenu(items)) ?? null,
    [],
  );

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

  function open(key: string, surface: Surface) {
    if (settingsOpen) setSettingsOpen(false);
    setActive({ key, surface });
    window.desktop?.switchSurface(key, surface);
  }
  function addAccount() {
    if (settingsOpen) setSettingsOpen(false);
    window.desktop?.addAccount();
  }
  function addDelegated() {
    if (settingsOpen) setSettingsOpen(false);
    setScanning(true);
    setScanDone(false);
    window.desktop?.addDelegated();
  }
  function acceptSuggestion(s: DelegatedSuggestion) {
    setSuggestions((cur) => cur.filter((x) => x.email !== s.email));
    window.desktop?.addDelegatedSuggestion(s);
  }
  function redetect() {
    if (settingsOpen) setSettingsOpen(false);
    window.desktop?.redetect();
  }
  function openSettings() {
    setSettingsOpen(true);
    window.desktop?.toggleSettings(true);
  }
  function closeSettings() {
    setSettingsOpen(false);
    window.desktop?.toggleSettings(false);
  }
  // Topbar houdt de sleeptoestand zelf bij, dus komen beide adressen mee.
  function reorder(fromEmail: string, toEmail: string) {
    if (fromEmail === toEmail) return;
    const emails = profiles.map((p) => p.email);
    const from = emails.indexOf(fromEmail);
    const to = emails.indexOf(toEmail);
    if (from < 0 || to < 0) return;
    emails.splice(to, 0, emails.splice(from, 1)[0]);
    window.desktop?.setAccountOrder(emails);
  }

  // Only suggest delegates we don't already have as a profile.
  const freshSuggestions = suggestions.filter(
    (s) => !profiles.some((p) => p.email.toLowerCase() === s.email.toLowerCase()),
  );

  return (
    <div className="flex h-screen w-full flex-col bg-neutral-100 text-neutral-800 dark:bg-neutral-950 dark:text-neutral-200">
      <Topbar
        profiles={profiles}
        unread={unread}
        prefs={prefs}
        active={active}
        labelFor={displayName}
        settingsOpen={settingsOpen}
        update={update}
        strings={S}
        suggestions={freshSuggestions}
        scanning={scanning}
        scanDone={scanDone}
        onOpen={open}
        onPopupMenu={popupMenu}
        onAddAccount={addAccount}
        onAddDelegated={addDelegated}
        onAcceptSuggestion={acceptSuggestion}
        onOpenSettings={openSettings}
        onInstallUpdate={() => window.desktop?.installUpdate()}
        onReorder={reorder}
      />

      {/* Het instellingenpaneel vult het gebied onder de balk. Main verbergt de
          Gmail-views al zodra het opengaat, dus het staat nergens achter.
          Het paneel hangt hier rechtstreeks in de kolom, zonder tussen-div: het
          heeft zelf `flex-1` én `h-screen`, en alleen als flex-kind wint flex-1
          en blijft het paneel 40px korter dan het venster in plaats van er onderuit
          te lopen. */}
      {settingsOpen && (
        <SettingsPanel
          profiles={profiles}
          onClose={closeSettings}
          onRedetect={redetect}
          update={update}
          onCheckUpdate={() => window.desktop?.checkForUpdate()}
          onDownloadUpdate={() => window.desktop?.downloadUpdate()}
          onInstallUpdate={() => window.desktop?.installUpdate()}
          prefs={prefs}
          onSetAutoStart={(v) => window.desktop?.setAutoStart(v)}
          onSetNotifications={(a) => window.desktop?.setNotifications(a)}
          isDefaultMail={isDefaultMail}
          onSetDefaultMail={() => window.desktop?.setDefaultMail()}
        />
      )}
    </div>
  );
}
