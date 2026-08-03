'use client';

import { useState } from 'react';
import type { Prefs, Profile } from '../page';
import type { UiStrings } from '../strings';
import { SettingRow } from './SettingRow';

// De zes tinten die een account kan hebben. Dezelfde lijst als in het oude
// paneel; dit is de enige kleur in het hele paneel die iets betekent.
const SWATCHES = ['#4285F4', '#EA4335', '#34A853', '#FBBC05', '#A142F4', '#00ACC1'];

// Haarlijn met haakjes: `border-black/8` bestaat niet in Tailwind 3 en zou stil
// wegvallen.
const CARD =
  'divide-y divide-black/[0.08] rounded-xl border border-black/[0.08] bg-white px-4 dark:divide-white/[0.08] dark:border-white/[0.08] dark:bg-neutral-900';

const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-900';

const BUTTON = `shrink-0 rounded-lg bg-neutral-200 px-3 py-1.5 text-[13px] font-medium text-neutral-900 transition hover:bg-neutral-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700 motion-reduce:transition-none ${FOCUS_RING}`;

const CHECKBOX = `h-4 w-4 shrink-0 accent-neutral-900 dark:accent-neutral-100 ${FOCUS_RING}`;

function initial(p: Profile): string {
  return (p.name || p.email || '?').trim().charAt(0).toUpperCase() || '?';
}

function TrashIcon({ className = '' }: { className?: string }) {
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
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6M10 11v6M14 11v6" />
    </svg>
  );
}

// Hetzelfde icoontje als op een gedelegeerd tabblad in de balk, zodat een
// gedeelde postbus hier op dezelfde manier te herkennen is als daar. Het
// icoontje is aria-hidden; wat het betekent staat er in woorden naast.
function DelegatedIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
    </svg>
  );
}

