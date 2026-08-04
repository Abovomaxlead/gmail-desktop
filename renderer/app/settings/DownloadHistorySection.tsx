'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DownloadRecord } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import {
  BUTTON,
  DANGER_BUTTON,
  DANGER_PANEL,
  DIVIDER,
  FOCUS_RING,
  HAIRLINE,
  HINT,
  PANEL,
} from './tokens';

// De trappen van de maat, vanaf duizend. Duizend en niet 1024, en dat is met opzet:
// er staat kB en niet KiB, en een browser meldt de maat van een download ook in
// duizenden. Eén decimaal, want "1,2 MB" zegt alles wat je van een bestand in een
// logboek wil weten en "1,234 MB" doet alsof het precies is.
const SIZE_UNITS = ['kB', 'MB', 'GB', 'TB'] as const;

// De maat als tekst. Zuiver en apart van de tabel: dit is de enige rekenstap in
// deze sectie, en het is de stap die je bij een grens (999 → 1,0 kB) fout doet.
//
// Onder de duizend blijft het een aantal bytes, en dat is een tekst met een woord
// erin — dus komt die uit `strings.ts` en niet uit dit bestand.
function formatSize(bytes: number, S: UiStrings): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safe < 1000) return S.dhBytes(Math.round(safe));
  let value = safe / 1000;
  let unit = 0;
  while (value >= 1000 && unit < SIZE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  // De komma of punt volgt de taal van de app, net als bij het aantal ongelezen
  // berichten in de balk: 1,2 MB in het Nederlands, 1.2 MB in het Engels.
  return `${value.toLocaleString(S.numberLocale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} ${SIZE_UNITS[unit]}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

// Van vandaag alleen de tijd, van eerder alleen de datum. Dat is wat je van een
// download wil weten: van vandaag is "wanneer op de dag" het onderscheid tussen
// twee bestanden met dezelfde naam, en van vorige week is de tijd ruis.
function formatWhen(
  startedAt: number,
  now: Date,
  time: Intl.DateTimeFormat,
  date: Intl.DateTimeFormat,
): string {
  const d = new Date(startedAt);
  return isSameDay(d, now) ? time.format(d) : date.format(d);
}

// De brug kan een luisteraar niet weer weghalen: `onDownloadHistoryChanged` in
// sidebar-preload.ts doet `ipcRenderer.on` en er is geen tegenhanger. Eén keer per
// venster abonneren en het bericht hier verdelen betekent dat je van tab kan wisselen
// zonder dat er per keer een luisteraar bij komt die nooit meer weggaat.
const listeners = new Set<() => void>();
let subscribed = false;

function subscribeToChanges(cb: () => void): () => void {
  listeners.add(cb);
  if (!subscribed) {
    subscribed = true;
    window.desktop?.onDownloadHistoryChanged(() => {
      for (const l of listeners) l();
    });
  }
  return () => {
    listeners.delete(cb);
  };
}

// Een map met een pijl erin: het bestand ligt er, laat me zien waar. Zelfde stijl
// als de andere icoontjes in het paneel — lijnen van 2px, en `aria-hidden`, want
// wat de knop doet staat in zijn naam.
function FolderIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

// Een blad met een pijl eruit: doe het bestand open, buiten de app.
function OpenIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M14 4h6v6M20 4l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </svg>
  );
}

// De twee knoppen rechts op een rij staan op het witte vlak, dus `FOCUS_RING` past
// hier (en niet de variant voor het grijze vlak). Uitgeschakeld is zichtbaar
// uitgeschakeld en verdwijnt niet: een knop die weg is laat de rij verspringen, en
// een rij van tweehonderd regels die per regel anders is opgebouwd leest niet meer.
const ICON_BUTTON = `flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition hover:bg-black/5 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-500 dark:hover:bg-white/10 dark:hover:text-neutral-100 motion-reduce:transition-none ${FOCUS_RING}`;

// De kop van een kolom. Eén klasse, zodat de vier koppen niet ieder hun eigen maat
// krijgen; de uitlijning komt er per kolom bij.
const TH = 'px-2 py-2 text-xs font-medium text-neutral-500';

function stateLabel(state: DownloadRecord['state'], S: UiStrings): string {
  if (state === 'completed') return S.dhStateCompleted;
  if (state === 'cancelled') return S.dhStateCancelled;
  return S.dhStateInterrupted;
}

// Wat je hebt gehaald: het logboek van de downloads, nieuwste bovenaan. Main houdt
// de lijst bij (één regel per afgeronde download, ook een mislukte) en deze sectie
// leest hem alleen — er is niets aan te zetten, alleen iets in terug te vinden.
//
// Een echte tabel en geen rijtje kaarten: elke regel heeft precies dezelfde vier
// gegevens, en dan is de kolom de plek waar de betekenis in zit. Voor een
// schermlezer is de kolomkop daarmee de context van elke cel, zonder dat er per
// regel een zin in elkaar gezet wordt.
export function DownloadHistorySection({ S }: { S: UiStrings }): JSX.Element {
  const [records, setRecords] = useState<DownloadRecord[]>([]);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = (): void => {
      window.desktop
        ?.getDownloadHistory()
        .then((r) => {
          // `alive` en niet alleen de afmelding hieronder: het antwoord kan
          // aankomen nadat je alweer naar een andere tab bent, en dan zet dit
          // een lijst in een sectie die er niet meer is.
          if (alive) setRecords(Array.isArray(r) ? r : []);
        })
        .catch(() => {});
    };
    load();
    // Opnieuw ophalen en niet zelf bijwerken: main heeft de lijst, dus main heeft
    // ook de waarheid over de volgorde en over wat er bij tweehonderd regels
    // afvalt. Het bericht zegt alleen dát er iets veranderde.
    const off = subscribeToChanges(load);
    return () => {
      alive = false;
      off();
    };
  }, []);

  // Twee formatteerders en niet één per regel: `Intl.DateTimeFormat` bouwen is het
  // dure deel, en bij tweehonderd regels doe je dat tweehonderd keer voor niets.
  const when = useMemo(
    () => ({
      time: new Intl.DateTimeFormat(S.numberLocale, { hour: '2-digit', minute: '2-digit' }),
      date: new Intl.DateTimeFormat(S.numberLocale, { day: 'numeric', month: 'short', year: 'numeric' }),
    }),
    [S.numberLocale],
  );

  // "Vandaag" wordt bij elke tekening opnieuw bepaald. Blijft het paneel over
  // middernacht open staan, dan verspringt een rij van een tijd naar een datum zodra
  // er iets te tekenen valt — dat is later dan precies om twaalf uur, en dat is geen
  // fout die iemand ooit ziet.
  const today = new Date();

  return (
    <Section title={S.navDownloadHistory}>
      <SettingsGroup>
        {records.length === 0 ? (
          // Nog niets gehaald is geen lege staat met een plaatje: er is niets kwijt,
          // er is nog niets gebeurd. Wel in hetzelfde omlijnde vlak als de tabel, zodat
          // de sectie niet van vorm verandert zodra de eerste regel er is.
          <p className={`${PANEL} px-4 py-3.5 ${HINT}`}>{S.dhEmpty}</p>
        ) : (
          // `overflow-x-auto` op het vlak: een tabel kan niet herschikken, en in de
          // Rene-stand staat alles op 200%. Dan schuift de tabel liever in zijn eigen
          // vlak zijwaarts dan dat de pagina zelf horizontaal gaat schuiven.
          <div className={`${PANEL} overflow-x-auto`}>
            <table className="w-full min-w-[460px] text-[13px]">
              <thead>
                <tr className={`border-b ${HAIRLINE}`}>
                  <th scope="col" className={`${TH} pl-4 text-left`}>
                    {S.dhFile}
                  </th>
                  {/* De maat rechts uitgelijnd, zoals elk getal in een kolom: dan
                      staan de eenheden onder elkaar en is een groot bestand van een
                      klein bestand te onderscheiden zonder te lezen. */}
                  <th scope="col" className={`${TH} text-right`}>
                    {S.dhSize}
                  </th>
                  <th scope="col" className={`${TH} text-left`}>
                    {S.dhWhen}
                  </th>
                  <th scope="col" className={`${TH} text-left`}>
                    {S.dhState}
                  </th>
                  {/* De kolom met de twee knoppen heeft geen kop. Er staan twee
                      verschillende dingen in ("laat zien" en "open"), dus één woord
                      erboven zou over één van de twee liegen — en de knoppen dragen
                      hun naam al zelf (`aria-label`), wat voor een schermlezer de
                      plek is waar die naam hoort. */}
                  <th scope="col" className="w-[76px] pr-4" />
                </tr>
              </thead>
              <tbody className={`divide-y ${DIVIDER}`}>
                {records.map((r, i) => {
                  const done = r.state === 'completed';
                  return (
                    <tr
                      // De index staat in de sleutel omdat de lijst bij elke
                      // wijziging in zijn geheel wordt vervangen: er is niets aan een
                      // rij dat tussen twee tekeningen bewaard hoeft te blijven, en
                      // twee downloads van hetzelfde bestand hebben verder geen
                      // verschil om op te sleutelen.
                      key={`${r.startedAt}-${r.path}-${i}`}
                      // Een mislukte of afgebroken download leest gedempt: er staat
                      // een naam, maar er ligt niets. De stand staat er ook in
                      // woorden — kleur (of het gebrek eraan) mag niet het enige zijn
                      // dat het verschil vertelt.
                      className={done ? '' : 'text-neutral-500 dark:text-neutral-500'}
                    >
                      {/* `max-w-0 w-full` is de truc om in een tabel te kunnen
                          afkappen: een cel krimpt niet onder zijn inhoud, tenzij je
                          hem een maximum van nul geeft. Deze kolom slokt daardoor de
                          ruimte op die de andere vier niet nodig hebben. Het volledige
                          pad staat in `title`, want dát is de vraag die je bij een
                          afgekapte naam hebt: waar staat het? */}
                      <td className="w-full max-w-0 py-2 pl-4 pr-2">
                        <span className="block truncate" title={r.path || r.filename}>
                          {r.filename}
                        </span>
                      </td>
                      {/* `tabular-nums`: een maat is een getal, en getallen onder
                          elkaar horen dezelfde cijferbreedte te hebben. */}
                      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                        {formatSize(r.bytes, S)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums">
                        {formatWhen(r.startedAt, today, when.time, when.date)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2">{stateLabel(r.state, S)}</td>
                      <td className="py-2 pr-4">
                        <span className="flex items-center justify-end gap-0.5">
                          {/* Zonder pad valt er niets te wijzen: dat gebeurt bij een
                              download die is afgebroken voordat Chromium een plek had
                              gekozen. */}
                          <button
                            type="button"
                            onClick={() => window.desktop?.revealDownload(r.path)}
                            disabled={!r.path}
                            aria-label={S.dhReveal}
                            title={S.dhReveal}
                            className={ICON_BUTTON}
                          >
                            <FolderIcon className="h-4 w-4" />
                          </button>
                          {/* Openen kan alleen bij een download die af is. Een halve
                              of afgebroken download heeft geen bestand, en een knop
                              die niets doet leest als een app die stuk is. */}
                          <button
                            type="button"
                            onClick={() => window.desktop?.openDownload(r.path)}
                            disabled={!done || !r.path}
                            aria-label={S.dhOpen}
                            title={S.dhOpen}
                            className={ICON_BUTTON}
                          >
                            <OpenIcon className="h-4 w-4" />
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SettingsGroup>

      {/* De knop om de lijst leeg te maken staat er alleen als er iets in staat: een
          knop die niets kan doen is een dood knopje. */}
      {records.length > 0 && (
        <SettingsGroup>
          {confirming ? (
            // Rood en met een vraag ertussen, net als het weghalen van een account:
            // een logboek wissen is niet terug te draaien met dezelfde knop. Het
            // getinte vlak maakt de vraag los van de tabel erboven, de tekstkleur komt
            // uit `DANGER_PANEL` mee, en annuleren blijft grijs — dat is de veilige
            // uitgang en die hoort niet mee te schreeuwen.
            <div className={`${DANGER_PANEL} flex items-center justify-between gap-3 px-3 py-2`}>
              <span className="text-xs">{S.dhClearConfirm}</span>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    window.desktop?.clearDownloadHistory();
                    // Meteen leeg in beeld en niet wachten op het bericht uit main:
                    // main stuurt zijn wijziging na, maar tot dan zou de lijst er nog
                    // staan alsof de knop niet aankwam.
                    setRecords([]);
                    setConfirming(false);
                  }}
                  className={DANGER_BUTTON}
                >
                  {S.remove}
                </button>
                <button type="button" onClick={() => setConfirming(false)} className={BUTTON}>
                  {S.cancel}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end">
              <button type="button" onClick={() => setConfirming(true)} className={BUTTON}>
                {S.dhClear}
              </button>
            </div>
          )}
        </SettingsGroup>
      )}
    </Section>
  );
}
