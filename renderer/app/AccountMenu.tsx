'use client';

import { SURFACE_CONFIG, type Surface } from '../lib/surfaces';
import { APP_ICONS } from './app-icons';
import { CALENDAR_ICON_DATA_URI } from './calendar-icon-data';
import { TAB_MENU_WIDTH, tabMenuLeft } from './tab-menu';

// Het menu dat bij een rechtsklik op een tabblad opengaat: de agenda en de
// Google-apps van dát account. In de zijbalk stonden die knoppen zichtbaar;
// hier zijn ze verstopt, wat de prijs is voor een rustige balk.
//
// Vast gepositioneerd op de cursor, niet in het tabblad, zodat het menu niet
// door de horizontaal schuivende tabstrook wordt afgekapt.
//
// De lijst surfaces komt van buiten en is nooit leeg. Dat is geen detail: de
// balk vraagt main om de Gmail-views weg te duwen zodra dit menu opengaat, dus
// een component die zelf besluit niets te tekenen laat een leeg venster achter
// zonder iets om weg te klikken. Wie hier niets te kiezen heeft, opent het menu
// niet — zie Topbar.
export function AccountMenu({
  label,
  surfaces,
  x,
  y,
  activeSurface,
  onPick,
  onClose,
}: {
  label: string;
  surfaces: Surface[];
  x: number;
  y: number;
  activeSurface: Surface | null;
  onPick(surface: Surface): void;
  onClose(): void;
}) {
  // Een tabblad bij de rechterrand zou een menu naar rechts half buiten het
  // venster duwen; dan klapt het naar links open. innerWidth is CSS-pixels,
  // net als de cursorpositie, dus ook in Rene-modus (200% zoom) klopt de som.
  const left = tabMenuLeft(x, typeof window === 'undefined' ? Infinity : window.innerWidth);

  return (
    <>
      {/* Wegklik-vlak; vangt ook de rechtsklik zodat een tweede rechtsklik het
          menu sluit in plaats van er een tweede te openen. */}
      <div
        className="fixed inset-0 z-10"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="fixed z-20 rounded-lg border border-black/10 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-neutral-800"
        // De breedte staat in tab-menu.ts naast de plaatsing die ermee rekent.
        style={
          {
            left,
            top: y,
            width: TAB_MENU_WIDTH,
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties
        }
      >
        <div className="truncate px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
          {label}
        </div>
        {surfaces.map((s) => {
          const Icon = APP_ICONS[s];
          const isActive = activeSurface === s;
          return (
            <button
              key={s}
              onClick={() => onPick(s)}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm transition ${
                isActive
                  ? 'bg-black/10 text-neutral-900 dark:bg-white/15 dark:text-white'
                  : 'text-neutral-800 hover:bg-black/5 dark:text-neutral-100 dark:hover:bg-white/10'
              }`}
            >
              {s === 'calendar' ? (
                <img src={CALENDAR_ICON_DATA_URI} alt="" draggable={false} className="h-4 w-4 shrink-0" />
              ) : (
                Icon && <Icon className="h-4 w-4 shrink-0" />
              )}
              <span className="truncate">{SURFACE_CONFIG[s].label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
