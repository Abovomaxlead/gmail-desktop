'use client';

import { useEffect, useState } from 'react';
import { AccountTab } from './AccountTab';
import { planTabMenu, tabMenuChoices } from './tab-menu';
import { planPlusMenu, PLUS_ADD_ACCOUNT, PLUS_ADD_DELEGATED } from './plus-menu';
import { hasClickableItem, type NativeMenuItem } from '../lib/native-menu';
import { TOPBAR_HEIGHT } from '../lib/topbar';
import { accountCountVisible } from '../lib/badge-visibility';
import { pinnedSurfacesFor, surfaceLabel } from '../lib/google-apps';
import { openableSurfaces } from '../lib/surfaces';
import { playSound } from '../lib/notification-sound';
import { SURFACE_ICON_DATA_URIS } from '../lib/surface-icon-data';
import type { Profile, Surface, UpdateStatus, Prefs } from './page';

// The bar is the window's own title bar, which sets two rules for this file. The empty
// middle is the drag region, so every control needs `no-drag` or it cannot be clicked. And
// the real window buttons are an Electron overlay whose position Chromium reports through
// env(titlebar-area-*), so AREA fills exactly that region rather than guessing per platform.
//
// The tab strip's maxWidth reserves the space to its right, computed from the parts rather
// than as one number, so whoever adds a control cannot forget to count it. Reserve too
// little and the gear slides under the window overlay, which is not ours to click.


//===========================
// Constants
//===========================

const AREA: React.CSSProperties = {
  position: 'absolute',
  left: 'env(titlebar-area-x, 0px)',
  top: 'env(titlebar-area-y, 0px)',
  width: 'env(titlebar-area-width, 100%)',
  height: `env(titlebar-area-height, ${TOPBAR_HEIGHT}px)`,
};

const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

const GAP = 4;
const ICON_BUTTON = 26;
const GEAR_MARGIN = 4;
const UPDATE_BUTTON = 104;
const DRAG_RESERVE = 60;

const RESERVE_WITHOUT_UPDATE = DRAG_RESERVE + ICON_BUTTON + ICON_BUTTON + GEAR_MARGIN + GAP * 3;
const RESERVE_WITH_UPDATE = RESERVE_WITHOUT_UPDATE + UPDATE_BUTTON + GAP;

const PINNED_BUTTON = ICON_BUTTON + GAP;


//===========================
// Component
//===========================