// Accounts: één kaart per account, met een rug van 3px in de accountkleur langs
// de linkerrand — dezelfde taal als het streepje onder het actieve tabblad in de
// balk.
export function AccountsSection({
  S,
  prefs,
  profiles,
  onRedetect,
}: {
  S: UiStrings;
  prefs: Prefs | null;
  profiles: Profile[];
  onRedetect: () => void;
}) {
  const [brokenAvatars, setBrokenAvatars] = useState<Record<string, boolean>>({});
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[20px] font-semibold tracking-tight">{S.sectionAccounts}</h2>

      {profiles.length === 0 && (
        <p className="rounded-xl border border-black/[0.08] bg-white px-4 py-3.5 text-[13.5px] text-neutral-500 dark:border-white/[0.08] dark:bg-neutral-900">
          {S.noAccounts}
        </p>
      )}

      {profiles.map((p) => {
        const showImg = p.avatarUrl && !brokenAvatars[p.avatarUrl];
        const account = prefs?.accounts?.[p.email];
        const delegated = p.kind === 'delegated';
        const id = (suffix: string) => `account-${p.email}-${suffix}`;

        // De vijf schakelaars als rooster met een naam per stuk, in plaats van
        // een rij naamloze knopjes. De agenda staat er alleen als het account
        // een agenda heeft: een gedelegeerd postvak zonder agenda-url heeft geen
        // agenda om meldingen van te geven, en dan schrijft de schakelaar alleen
        // een voorkeur weg die niets kan waarmaken.
        const toggles: { key: string; label: string; title: string; checked: boolean; set: (v: boolean) => void }[] = [
          {
            key: 'notify',
            label: S.mailToggle,
            title: S.mailToggleTitle,
            checked: account?.notify !== false,
            set: (v) => window.desktop?.setAccountPref({ email: p.email, notify: v }),
          },
          ...(p.hasCalendar
            ? [
                {
                  key: 'calendar',
                  label: S.calendarToggle,
                  title: S.calendarToggleTitle,
                  checked: account?.calendarNotify === true,
                  set: (v: boolean) => window.desktop?.setAccountPref({ email: p.email, calendarNotify: v }),
                },
              ]
            : []),
          {
            key: 'badge',
            label: S.badgeToggle,
            title: S.badgeToggleTitle,
            checked: account?.badgeCount !== false,
            set: (v) => window.desktop?.setAccountPref({ email: p.email, badgeCount: v }),
          },
          {
            key: 'sound',
            label: S.soundToggle,
            title: S.soundToggleTitle,
            checked: account?.notifySound !== false,
            set: (v) => window.desktop?.setAccountPref({ email: p.email, notifySound: v }),
          },
          {
            key: 'persist',
            label: S.persistToggle,
            title: S.persistToggleTitle,
            checked: account?.notifyPersist === true,
            set: (v) => window.desktop?.setAccountPref({ email: p.email, notifyPersist: v }),
          },
        ];

        return (
          <div
            key={p.email}
            className="relative overflow-hidden rounded-xl border border-black/[0.08] bg-white py-3.5 pl-4 pr-3.5 dark:border-white/[0.08] dark:bg-neutral-900"
          >
            {/* De rug: 3px accountkleur over de volle hoogte van de kaart. De
                kaart klipt hem (`overflow-hidden`), dus de uiteinden lopen mee
                met de ronding. */}
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 w-[3px]"
              style={{ backgroundColor: p.color }}
            />

            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: p.color }}
              >
                {showImg ? (
                  <img
                    src={p.avatarUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    onError={() => setBrokenAvatars((b) => ({ ...b, [p.avatarUrl]: true }))}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  initial(p)
                )}
              </span>

              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                {/* Het label is een veld zonder omlijsting tot je het aanwijst:
                    het staat op de plek van een naam en gedraagt zich als een
                    naam. Vaste padding met een negatieve marge ernaast, zodat de
                    tekst op dezelfde lijn staat als het adres eronder en er bij
                    focus niets verschuift. */}
                <input
                  aria-label={S.accountLabelField}
                  defaultValue={p.label ?? p.name ?? ''}
                  placeholder={p.name || p.email}
                  onKeyDown={(e) => {
                    // Vastleggen op Enter — de blur hieronder slaat op.
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== (p.label ?? p.name ?? ''))
                      window.desktop?.setAccountPref({ email: p.email, label: v });
                  }}
                  className={`-ml-1.5 w-full truncate rounded-md bg-transparent px-1.5 py-0.5 text-[13.5px] font-medium leading-tight transition hover:bg-neutral-100 focus:bg-neutral-100 dark:hover:bg-neutral-800 dark:focus:bg-neutral-800 motion-reduce:transition-none ${FOCUS_RING}`}
                />
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-neutral-500">
                  <span className="truncate">{p.email}</span>
                  {delegated && (
                    <>
                      <DelegatedIcon className="h-3 w-3 shrink-0" />
                      <span className="truncate">{S.delegatedTooltipSuffix}</span>
                    </>
                  )}
                </span>
              </div>

              {/* De kleurkiezer. Het gekozen staaltje krijgt een ring in de
                  tekstkleur en niet in een tint: de tinten zijn hier de
                  gegevens, dus de markering eromheen moet neutraal zijn. */}
              <span role="group" aria-label={S.accountColor} className="flex shrink-0 items-center gap-1.5">
                {SWATCHES.map((c) => {
                  const on = p.color.toLowerCase() === c.toLowerCase();
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => window.desktop?.setColor(p.email, c)}
                      aria-label={S.colorName(c)}
                      aria-pressed={on}
                      title={S.colorName(c)}
                      className={`h-5 w-5 rounded-full transition hover:scale-110 motion-reduce:transition-none motion-reduce:hover:scale-100 ${FOCUS_RING} ${
                        on
                          ? 'ring-2 ring-neutral-900 ring-offset-2 ring-offset-white dark:ring-neutral-100 dark:ring-offset-neutral-900'
                          : ''
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  );
                })}
              </span>

              <button
                type="button"
                onClick={() => setConfirmEmail(p.email)}
                aria-label={S.removeAccount}
                title={S.removeAccount}
                className={`ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition hover:bg-black/5 hover:text-neutral-900 dark:hover:bg-white/10 dark:hover:text-neutral-100 motion-reduce:transition-none ${FOCUS_RING}`}
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>

            {/* Eén haarlijn tussen wie dit account is en wat het mag. Het rooster
                zakt naar twee kolommen als er minder ruimte is — René mode zet
                alles op 200% en dan is dat precies wat er moet gebeuren. */}
            <div className="mt-3 grid grid-cols-2 gap-x-4 border-t border-black/[0.08] pt-2 dark:border-white/[0.08] sm:grid-cols-3">
              {toggles.map((t) => (
                <label
                  key={t.key}
                  htmlFor={id(t.key)}
                  title={t.title}
                  className="flex min-h-[32px] cursor-pointer items-center gap-2 py-1 text-[13px]"
                >
                  <input
                    id={id(t.key)}
                    type="checkbox"
                    checked={t.checked}
                    onChange={(e) => t.set(e.target.checked)}
                    className={CHECKBOX}
                  />
                  <span className="min-w-0 truncate">{t.label}</span>
                </label>
              ))}
            </div>

            {confirmEmail === p.email && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-neutral-100 px-3 py-2 dark:bg-neutral-800">
                <span className="text-xs text-neutral-500">
                  {S.removeConfirmBefore}
                  <span className="font-semibold text-neutral-900 dark:text-neutral-100">+</span>
                  {S.removeConfirmAfter}
                </span>
                {/* Verwijderen is de zwaarste knop van het paneel en dus de
                    donkerste, niet de rood-ste: in dit paneel betekent kleur één
                    ding, en dat is van welk account iets is. */}
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      window.desktop?.removeAccount(p.email);
                      setConfirmEmail(null);
                    }}
                    className={`rounded-lg bg-neutral-900 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white motion-reduce:transition-none ${FOCUS_RING}`}
                  >
                    {S.remove}
                  </button>
                  <button type="button" onClick={() => setConfirmEmail(null)} className={BUTTON}>
                    {S.cancel}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className={CARD}>
        <SettingRow label={S.navAccounts} description={S.redetectDescription}>
          <button type="button" onClick={onRedetect} className={BUTTON}>
            {S.redetect}
          </button>
        </SettingRow>
      </div>

      <p className="max-w-prose text-xs leading-relaxed text-neutral-500">
        {S.accountsFootnoteBefore}
        <span className="font-medium text-neutral-900 dark:text-neutral-100">+</span>
        {S.accountsFootnoteAfter}
      </p>
    </section>
  );
}
