'use client';

import { useState } from 'react';
import { AccountTab } from './AccountTab';
import { planTabMenu, tabMenuChoices } from './tab-menu';
import { planPlusMenu, suggestionEmail, PLUS_ADD_ACCOUNT, PLUS_ADD_DELEGATED } from './plus-menu';
import { hasClickableItem, type NativeMenuItem } from '../lib/native-menu';
import { TOPBAR_HEIGHT } from '../lib/topbar';
import type { Profile, Surface, DelegatedSuggestion, UpdateStatus } from './page';

// De balk ís de titelbalk van het venster. Twee regels beheersen dit bestand:
//
// 1. Het lege middenstuk heeft `-webkit-app-region: drag` — daaraan pak je het
//    venster op. Elk knopje moet `no-drag` hebben, anders is het niet
//    aanklikbaar. Daarom staat alle balkinhoud hier: één plek voor die regel.
// 2. De echte vensterknoppen zijn een overlay van Electron. Waar die staat
//    vertelt Chromium via env(titlebar-area-*): op Windows rechts, op macOS
//    links. De inhoud vult precies dat gebied, dus we hoeven geen breedte per
//    platform of schaalfactor te raden. De fallbacks (0 en 100%) gelden op Linux,
//    waar er geen overlay is.
const AREA: React.CSSProperties = {
  position: 'absolute',
  left: 'env(titlebar-area-x, 0px)',
  top: 'env(titlebar-area-y, 0px)',
  width: 'env(titlebar-area-width, 100%)',
  height: `env(titlebar-area-height, ${TOPBAR_HEIGHT}px)`,
};

const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

// De maten van de balk, zodat de tabstrook precies weet hoeveel ruimte hij
// rechts van zich moet vrijlaten. Reserveert de strook te weinig, dan schuift
// het tandwiel onder de vensterknoppen van Electron: dat is een overlay die
// niet van ons is, dus daar valt niets meer aan te klikken. Reken de reservering
// daarom uit deze onderdelen in plaats van er één getal van te maken — anders
// vergeet de volgende die er iets bij zet om het bij te tellen.
const GAP = 4; // gap-1 tussen de kinderen van de balk
const ICON_BUTTON = 26; // h-/w-[26px] van de "+" en het tandwiel
const GEAR_MARGIN = 4; // mr-1 rechts van het tandwiel
const UPDATE_BUTTON = 104; // maxWidth van de updateknop; de tekst kapt af, hij groeit niet
const DRAG_RESERVE = 60; // minimale sleepruimte, anders is het venster niet te verplaatsen

// Zonder updateknop staan er drie gaten rechts van de strook (strook↔"+",
// "+"↔rekstrook, rekstrook↔tandwiel); mét de knop een vierde.
const RESERVE_WITHOUT_UPDATE = DRAG_RESERVE + ICON_BUTTON + ICON_BUTTON + GEAR_MARGIN + GAP * 3;
const RESERVE_WITH_UPDATE = RESERVE_WITHOUT_UPDATE + UPDATE_BUTTON + GAP;

function PlusIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className={className}>
      <path d="M12 5v14M5 12h14" />
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