export function Topbar({
  profiles,
  unread,
  prefs,
  active,
  labelFor,
  settingsOpen,
  update,
  strings,
  demoPinned,
  onOpen,
  onPopupMenu,
  onAddAccount,
  onAddDelegated,
  onOpenSettings,
  onOpenFeedback,
  onInstallUpdate,
  onReorder,
}: {
  profiles: Profile[];
  unread: Record<string, number>;
  prefs: Prefs | null;
  active: { key: string; surface: Surface } | null;
  labelFor(p: Profile): string;
  settingsOpen: boolean;
  update: UpdateStatus;
  /** Google apps the tour borrows for the bar while nothing real is pinned. */
  demoPinned: readonly Surface[];
  strings: { feedbackTooltip: string; addAccountTooltip: string; addAccountLabel: string; addDelegatedLabel: string; settingsTooltip: string; updateReady: string; delegatedTooltipSuffix: string; delegatedNeedsClick: string; numberLocale: string };
  onOpen(key: string, surface: Surface): void;
  onPopupMenu(items: NativeMenuItem[]): Promise<string | null>;
  onAddAccount(): void;
  onAddDelegated(): void;
  onOpenSettings(): void;
  onOpenFeedback(): void;
  onInstallUpdate(): void;
  onReorder(fromEmail: string, toEmail: string): void;
}) {
  const [dragEmail, setDragEmail] = useState<string | null>(null);
  const updateReady = update.state === 'downloaded';
  const activeProfile = active ? (profiles.find((p) => p.key === active.key) ?? null) : null;
  const pinned = activeProfile
    ? pinnedSurfacesFor(prefs?.googleApps.pinned ?? [], openableSurfaces(activeProfile))
    : [];

  useEffect(() => {
    window.desktop?.onPlayNotificationSound(({ name, volume }) => {
      playSound(name, volume);
    });
  }, []);

  async function openPlusMenu(): Promise<void> {
    const picked = await onPopupMenu(planPlusMenu({ strings }));
    if (picked === PLUS_ADD_ACCOUNT) return onAddAccount();
    if (picked === PLUS_ADD_DELEGATED) return onAddDelegated();
  }

  async function openTabMenu(p: Profile): Promise<void> {
    const choices = tabMenuChoices(p);
    const items = planTabMenu(labelFor(p), choices);
    if (!hasClickableItem(items)) return;
    const picked = await onPopupMenu(items);
    const surface = choices.find((s) => s === picked);
    if (surface) onOpen(p.key, surface);
  }

  return (
    <div
      className="relative shrink-0 select-none bg-neutral-100 dark:bg-neutral-950"
      style={{ height: TOPBAR_HEIGHT, WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div style={AREA} className="flex items-center gap-1 pl-2">
        <div
          data-tour="tabs"
          className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{
            maxWidth: `calc(100% - ${
              (updateReady ? RESERVE_WITH_UPDATE : RESERVE_WITHOUT_UPDATE) +
              (pinned.length + demoPinned.length) * PINNED_BUTTON
            }px)`,
            ...NO_DRAG,
          }}
        >
          {profiles.map((p) => (
            <AccountTab
              key={p.key}
              profile={p}
              label={labelFor(p)}
              unread={unread[p.key] ?? 0}
              showUnread={accountCountVisible(
                prefs?.accounts[p.email]?.badgeCount,
                prefs?.appearance.showUnreadBadges,
              )}
              active={active?.key === p.key}
              activeSurface={active?.key === p.key ? active.surface : null}
              dragging={dragEmail === p.email}
              strings={strings}
              onOpen={() => onOpen(p.key, 'mail')}
              onMenu={() => void openTabMenu(p)}
              onDragStart={() => setDragEmail(p.email)}
              onDrop={() => {
                if (dragEmail) onReorder(dragEmail, p.email);
                setDragEmail(null);
              }}
              onDragEnd={() => setDragEmail(null)}
            />
          ))}
        </div>

        <div className="relative shrink-0" style={NO_DRAG}>
          <button
            data-tour="add"
            onClick={() => void openPlusMenu()}
            title={strings.addAccountTooltip}
            className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-neutral-500 transition hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="min-w-[60px] flex-1" />

        {updateReady && (
          <button
            onClick={onInstallUpdate}
            title={strings.updateReady}
            style={{ maxWidth: UPDATE_BUTTON, ...NO_DRAG }}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1 text-[12px] font-medium text-white transition hover:bg-blue-700"
          >
            <span className="min-w-0 truncate">{strings.updateReady}</span>
          </button>
        )}
        {pinned.map((surface, i) => (
          <button
            key={surface}
            data-tour={i === 0 ? 'pinned' : undefined}
            onClick={() => active && onOpen(active.key, surface)}
            disabled={!active}
            title={surfaceLabel(surface)}
            aria-label={surfaceLabel(surface)}
            style={NO_DRAG}
            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10"
          >
            <img
              src={SURFACE_ICON_DATA_URIS[surface]}
              alt=""
              aria-hidden
              className="h-4 w-4 object-contain"
            />
          </button>
        ))}
        {/* The tour's stand-in when nothing is pinned. It draws exactly like a real one, and
            takes the data-tour anchor when there is no real button to carry it. Pointer events
            are off rather than disabled: disabled would fade it to 40% and misrepresent what a
            pinned app looks like. */}
        {demoPinned.map((surface, i) => (
          <button
            key={`demo-${surface}`}
            data-tour={pinned.length === 0 && i === 0 ? 'pinned' : undefined}
            type="button"
            tabIndex={-1}
            aria-hidden
            title={surfaceLabel(surface)}
            style={{ ...NO_DRAG, pointerEvents: 'none' }}
            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md"
          >
            <img
              src={SURFACE_ICON_DATA_URIS[surface]}
              alt=""
              aria-hidden
              className="h-4 w-4 object-contain"
            />
          </button>
        ))}
        <button
          data-tour="feedback"
          onClick={onOpenFeedback}
          title={strings.feedbackTooltip}
          aria-label={strings.feedbackTooltip}
          style={NO_DRAG}
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-neutral-500 transition hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white"
        >
          <FeedbackIcon className="h-4 w-4" />
        </button>
        <button
          data-tour="gear"
          onClick={onOpenSettings}
          title={strings.settingsTooltip}
          style={NO_DRAG}
          className={`mr-1 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md transition ${
            settingsOpen
              ? 'bg-black/10 text-neutral-900 dark:bg-white/15 dark:text-white'
              : 'text-neutral-500 hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white'
          }`}
        >
          <GearIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}


//===========================
// Icons
//===========================

function PlusIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function FeedbackIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
    </svg>
  );
}

function GearIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09A1.65 1.65 0 0 0 9 4.6V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
