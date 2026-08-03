'use client';

import { useState } from 'react';
import type { Profile } from '../page';
import type { UiStrings } from '../strings';
import { SettingRow } from './SettingRow';
import {
  BUTTON,
  CARD,
  DANGER_BUTTON,
  DANGER_PANEL,
  FOCUS_RING,
  PANEL,
  SECTION_TITLE,
} from './tokens';

// De zes tinten die een account kan hebben. Dezelfde lijst als in het oude
// paneel; dit is de kleur die in dit paneel zegt van wie iets is.
const SWATCHES = ['#4285F4', '#EA4335', '#34A853', '#FBBC05', '#A142F4', '#00ACC1'];

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
//
// Deze sectie gaat over wíe een account is: de naam, de kleur, en hem weghalen.
// Wat een account aan meldingen mag geven staat in `NotificationsSection`, want
// daar ga je kijken als je je afvraagt wat je bereikt. Daarom heeft deze sectie
// de voorkeuren (`prefs`) niet meer nodig: alles wat de kaart toont — label,
// kleur, avatar — komt uit het profiel zelf.
export function AccountsSection({
  S,
  profiles,
  onRedetect,
}: {
  S: UiStrings;
  profiles: Profile[];
  onRedetect: () => void;
}) {
  const [brokenAvatars, setBrokenAvatars] = useState<Record<string, boolean>>({});
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-4">
      <h2 className={SECTION_TITLE}>{S.sectionAccounts}</h2>

      {profiles.length === 0 && (
        <p className={`${PANEL} px-4 py-3.5 text-[13.5px] text-neutral-500`}>{S.noAccounts}</p>
      )}

      {profiles.map((p) => {
        const showImg = p.avatarUrl && !brokenAvatars[p.avatarUrl];
        const delegated = p.kind === 'delegated';

        return (
          <div
            key={p.email}
            className={`${PANEL} relative overflow-hidden py-3.5 pl-4 pr-3.5`}
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

            {/* Rood, en dit is een van de twee plekken in het paneel waar dat mag:
                een account weghalen is niet terug te draaien met dezelfde knop.
                Het vlak is getint zodat de vraag zich losmaakt van de kaart
                eromheen, de tekstkleur komt uit `DANGER_PANEL` mee, en de knop die
                het doet is vol rood. Annuleren blijft grijs: dat is de veilige
                uitgang, en die hoort niet mee te schreeuwen. */}
            {confirmEmail === p.email && (
              <div className={`${DANGER_PANEL} mt-3 flex items-center justify-between gap-3 px-3 py-2`}>
                <span className="text-xs">
                  {S.removeConfirmBefore}
                  <span className="font-semibold">+</span>
                  {S.removeConfirmAfter}
                </span>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      window.desktop?.removeAccount(p.email);
                      setConfirmEmail(null);
                    }}
                    className={DANGER_BUTTON}
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
