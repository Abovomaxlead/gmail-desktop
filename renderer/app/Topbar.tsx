'use client';

import { useEffect, useRef, useState } from 'react';
import { AccountTab } from './AccountTab';
import { planOverflowMenu, stripMaskImage, tabLabelWidth } from './topbar-tabs';
import { planTabMenu, tabMenuChoices, TAB_MENU_NEW_WINDOW, TAB_MENU_TO_MAIN } from './tab-menu';
import { planPlusMenu, PLUS_ADD_ACCOUNT, PLUS_ADD_DELEGATED } from './plus-menu';
import { hasClickableItem, type NativeMenuItem } from '../lib/native-menu';
import { TOPBAR_HEIGHT } from '../lib/topbar';
import { accountCountVisible } from '../lib/badge-visibility';
import { pinnedSurfacesFor, surfaceLabel } from '../lib/google-apps';
import { openableSurfaces } from '../lib/surfaces';
import { SURFACE_ICON_DATA_URIS } from '../lib/surface-icon-data';
import type { UiStrings } from './strings';
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
/** The overflow button's own room: an icon, its count and the gap before it */
const OVERFLOW_BUTTON = 38 + GAP;


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
  S,
  demoPinned,
  onOpen,
  onPopupMenu,
  onAddAccount,
  onAddDelegated,
  onOpenSettings,
  onOpenFeedback,
  onInstallUpdate,
  onReorder,
  detached,
  onTabDragStart,
  onTabDragEnd,
  onTabDropped,
  onTabToNewWindow,
  onTabToMainWindow,
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
  S: UiStrings;
  onOpen(key: string, surface: Surface): void;
  onPopupMenu(items: NativeMenuItem[], anchor?: { x: number; y: number }): Promise<string | null>;
  onAddAccount(): void;
  onAddDelegated(): void;
  onOpenSettings(): void;
  onOpenFeedback(): void;
  onInstallUpdate(): void;
  onReorder(fromEmail: string, toEmail: string): void;
  /** True in a window made by dragging a tab out, which draws its tabs and nothing else. */
  detached: boolean;
  /** A tab drag started here, so main knows what a drop somewhere else is about. */
  onTabDragStart(key: string): void;
  /** The drag ended. `dropped` false means it was let go over nothing of ours, which is what
   * gives the tab a window of its own. */
  onTabDragEnd(dropped: boolean): void;
  /** A tab from another window was dropped on this strip. */
  onTabDropped(): void;
  /** The menu asked for this tab to get a window of its own. */
  onTabToNewWindow(key: string): void;
  /** The menu asked for this tab to go back to the main window. */
  onTabToMainWindow(key: string): void;
}) {
  const [dragEmail, setDragEmail] = useState<string | null>(null);
  const [offScreen, setOffScreen] = useState<Set<string>>(new Set());
  /** Whether the strip has been scrolled away from its first tab */
  const [scrolledOff, setScrolledOff] = useState(false);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const updateReady = update.state === 'downloaded';
  const activeProfile = active ? (profiles.find((p) => p.key === active.key) ?? null) : null;
  const labelWidth = tabLabelWidth(profiles.length);
  const pinned = activeProfile
    ? pinnedSurfacesFor(prefs?.googleApps.pinned ?? [], openableSurfaces(activeProfile))
    : [];

  async function openPlusMenu(): Promise<void> {
    const picked = await onPopupMenu(planPlusMenu({ strings: S }));
    if (picked === PLUS_ADD_ACCOUNT) return onAddAccount();
    if (picked === PLUS_ADD_DELEGATED) return onAddDelegated();
  }

  async function openTabMenu(p: Profile): Promise<void> {
    const choices = tabMenuChoices(p);
    const items = planTabMenu(labelFor(p), choices, {
      // The last tab in a window has nowhere to go: the window it would get is the window it
      // is already in.
      canDetach: profiles.length > 1,
      canReturn: detached,
      newWindowLabel: S.tabNewWindow,
      toMainLabel: S.tabToMainWindow,
    });
    if (!hasClickableItem(items)) return;
    const picked = await onPopupMenu(items);
    if (picked === TAB_MENU_NEW_WINDOW) return onTabToNewWindow(p.key);
    if (picked === TAB_MENU_TO_MAIN) return onTabToMainWindow(p.key);
    const surface = choices.find((s) => s === picked);
    if (surface) onOpen(p.key, surface);
  }

  // Which tabs are not fully in the strip. Watched rather than measured on a timer: the
  // observer fires on scrolling, on resizing and on a tab appearing, which is every way the
  // answer can change.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const seen = new IntersectionObserver(
      (entries) => {
        setOffScreen((cur) => {
          const next = new Set(cur);
          for (const entry of entries) {
            const key = (entry.target as HTMLElement).dataset.tabKey;
            if (!key) continue;
            if (entry.intersectionRatio > 0.99) next.delete(key);
            else next.add(key);
          }
          return next;
        });
      },
      { root: strip, threshold: [0.99] },
    );
    for (const tab of strip.querySelectorAll('[data-tab-key]')) seen.observe(tab);
    return () => seen.disconnect();
  }, [profiles]);

  // The account that was just opened may be one of the ones off the edge -- opened from the
  // sidebar, a notification, or the overflow menu itself. Bringing it into view is what keeps
  // the strip from contradicting the window behind it.
  useEffect(() => {
    if (!active) return;
    stripRef.current
      ?.querySelector(`[data-tab-key="${CSS.escape(active.key)}"]`)
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [active?.key]);

  const hidden = profiles.filter((p) => offScreen.has(p.key));
  const stripMask = stripMaskImage(scrolledOff, hidden.length > 0);

  async function openOverflowMenu(): Promise<void> {
    const picked = await onPopupMenu(
      planOverflowMenu(
        hidden.map((p) => ({ key: p.key, label: labelFor(p), unread: unread[p.key] ?? 0 })),
      ),
    );
    const chosen = hidden.find((p) => p.key === picked);
    if (chosen) onOpen(chosen.key, 'mail');
  }

  return (
    <div
      className="relative shrink-0 select-none bg-neutral-100 dark:bg-neutral-950"
      style={{ height: TOPBAR_HEIGHT, WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div style={AREA} className="flex items-center gap-1 pl-2">
        <div
          ref={stripRef}
          data-tour="tabs"
          className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={(e) => setScrolledOff(e.currentTarget.scrollLeft > 1)}
          // The strip as a whole takes drops, not only the tabs in it: a tab dragged from
          // another window is aimed at the row, and the gap past the last tab is most of the
          // row in a window with two mailboxes in it.
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (!dragEmail) onTabDropped();
            setDragEmail(null);
          }}
          style={{
            maxWidth: `calc(100% - ${
              // A torn-off window has no plus, gear, feedback or update button, so the strip
              // gets that room back and only the window's own buttons stay reserved.
              (detached
                ? DRAG_RESERVE + GAP
                : updateReady
                  ? RESERVE_WITH_UPDATE
                  : RESERVE_WITHOUT_UPDATE) +
              (hidden.length > 0 ? OVERFLOW_BUTTON : 0) +
              (pinned.length + demoPinned.length) * PINNED_BUTTON
            }px)`,
            // A tab sliced down the middle at an edge reads as a drawing error. Fading the cut
            // stretch says the row continues there -- on the right that is what the button
            // beside it is for, on the left it is where the strip has been scrolled away from.
            ...(stripMask ? { maskImage: stripMask, WebkitMaskImage: stripMask } : {}),
            ...NO_DRAG,
          }}
        >
          {profiles.map((p) => (
            <AccountTab
              key={p.key}
              profile={p}
              label={labelFor(p)}
              labelWidth={labelWidth}
              unread={unread[p.key] ?? 0}
              showUnread={accountCountVisible(
                prefs?.accounts[p.email]?.badgeCount,
                prefs?.appearance.showUnreadBadges,
              )}
              active={active?.key === p.key}
              activeSurface={active?.key === p.key ? active.surface : null}
              dragging={dragEmail === p.email}
              strings={S}
              onOpen={() => onOpen(p.key, 'mail')}
              onMenu={() => void openTabMenu(p)}
              onDragStart={() => {
                setDragEmail(p.email);
                onTabDragStart(p.key);
              }}
              onDrop={() => {
                // A drag that started in this window is a reorder; one that did not is a tab
                // arriving from another window, and main knows which mailbox that is.
                if (dragEmail) onReorder(dragEmail, p.email);
                else onTabDropped();
                setDragEmail(null);
              }}
              onDragEnd={(e) => {
                setDragEmail(null);
                // Let go over nothing that took it -- the desktop, another app, or the mail
                // view itself -- is what asks for a window of its own.
                onTabDragEnd(e.dataTransfer?.dropEffect !== 'none');
              }}
            />
          ))}
        </div>

        {/* Only when something is actually out of sight, so a window with three accounts has
            nothing extra in it. The number is the point: it says how much is not on screen. */}
        {hidden.length > 0 && (
          <button
            onClick={() => void openOverflowMenu()}
            title={S.moreAccounts(hidden.length)}
            aria-label={S.moreAccounts(hidden.length)}
            style={NO_DRAG}
            className="flex h-[26px] shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium text-neutral-500 transition hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <ChevronsIcon className="h-3.5 w-3.5" />
            {hidden.length}
          </button>
        )}

        {/* Adding an account, the update button, feedback and settings belong to the main
            window: there is one of each, and a window holding two mailboxes is not where the
            account list is managed from. A torn-off window keeps its tabs and its pinned
            apps, which are the two things that are about the mailbox in front of you. */}
        {!detached && (
          <div className="relative shrink-0" style={NO_DRAG}>
            <button
              data-tour="add"
              onClick={() => void openPlusMenu()}
              title={S.addAccountTooltip}
              className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-neutral-500 transition hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <PlusIcon className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="min-w-[60px] flex-1" />

        {updateReady && !detached && (
          <button
            onClick={onInstallUpdate}
            title={S.updateReady}
            style={{ maxWidth: UPDATE_BUTTON, ...NO_DRAG }}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1 text-[12px] font-medium text-white transition hover:bg-blue-700"
          >
            <span className="min-w-0 truncate">{S.updateReady}</span>
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
        {!detached && (
          <button
            data-tour="feedback"
            onClick={onOpenFeedback}
            title={S.feedbackTooltip}
            aria-label={S.feedbackTooltip}
            style={NO_DRAG}
            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-neutral-500 transition hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <FeedbackIcon className="h-4 w-4" />
          </button>
        )}
        {!detached && (
          <button
            data-tour="gear"
            onClick={onOpenSettings}
            title={S.settingsTooltip}
            style={NO_DRAG}
            className={`mr-1 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md transition ${
              settingsOpen
                ? 'bg-black/10 text-neutral-900 dark:bg-white/15 dark:text-white'
                : 'text-neutral-500 hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white'
            }`}
          >
            <GearIcon className="h-4 w-4" />
          </button>
        )}
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

function ChevronsIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m7 6 6 6-6 6M14 6l6 6-6 6" />
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
