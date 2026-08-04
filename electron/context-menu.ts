// Right-click menu for every webContents in the app (sidebar, Gmail/Calendar views,
// compose and pop-out windows). Chromium's own context menu is not available to an
// Electron app, so without this a right-click does nothing at all.
//
// planContextMenu is pure data and attachContextMenu turns it into a native Menu, so
// the item logic is testable without Electron. An editable field gets the full edit
// menu; everything else gets only what applies to what was clicked, and nothing
// clicked means an empty plan and no menu rather than greyed-out items. The edit
// commands act on `webContents` directly instead of via menu roles, so they hit the
// view that was clicked and not whatever Chromium considers focused. "Open link" goes
// through the same gate as a link in a mail, so Phishing Protection still asks; the
// Google search URL the app builds itself does not.

import { Menu, clipboard, shell, type WebContents, type MenuItemConstructorOptions } from 'electron';
import { openExternalLink } from './external-links';

export interface ContextMenuInput {
  isEditable: boolean;
  selectionText: string;
  linkURL: string;
  mediaType: string;
  srcURL: string;
  editFlags: {
    canUndo: boolean;
    canRedo: boolean;
    canCut: boolean;
    canCopy: boolean;
    canPaste: boolean;
    canSelectAll: boolean;
  };
}

export type ContextMenuActionId =
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'pasteMatchStyle'
  | 'selectAll'
  | 'copyLink'
  | 'openLink'
  | 'copyImage'
  | 'copyImageAddress'
  | 'searchGoogle';

export type PlannedItem =
  | { kind: 'separator' }
  | { kind: 'action'; id: ContextMenuActionId; enabled: boolean };

const SEP: PlannedItem = { kind: 'separator' };
const act = (id: ContextMenuActionId, enabled = true): PlannedItem => ({ kind: 'action', id, enabled });

export function planContextMenu(p: ContextMenuInput): PlannedItem[] {
  const f = p.editFlags;
  if (p.isEditable) {
    return [
      act('undo', f.canUndo),
      act('redo', f.canRedo),
      SEP,
      act('cut', f.canCut),
      act('copy', f.canCopy),
      act('paste', f.canPaste),
      act('pasteMatchStyle', f.canPaste),
      SEP,
      act('selectAll', f.canSelectAll),
    ];
  }

  const items: PlannedItem[] = [];
  const hasSelection = p.selectionText.trim().length > 0;
  if (hasSelection) items.push(act('copy', f.canCopy), act('searchGoogle'));
  if (p.linkURL) {
    if (items.length) items.push(SEP);
    items.push(act('copyLink'), act('openLink'));
  }
  if (p.mediaType === 'image' && p.srcURL) {
    if (items.length) items.push(SEP);
    items.push(act('copyImage'), act('copyImageAddress'));
  }
  if (items.length) items.push(SEP, act('selectAll', f.canSelectAll));
  return items;
}

export type ContextMenuLabels = Record<ContextMenuActionId, string>;

export const LABELS_NORMAL: ContextMenuLabels = {
  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  pasteMatchStyle: 'Paste without formatting',
  selectAll: 'Select all',
  copyLink: 'Copy link address',
  openLink: 'Open link in browser',
  copyImage: 'Copy image',
  copyImageAddress: 'Copy image address',
  searchGoogle: 'Search Google for “%s”',
};

export const LABELS_RENE: ContextMenuLabels = {
  undo: 'Terug',
  redo: 'Toch weer',
  cut: 'Knippen',
  copy: 'Kopiëren',
  paste: 'Plakken',
  pasteMatchStyle: 'Plakken zonder opmaak',
  selectAll: 'Alles kiezen',
  copyLink: 'Link kopiëren',
  openLink: 'Link openen',
  copyImage: 'Plaatje kopiëren',
  copyImageAddress: 'Link van plaatje kopiëren',
  searchGoogle: 'Zoek “%s” op Google',
};

const SEARCH_LABEL_MAX = 25;

export function searchMenuLabel(selectionText: string, template: string): string {
  const flat = selectionText.trim().replace(/\s+/g, ' ');
  const shown = flat.length > SEARCH_LABEL_MAX ? `${flat.slice(0, SEARCH_LABEL_MAX)}…` : flat;
  return template.replace('%s', shown);
}

export function googleSearchUrl(selectionText: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(selectionText.trim())}`;
}

export function attachContextMenu(webContents: WebContents, getLabels: () => ContextMenuLabels): void {
  webContents.on('context-menu', (_event, params) => {
    const plan = planContextMenu({
      isEditable: params.isEditable,
      selectionText: params.selectionText,
      linkURL: params.linkURL,
      mediaType: params.mediaType,
      srcURL: params.srcURL,
      editFlags: params.editFlags,
    });
    if (plan.length === 0) return;

    const L = getLabels();
    const clicks: Record<ContextMenuActionId, () => void> = {
      undo: () => webContents.undo(),
      redo: () => webContents.redo(),
      cut: () => webContents.cut(),
      copy: () => webContents.copy(),
      paste: () => webContents.paste(),
      pasteMatchStyle: () => webContents.pasteAndMatchStyle(),
      selectAll: () => webContents.selectAll(),
      copyLink: () => clipboard.writeText(params.linkURL),
      openLink: () => openExternalLink(params.linkURL),
      copyImage: () => webContents.copyImageAt(params.x, params.y),
      copyImageAddress: () => clipboard.writeText(params.srcURL),
      searchGoogle: () => void shell.openExternal(googleSearchUrl(params.selectionText)),
    };

    const template: MenuItemConstructorOptions[] = plan.map((item) =>
      item.kind === 'separator'
        ? { type: 'separator' }
        : {
            label:
              item.id === 'searchGoogle'
                ? searchMenuLabel(params.selectionText, L.searchGoogle)
                : L[item.id],
            enabled: item.enabled,
            click: clicks[item.id],
          },
    );
    Menu.buildFromTemplate(template).popup();
  });
}
