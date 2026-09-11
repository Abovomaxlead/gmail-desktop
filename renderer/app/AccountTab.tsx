'use client';

import type { Surface } from '../lib/surfaces';
import { APP_ICONS } from './app-icons';
import { CALENDAR_ICON_DATA_URI } from '../lib/calendar-icon-data';
import { unreadLabel } from './unread-label';
import { Avatar } from './Avatar';
import { TAB_AVATAR_ONLY } from './topbar-tabs';
import type { Profile } from './page';


//===========================
// Component
//===========================

export function AccountTab({
  profile,
  label,
  labelWidth,
  unread,
  showUnread,
  active,
  activeSurface,
  dragging,
  strings,
  onOpen,
  onMenu,
  onDragStart,
  onDrop,
  onDragEnd,
}: {
  profile: Profile;
  label: string;
  /** How wide the name may be, from tabLabelWidth; TAB_AVATAR_ONLY draws the avatar alone */
  labelWidth: number;
  unread: number;
  showUnread: boolean;
  active: boolean;
  activeSurface: Surface | null;
  dragging: boolean;
  strings: { delegatedTooltipSuffix: string; delegatedNeedsClick: string; numberLocale: string };
  onOpen(): void;
  onMenu(): void;
  onDragStart(): void;
  onDrop(): void;
  onDragEnd(): void;
}) {
  const delegated = profile.kind === 'delegated';
  const needsUrl = delegated && profile.hasMail === false;
  const surface = activeSurface && activeSurface !== 'mail' ? activeSurface : null;
  const named = labelWidth > TAB_AVATAR_ONLY;
  const badge = showUnread && unread > 0;
  return (
    <button
      draggable
      data-tab-key={profile.key}
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu();
      }}
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      title={
        needsUrl
          ? `${profile.email} — ${strings.delegatedNeedsClick}`
          : delegated
            ? `${profile.email} ${strings.delegatedTooltipSuffix}`
            : profile.email
      }
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      className={`group relative flex h-[30px] shrink-0 items-center gap-1.5 rounded-md text-[13px] transition ${
        named ? 'px-2.5' : 'px-1.5'
      } ${
        active
          ? 'bg-black/10 text-neutral-900 dark:bg-white/15 dark:text-white'
          : 'text-neutral-600 hover:bg-black/5 dark:text-neutral-400 dark:hover:bg-white/10'
      } ${dragging ? 'opacity-40' : ''} ${needsUrl ? 'opacity-50' : ''}`}
    >
      {/* Without a name the avatar is the account: its picture, its colour, its first letter.
          A delegated mailbox keeps its mark on top of that, since the two kinds must not look
          alike once the address is gone. */}
      {!named && (
        <span className="relative flex shrink-0 items-center">
          <Avatar url={profile.avatarUrl} color={profile.color} name={label} size="sm" />
          {delegated && (
            <DelegatedIcon className="absolute -bottom-px -right-px h-3 w-3 rounded-full bg-neutral-100 p-px text-neutral-700 dark:bg-neutral-950 dark:text-neutral-300" />
          )}
          {badge && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-blue-500 ring-2 ring-neutral-100 dark:ring-neutral-950"
            />
          )}
        </span>
      )}
      {named && delegated && <DelegatedIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />}
      {surface && <SurfaceIcon surface={surface} className="h-3.5 w-3.5 shrink-0" />}
      {named && (
        <span className="truncate" style={{ maxWidth: labelWidth }}>
          {label}
        </span>
      )}
      {named && badge && (
        <span className="shrink-0 rounded-full bg-blue-500 px-1.5 text-[10px] font-bold leading-[15px] text-white">
          {unreadLabel(unread, strings.numberLocale)}
        </span>
      )}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-x-1.5 bottom-0 h-[3px] rounded-t-sm transition-opacity ${
          active ? 'opacity-100' : 'opacity-30 group-hover:opacity-60'
        }`}
        style={{ backgroundColor: profile.color }}
      />
    </button>
  );
}


//===========================
// Icons
//===========================

// One account tab. The active one is marked twice over — a filled background and a strip of
// the account colour along the bottom edge — because a muted colour alone is too weak.
//
// `showUnread` is the per-account Badge checkbox, the same question accountCountVisible
// asks. Without `-webkit-app-region: no-drag` the tab is part of the window's drag region
// and cannot be clicked at all.
function DelegatedIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
    </svg>
  );
}

function SurfaceIcon({ surface, className = '' }: { surface: Surface; className?: string }) {
  if (surface === 'calendar') {
    return <img src={CALENDAR_ICON_DATA_URI} alt="" draggable={false} className={className} />;
  }
  const Icon = APP_ICONS[surface];
  return Icon ? <Icon className={className} /> : null;
}