export function Topbar({
  profiles,
  unread,
  active,
  labelFor,
  settingsOpen,
  update,
  strings,
  suggestions,
  scanning,
  scanDone,
  onOpen,
  onPopupMenu,
  onAddAccount,
  onAddDelegated,
  onAcceptSuggestion,
  onOpenSettings,
  onInstallUpdate,
  onReorder,
}: {
  profiles: Profile[];
  unread: Record<string, number>;
  active: { key: string; surface: Surface } | null;
  labelFor(p: Profile): string;
  settingsOpen: boolean;
  update: UpdateStatus;
  strings: { addAccountTooltip: string; addAccountLabel: string; addDelegatedLabel: string; delegatedScanning: string; delegatedSuggestionsHeading: string; delegatedNoneFound: string; settingsTooltip: string; updateReady: string; delegatedTooltipSuffix: string; numberLocale: string };
  suggestions: DelegatedSuggestion[];
  scanning: boolean;
  scanDone: boolean;
  onOpen(key: string, surface: Surface): void;
  // Laat main een echt OS-menu openen en levert het gekozen id, of null als er
  // weggeklikt is. Beide menu's van de balk lopen hierlangs: een menu dat deze
  // pagina zelf tekent valt achter de Gmail-view, want die is een native laag
  // erboven.
  onPopupMenu(items: NativeMenuItem[]): Promise<string | null>;
  onAddAccount(): void;
  onAddDelegated(): void;
  onAcceptSuggestion(s: DelegatedSuggestion): void;
  onOpenSettings(): void;
  onInstallUpdate(): void;
  onReorder(fromEmail: string, toEmail: string): void;
}) {
  const [dragEmail, setDragEmail] = useState<string | null>(null);
  // Alleen om het telbolletje te verbergen zolang het menu open staat; het menu
  // zelf is van het OS en houdt zijn eigen toestand bij.
  const [plusOpen, setPlusOpen] = useState(false);
  const updateReady = update.state === 'downloaded';

  async function openPlusMenu(): Promise<void> {
    setPlusOpen(true);
    const picked = await onPopupMenu(
      planPlusMenu({ strings, suggestions, scanning, scanDone }),
    );
    setPlusOpen(false);
    if (picked === PLUS_ADD_ACCOUNT) return onAddAccount();
    if (picked === PLUS_ADD_DELEGATED) return onAddDelegated();
    const email = picked ? suggestionEmail(picked) : null;
    const suggestion = suggestions.find((s) => s.email === email);
    if (suggestion) onAcceptSuggestion(suggestion);
  }

  async function openTabMenu(p: Profile): Promise<void> {
    const choices = tabMenuChoices(p);
    const items = planTabMenu(labelFor(p), choices);
    // Heeft dit account niets te kiezen — een gedelegeerd postvak waarvan Google
    // nooit een agenda-URL prijsgaf — dan gaat er geen menu open. Een menu met
    // alleen een kop is een lege bak waar niets in te klikken valt.
    if (!hasClickableItem(items)) return;
    const picked = await onPopupMenu(items);
    // Het id ís de surface; zoek hem op in dezelfde lijst die het menu vulde, in
    // plaats van de string te vertrouwen die terugkomt.
    const surface = choices.find((s) => s === picked);
    if (surface) onOpen(p.key, surface);
  }

  return (
    <div
      // user-select-none hoort bij een sleepgebied, en houdt tegelijk het
      // kopieermenu weg: attachContextMenu toont niets zonder selectie.
      className="relative shrink-0 select-none bg-neutral-100 dark:bg-neutral-950"
      style={{ height: TOPBAR_HEIGHT, WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div style={AREA} className="flex items-center gap-1 pl-2">
        {/* max-w laat de tabs eerder horizontaal schuiven dan de knoppen rechts
            en de sleepruimte opeten — anders is het venster niet te verplaatsen
            en verdwijnt het tandwiel onder de vensterknoppen. De updateknop is
            er meestal niet, dus reserveer alleen ruimte als hij er staat. */}
        <div
          className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{
            maxWidth: `calc(100% - ${updateReady ? RESERVE_WITH_UPDATE : RESERVE_WITHOUT_UPDATE}px)`,
            ...NO_DRAG,
          }}
        >
          {profiles.map((p) => (
            <AccountTab
              key={p.key}
              profile={p}
              label={labelFor(p)}
              unread={unread[p.key] ?? 0}
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
            onClick={() => void openPlusMenu()}
            title={strings.addAccountTooltip}
            className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-neutral-500 transition hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
          {suggestions.length > 0 && !plusOpen && (
            <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-blue-500 px-1 text-[9px] font-bold leading-none text-white">
              {suggestions.length}
            </span>
          )}
        </div>

        {/* De rekstrook: hier pak je het venster op. Geen no-drag. */}
        <div className="min-w-[60px] flex-1" />

        {updateReady && (
          <button
            onClick={onInstallUpdate}
            title={strings.updateReady}
            // maxWidth maakt de reservering hierboven een garantie in plaats van
            // een schatting: een bredere systeemletter kapt de tekst af, in
            // plaats van het tandwiel onder de vensterknoppen te duwen.
            style={{ maxWidth: UPDATE_BUTTON, ...NO_DRAG }}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1 text-[12px] font-medium text-white transition hover:bg-blue-700"
          >
            <span className="min-w-0 truncate">{strings.updateReady}</span>
          </button>
        )}
        <button
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
