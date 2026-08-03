'use client';

import type { Surface } from '../lib/surfaces';
import { APP_ICONS } from './app-icons';
import { CALENDAR_ICON_DATA_URI } from './calendar-icon-data';
import { unreadLabel } from './unread-label';
import type { Profile } from './page';

// Het gedelegeerd-icoontje: in de zijbalk was dit een hoekmarkering op de
// avatar, hier staat het vóór de naam. Het icoontje zelf is aria-hidden; wat het
// betekent staat in de tooltip van het tabblad, want een markering zonder uitleg
// is een raadseltje.
function DelegatedIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
    </svg>
  );
}

// Het icoontje van de surface waar dit account op staat. De zijbalk had per
// account een eigen knop per surface en liet daarmee zien waar je was; met één
// tabblad per account is dat weg, en staat de agenda van een account er precies
// zo bij als zijn post. Dus: staat het account op iets anders dan mail, dan
// draagt het tabblad dat icoontje. Dezelfde bronnen als het rechtsklikmenu.
function SurfaceIcon({ surface, className = '' }: { surface: Surface; className?: string }) {
  if (surface === 'calendar') {
    return <img src={CALENDAR_ICON_DATA_URI} alt="" draggable={false} className={className} />;
  }
  const Icon = APP_ICONS[surface];
  return Icon ? <Icon className={className} /> : null;
}

// Eén tabblad. Het actieve tabblad is aan twee dingen te zien: een gevulde
// achtergrond, én de accountkleur als streepje langs de onderrand. Beide zijn
// nodig — alleen de kleur is te zwak bij een gedempte accountkleur, en alleen de
// achtergrond gooit de kleurcodering weg die de zijbalk had.
export function AccountTab({
  profile,
  label,
  unread,
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
  unread: number;
  active: boolean;
  // De surface waar dít account op staat, of null als het niet het actieve
  // account is. `mail` toont geen icoontje: dat is de gewone stand.
  activeSurface: Surface | null;
  dragging: boolean;
  strings: { delegatedTooltipSuffix: string; numberLocale: string };
  onOpen(): void;
  onMenu(x: number, y: number): void;
  onDragStart(): void;
  onDrop(): void;
  onDragEnd(): void;
}) {
  const delegated = profile.kind === 'delegated';
  const surface = activeSurface && activeSurface !== 'mail' ? activeSurface : null;
  return (
    <button
      draggable
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      title={delegated ? `${profile.email} ${strings.delegatedTooltipSuffix}` : profile.email}
      // no-drag: zonder dit is het tabblad onderdeel van het sleepgebied van het
      // venster en is het niet aan te klikken.
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      className={`group relative flex h-[30px] shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] transition ${
        active
          ? 'bg-black/10 text-neutral-900 dark:bg-white/15 dark:text-white'
          : 'text-neutral-600 hover:bg-black/5 dark:text-neutral-400 dark:hover:bg-white/10'
      } ${dragging ? 'opacity-40' : ''}`}
    >
      {delegated && <DelegatedIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />}
      {surface && <SurfaceIcon surface={surface} className="h-3.5 w-3.5 shrink-0" />}
      <span className="max-w-[160px] truncate">{label}</span>
      {unread > 0 && (
        <span className="shrink-0 rounded-full bg-blue-500 px-1.5 text-[10px] font-bold leading-[15px] text-white">
          {unreadLabel(unread, strings.numberLocale)}
        </span>
      )}
      {/* De accountkleur. Vol bij het actieve tabblad, gedempt bij de rest. */}
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
