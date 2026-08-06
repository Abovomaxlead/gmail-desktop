// The tray icon and its context menu. Everything the menu shows or does arrives as
// state, so the template stays a pure function that is testable without Electron and
// this file knows nothing about preferences; now is epoch ms, used to tell whether
// dndUntil is still active. Electron bakes labels and checkbox values in at build
// time, so every state change has to rebuild the whole menu. The click binding
// survives those rebuilds, and createTray takes a finished image because tinting it
// depends on a preference main owns.
import type { Tray, Menu, MenuItemConstructorOptions } from 'electron';
import type { TrayLabels } from './tray-labels';

export function shouldHideOnClose(state: {
  isQuitting: boolean;
  platform: NodeJS.Platform;
}): boolean {
  return !state.isQuitting;
}

export interface TrayUpdateStatus {
  state: string;
  version?: string;
  percent?: number;
}
export interface TrayState {
  onOpen: () => void;
  onIconClick?: () => void;
  onQuit: () => void;
  isPackaged: boolean;
  updateStatus: TrayUpdateStatus;
  onCheckUpdate: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
  autoStart: boolean;
  onToggleAutoStart: (v: boolean) => void;
  dnd: boolean;
  dndUntil?: number;
  now: number;
  onSnooze: (minutes: number | null) => void;
  onClearSnooze: () => void;
  labels: TrayLabels;
}

export function formatClock(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function snoozeActive(state: TrayState): boolean {
  return typeof state.dndUntil === 'number' && state.dndUntil > state.now;
}

export function snoozeStatusLabel(state: TrayState): string {
  if (snoozeActive(state)) return state.labels.snoozedUntil(formatClock(new Date(state.dndUntil!)));
  if (state.dnd) return state.labels.notificationsOff;
  return state.labels.snoozeNotifications;
}

export function updateItemLabel(status: TrayUpdateStatus, isPackaged: boolean, L: TrayLabels): string {
  if (!isPackaged || status.state === 'dev') return L.checkForUpdatesDev;
  switch (status.state) {
    case 'checking':
      return L.checkingForUpdates;
    case 'available':
      return L.downloadUpdate(status.version);
    case 'downloading':
      return L.downloadingUpdate(status.percent ?? 0);
    case 'downloaded':
      return L.restartToInstall;
    case 'error':
      return L.updateCheckFailed;
    default:
      return L.checkForUpdates;
  }
}

function updateItem(state: TrayState): MenuItemConstructorOptions {
  const { state: s } = state.updateStatus;
  const dev = !state.isPackaged || s === 'dev';
  const busy = s === 'checking' || s === 'downloading';
  const click = dev
    ? undefined
    : s === 'available'
      ? state.onDownloadUpdate
      : s === 'downloaded'
        ? state.onInstallUpdate
        : state.onCheckUpdate;
  return {
    label: updateItemLabel(state.updateStatus, state.isPackaged, state.labels),
    enabled: !dev && !busy,
    click,
  };
}

function snoozeSubmenu(state: TrayState): MenuItemConstructorOptions[] {
  const muted = state.dnd || snoozeActive(state);
  return [
    { label: state.labels.snoozeFor10, click: () => state.onSnooze(10) },
    { label: state.labels.snoozeFor30, click: () => state.onSnooze(30) },
    { label: state.labels.snoozeFor1Hour, click: () => state.onSnooze(60) },
    { type: 'separator' },
    {
      label: state.labels.snoozeUntilTurnedOn,
      type: 'checkbox',
      checked: state.dnd && !snoozeActive(state),
      click: () => state.onSnooze(null),
    },
    { label: state.labels.turnNotificationsOn, enabled: muted, click: () => state.onClearSnooze() },
  ];
}

export function trayMenuTemplate(state: TrayState): MenuItemConstructorOptions[] {
  return [
    { label: state.labels.open, click: state.onOpen },
    { type: 'separator' },
    { label: snoozeStatusLabel(state), submenu: snoozeSubmenu(state) },
    updateItem(state),
    {
      label: state.labels.startAtLogin,
      type: 'checkbox',
      checked: state.autoStart,
      click: () => state.onToggleAutoStart(!state.autoStart),
    },
    { type: 'separator' },
    { label: state.labels.quit, click: state.onQuit },
  ];
}

export function buildTrayMenu(state: TrayState): Menu {
  const { Menu } = require('electron') as typeof import('electron');
  return Menu.buildFromTemplate(trayMenuTemplate(state));
}

export function createTray(image: Electron.NativeImage, state: TrayState): Tray {
  const { Tray } = require('electron') as typeof import('electron');
  const tray = new Tray(image);
  tray.setToolTip('Gmail Desktop');
  tray.setContextMenu(buildTrayMenu(state));
  tray.on('click', state.onIconClick ?? state.onOpen);
  return tray;
}

export function updateTrayMenu(tray: Tray, state: TrayState): void {
  tray.setContextMenu(buildTrayMenu(state));
}
