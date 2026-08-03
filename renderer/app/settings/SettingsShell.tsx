'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { SETTINGS_SECTIONS, needsAttention, type AttentionInput, type SettingsSection } from './nav';

// Vaste id's zodat het tabblad en het paneel naar elkaar kunnen wijzen zonder dat
// er tekst voor nodig is. Er staat er nooit meer dan één op het scherm.
const PANEL_ID = 'settings-section-panel';
const tabId = (section: SettingsSection) => `settings-tab-${section}`;

// Een zichtbare focusring op elk aanklikbaar ding. `focus-visible` en niet
// `focus`, zodat een muisklik geen ring achterlaat maar Tab wel.
const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-100 dark:focus-visible:ring-offset-neutral-950';

// De schil van het instellingenpaneel: kop, navigatiekolom, inhoud. Alle tekst
// komt binnen als prop — dit bestand kent geen enkel woord Nederlands of Engels
// dat de gebruiker ziet.
//
// Het vlak is neutral-100/neutral-950, precies de kleur van de balk van 40px
// erboven. Daardoor is er geen naad op de plek waar de balk ophoudt: paneel en
// balk zijn één vlak.
export function SettingsShell({
  title,
  sectionLabel,
  active,
  onSelect,
  attention,
  attentionLabel,
  saved,
  onSave,
  onClose,
  saveLabel,
  savedLabel,
  closeLabel,
  banner,
  children,
}: {
  title: string;
  sectionLabel(s: SettingsSection): string;
  active: SettingsSection;
  onSelect(s: SettingsSection): void;
  attention: AttentionInput;
  attentionLabel: string;
  saved: boolean;
  onSave(): void;
  onClose(): void;
  saveLabel: string;
  savedLabel: string;
  closeLabel: string;
  banner?: ReactNode;
  children: ReactNode;
}) {
  // Verwijzingen naar de navigatieknoppen, zodat de pijltjestoetsen de focus mee
  // kunnen verplaatsen. Alleen bij toetsenbordgebruik wordt hier .focus()
  // aangeroepen; bij een klik of bij het openen van het paneel niet, want dan
  // pakt het paneel focus af van iets waar de gebruiker mee bezig was.
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  const step = (delta: number) => {
    const from = SETTINGS_SECTIONS.indexOf(active);
    if (from < 0) return;
    // Rondlopen: bij vier secties is doorschieten naar de eerste sneller dan
    // terugtellen, en een pijltje dat niets doet voelt als een kapotte toets.
    const to = (from + delta + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length;
    onSelect(SETTINGS_SECTIONS[to]);
    items.current[to]?.focus();
  };

  const jump = (to: number) => {
    onSelect(SETTINGS_SECTIONS[to]);
    items.current[to]?.focus();
  };

  const onNavKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // preventDefault: anders scrollt het paneel óók, en dan verschuift de inhoud
    // van de sectie die je net verliet.
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      step(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      step(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      jump(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      jump(SETTINGS_SECTIONS.length - 1);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-neutral-100 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      {/* De kop en de eventuele strook eronder scrollen niet mee: de titel en de
          knoppen staan altijd op dezelfde plek. Eén haarlijn onder het hele
          blok, waar de haarlijn van de navigatiekolom op uitkomt. */}
      {/* Haarlijn op 8%: met haakjes, want `border-black/8` bestaat niet in
          Tailwind 3 (de doorzichtigheidsschaal gaat per 5) en zou stil wegvallen. */}
      <div className="shrink-0 border-b border-black/[0.08] dark:border-white/[0.08]">
        <header className="flex items-center justify-between gap-4 px-6 py-4">
          <h1 className="truncate text-[20px] font-semibold tracking-tight">{title}</h1>
          <div className="flex shrink-0 items-center gap-2">
            {/* De opgeslagen-melding staat naast de knop en niet in plaats van de
                knop: hij is twee seconden zichtbaar, en een knop die twee
                seconden verdwijnt en terugkomt springt. Met opacity in plaats van
                een conditie blijft de breedte gelijk en verschuiven de knoppen
                niet. Grijs, niet groen — in dit paneel betekent kleur precies
                één ding, en dat is van welk account iets is. */}
            <span
              aria-live="polite"
              className={`text-xs font-medium text-neutral-500 transition-opacity duration-300 motion-reduce:transition-none ${
                saved ? 'opacity-100' : 'opacity-0'
              }`}
            >
              {savedLabel}
            </span>
            {/* De enige plek in het paneel met een accentkleur: de ene knop die
                iets vastlegt. */}
            <button
              type="button"
              onClick={onSave}
              className={`rounded-lg bg-blue-600 px-3.5 py-1.5 text-[13px] font-medium text-white transition hover:bg-blue-500 motion-reduce:transition-none ${FOCUS_RING}`}
            >
              {saveLabel}
            </button>
            <button
              type="button"
              onClick={onClose}
              className={`rounded-lg bg-neutral-200 px-3.5 py-1.5 text-[13px] font-medium text-neutral-900 transition hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700 motion-reduce:transition-none ${FOCUS_RING}`}
            >
              {closeLabel}
            </button>
          </div>
        </header>
        {/* Een strook over de volle breedte onder de kop. De inhoud brengt zijn
            eigen opmaak mee; hier staat alleen waar hij hangt. */}
        {banner && <div className="px-6 pb-4">{banner}</div>}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Navigatiekolom: w-52 is 208px. Scrollt niet — vier secties passen
            altijd, en een kolom die meebeweegt met de inhoud verliest juist het
            overzicht dat hij moet geven. */}
        <nav
          role="tablist"
          aria-orientation="vertical"
          onKeyDown={onNavKeyDown}
          className="flex w-52 shrink-0 flex-col gap-0.5 overflow-hidden border-r border-black/[0.08] p-3 dark:border-white/[0.08]"
        >
          {SETTINGS_SECTIONS.map((section, i) => {
            const isActive = section === active;
            return (
              <button
                key={section}
                ref={(el) => {
                  items.current[i] = el;
                }}
                id={tabId(section)}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={PANEL_ID}
                // Rovende tabindex: één keer Tab brengt je in de kolom, daarna
                // wissel je met de pijltjes. Tab nog eens en je bent bij de
                // instellingen zelf in plaats van bij het tweede sectiekopje.
                tabIndex={isActive ? 0 : -1}
                onClick={() => onSelect(section)}
                className={`flex min-h-[30px] items-center gap-2 rounded-md px-3 py-1.5 text-left text-[13px] font-medium transition motion-reduce:transition-none ${FOCUS_RING} ${
                  isActive
                    ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-100 dark:shadow-none'
                    : 'text-neutral-500 hover:bg-black/5 hover:text-neutral-900 dark:hover:bg-white/5 dark:hover:text-neutral-100'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{sectionLabel(section)}</span>
                {/* Het puntje: hier staat iets dat je wilde weten zonder ernaar
                    te zoeken. 6px, en het enige blauw buiten de opslaan-knop.
                    Het bolletje zelf is aria-hidden — een vorm zegt niets — en de
                    tekst ernaast staat in `sr-only`: onzichtbaar, maar wel gewone
                    tekst binnen de knop, dus hij hangt achter de sectienaam in de
                    naam van het tabblad ("Meldingen, …"). Staat er geen
                    aandachtspunt, dan staat er niets: een puntje dat altijd wordt
                    voorgelezen en dan "nee" zegt is erger dan geen puntje. */}
                {needsAttention(section, attention) && (
                  <>
                    <span className="sr-only">{attentionLabel}</span>
                    <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
                  </>
                )}
              </button>
            );
          })}
        </nav>

        {/* De inhoud scrollt, de rest niet. max-w-[720px] zodat een rij niet
            meters breed wordt op een groot venster en de controls rechts op een
            voorspelbare plek blijven. Geen overgang bij het wisselen van sectie:
            dat doe je één keer per bezoek, en een animatie maakt het alleen
            langzamer. */}
        {/* tabIndex=0: het vlak is scrollbaar, en een sectie die tekst is in
            plaats van knoppen (Over, met de changelog erin) heeft niets waar de
            focus in kan landen — zonder dit is die met het toetsenbord niet te
            scrollen. De ring staat naar binnen: een ring met offset om een vlak
            van deze maat loopt over de haarlijn van de kolom heen. */}
        <div
          id={PANEL_ID}
          role="tabpanel"
          aria-labelledby={tabId(active)}
          tabIndex={0}
          className="min-w-0 flex-1 overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-600"
        >
          <div className="mx-auto w-full max-w-[720px] px-8 py-7">{children}</div>
        </div>
      </div>
    </div>
  );
}
