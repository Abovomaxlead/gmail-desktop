'use client';

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  needsAttention,
  type AttentionInput,
  type SettingsSection,
} from './nav';
import { HAIRLINE, SURFACE, SURFACE_FOCUS_RING } from './tokens';

// Vaste id's zodat het tabblad en het paneel naar elkaar kunnen wijzen zonder dat
// er tekst voor nodig is. Er staat er nooit meer dan één op het scherm.
const PANEL_ID = 'settings-section-panel';
const tabId = (section: SettingsSection) => `settings-tab-${section}`;

// De schil van het instellingenpaneel: een navigatiekolom op het grijze vlak, en
// daarnaast één wit vlak met de sectie erin. Alle tekst komt binnen als prop — dit
// bestand kent geen enkel woord Nederlands of Engels dat de gebruiker ziet.
//
// Er is geen kop met een titel en geen Bewaren-knop meer. Beide zijn weg om
// dezelfde reden: ze zeiden niets. De titel van het paneel stond boven de titel
// van de sectie ("Instellingen" boven "Algemeen") en de knop legde niets vast wat
// niet al vastlag — elke control schrijft zichzelf meteen weg. Wat ervoor in de
// plaats komt is de enige knop die er echt hoort: sluiten, in de hoek van het
// witte vlak, met de toets die hetzelfde doet eronder.
export function SettingsShell({
  sectionLabel,
  active,
  onSelect,
  attention,
  attentionLabel,
  onClose,
  closeLabel,
  escLabel,
  banner,
  children,
}: {
  sectionLabel(s: SettingsSection): string;
  active: SettingsSection;
  onSelect(s: SettingsSection): void;
  attention: AttentionInput;
  attentionLabel: string;
  onClose(): void;
  closeLabel: string;
  // Het opschrift onder de sluitknop: de naam van de toets die hetzelfde doet.
  // Komt als tekst binnen omdat de toets in de ene taal "Esc" heet en in de andere
  // ook — maar het is tekst op het scherm, en die staat in `strings.ts`.
  escLabel: string;
  banner?: ReactNode;
  children: ReactNode;
}) {
  // Verwijzingen naar de navigatieknoppen, zodat de pijltjestoetsen de focus mee
  // kunnen verplaatsen. Alleen bij toetsenbordgebruik wordt hier .focus()
  // aangeroepen; bij een klik of bij het openen van het paneel niet, want dan
  // pakt het paneel focus af van iets waar de gebruiker mee bezig was.
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  // Eén scrollvlak voor alle secties, dus de scrollstand van de sectie die je
  // verlaat blijft staan en je landt middenin de volgende. Terug naar boven bij
  // elke wissel: een sectie begint bij zijn eigen kop.
  const scroller = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // Niet `scrollTo({behavior})`: dit is geen navigatie binnen een pagina maar
    // een ander stuk inhoud, en dat hoort er meteen te staan.
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [active]);

  // Sluiten legt eerst neer wat er nog in een veld staat. De naam van een account
  // wordt op blur weggeschreven, en zonder deze blur verdwijnt het paneel met de
  // cursor er nog in — dan is de wijziging weg zonder dat er iets misging.
  const close = () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    onClose();
  };

  // Esc sluit het paneel, en dat staat onder de sluitknop op het scherm. De
  // luisteraar hangt op `window` en niet op het vlak: de focus kan in de
  // navigatiekolom staan, in een veld, of nergens, en de toets hoort in alle drie
  // de gevallen te werken.
  //
  // Niet in de capture-fase: een control die Esc zelf gebruikt (een openstaande
  // keuzelijst sluit ermee) mag hem eerst hebben en het doorgeven stoppen. Zo
  // klapt één keer Esc de lijst dicht en de tweede het paneel.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  const step = (delta: number) => {
    const from = SETTINGS_SECTIONS.indexOf(active);
    if (from < 0) return;
    // Rondlopen: doorschieten naar de eerste is sneller dan negentien keer
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
    // preventDefault: anders scrollt de kolom óók, en dan verschuift de lijst
    // onder de focus die net verplaatst is.
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
    <div className="flex min-h-0 flex-1 overflow-hidden bg-neutral-100 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      {/* Navigatiekolom: w-60 is 240px, en de kolom staat op het grijze vlak
          zonder eigen kaart of rand — het witte vlak ernaast is de scheiding.
          Negentien secties passen op een venster van standaardhoogte; op een
          korter venster scrollt de kolom, en daarom staat de `overflow-y-auto`
          erop. */}
      <nav
        role="tablist"
        aria-orientation="vertical"
        onKeyDown={onNavKeyDown}
        className="flex w-60 shrink-0 flex-col overflow-y-auto px-4 py-4"
      >
        {SETTINGS_GROUPS.map((group, gi) => (
          // De haarlijn tussen twee groepen, en niets erboven bij de eerste. De
          // groepen staan in `nav.ts`, want ze zijn een uitspraak over wat waar
          // hoort en niet over opmaak.
          <div
            key={gi}
            className={`flex flex-col gap-0.5 ${gi > 0 ? `mt-2 border-t pt-2 ${HAIRLINE}` : ''}`}
          >
            {group.map((section) => {
              const isActive = section === active;
              // De plek in de platte lijst, want daar lopen de pijltjes over en
              // daar staan de refs op. Een teller over de groepen heen zou
              // hetzelfde doen, maar dan staat de waarheid over de volgorde op
              // twee plekken.
              const i = SETTINGS_SECTIONS.indexOf(section);
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
                  className={`flex min-h-[32px] items-center gap-2 rounded-md px-3 py-1.5 text-left text-[13px] transition motion-reduce:transition-none ${SURFACE_FOCUS_RING} ${
                    isActive
                      ? 'bg-black/[0.06] font-medium text-neutral-900 dark:bg-white/10 dark:text-neutral-100'
                      : 'font-normal text-neutral-500 hover:bg-black/[0.04] hover:text-neutral-900 dark:hover:bg-white/5 dark:hover:text-neutral-100'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{sectionLabel(section)}</span>
                  {/* Het puntje: hier staat iets dat je wilde weten zonder ernaar
                      te zoeken. 6px, en het enige blauw in de kolom. Het bolletje
                      zelf is aria-hidden — een vorm zegt niets — en de tekst
                      ernaast staat in `sr-only`: onzichtbaar, maar wel gewone
                      tekst binnen de knop, dus hij hangt achter de sectienaam in
                      de naam van het tabblad ("Notifications, …"). Staat er geen
                      aandachtspunt, dan staat er niets: een puntje dat altijd
                      wordt voorgelezen en dan "nee" zegt is erger dan geen
                      puntje. */}
                  {needsAttention(section, attention) && (
                    <>
                      <span className="sr-only">{attentionLabel}</span>
                      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
                    </>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Het witte vlak, met een marge van 16px langs de drie randen die het niet
          met de kolom deelt. Die marge is wat het vlak tot een vlak maakt: zonder
          hem is het gewoon de rechterhelft van het venster. */}
      <div className="min-h-0 flex-1 pb-4 pr-4 pt-4">
        <div className={`relative flex h-full min-h-0 flex-col overflow-hidden ${SURFACE}`}>
          {/* Sluiten staat in de hoek van het vlak en scrollt niet mee: het is de
              uitgang, en die hoort altijd op dezelfde plek te zijn. Eronder de
              naam van de toets die hetzelfde doet — aria-hidden, want voor een
              schermlezer is de knop al "sluiten" en "ESC" eronder zou daar als
              tweede woord in de naam bij komen. */}
          <div className="absolute right-5 top-5 z-10 flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={close}
              aria-label={closeLabel}
              title={closeLabel}
              className={`flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 transition hover:bg-neutral-200 hover:text-neutral-900 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100 motion-reduce:transition-none ${SURFACE_FOCUS_RING} focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-900`}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden
                className="h-3.5 w-3.5"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            <span aria-hidden className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
              {escLabel}
            </span>
          </div>

          {/* De inhoud scrollt, het vlak eromheen niet.
              tabIndex=0: het vlak is scrollbaar, en een sectie die tekst is in
              plaats van knoppen (Wat is er nieuw, met de changelog erin) heeft
              niets waar de focus in kan landen — zonder dit is die met het
              toetsenbord niet te scrollen. De ring staat naar binnen en volgt de
              ronding van het vlak, anders steekt hij door de hoeken. */}
          <div
            ref={scroller}
            id={PANEL_ID}
            role="tabpanel"
            aria-labelledby={tabId(active)}
            tabIndex={0}
            className="min-h-0 flex-1 overflow-y-auto rounded-2xl outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-600"
          >
            {/* Een kolom van 560px, gecentreerd in het vlak. Dat is een andere
                keuze dan in het paneel met de kop erboven, en de reden is dat de
                titel van de sectie nu de bovenste tekst ín dit vlak is: er is geen
                tweede kop meer die op de as van de navigatie staat, en dus ook geen
                as om tegenaan te lijnen. Wat overblijft is één kolom tekst in een
                wit vlak, en die hoort in het midden. */}
            <div className="mx-auto w-full max-w-[560px] px-8 py-10">
              {/* Een melding boven de sectie over de volle kolombreedte — nu
                  alleen de Rene-strook. Hij staat binnen de scroll en niet erboven:
                  het is een mededeling en geen tweede kop, en een strook die
                  blijft staan terwijl de inhoud eronder wegschuift trekt meer
                  aandacht dan hij verdient. */}
              {banner && <div className="mb-8">{banner}</div>}
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
