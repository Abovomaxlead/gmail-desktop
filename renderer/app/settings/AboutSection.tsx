'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { UpdateStatus } from '../page';
import type { ChangelogEntry, ChangelogVersion } from '../changelog-types';
import type { UiStrings } from '../strings';
import { SettingRow } from './SettingRow';

// De naam van de app is een eigennaam en wordt niet vertaald, dus hij staat niet
// in strings.ts.
const APP_NAME = 'Gmail Desktop';

// Haarlijn met haakjes: `divide-black/8` bestaat niet in Tailwind 3 en zou stil
// wegvallen.
const CARD =
  'divide-y divide-black/[0.08] rounded-xl border border-black/[0.08] bg-white px-4 dark:divide-white/[0.08] dark:border-white/[0.08] dark:bg-neutral-900';

const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-900';

const BUTTON = `shrink-0 rounded-lg bg-neutral-200 px-3 py-1.5 text-[13px] font-medium text-neutral-900 transition hover:bg-neutral-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700 motion-reduce:transition-none ${FOCUS_RING}`;

// De enige accentkleur in het hele paneel, op de enige knop die de update
// daadwerkelijk uitvoert. Er staat er altijd hoogstens één van op het scherm:
// "nu bijwerken" hoort bij `available`, "herstarten" bij `downloaded`.
const PRIMARY = `shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-blue-500 motion-reduce:transition-none ${FOCUS_RING}`;

function updateStatusText(u: UpdateStatus, S: UiStrings): string {
  switch (u.state) {
    case 'checking':
      return S.updChecking;
    case 'available':
      return S.updAvailable(u.version ?? '');
    case 'not-available':
      return S.updLatest;
    case 'downloading':
      return S.updDownloading(u.percent ?? 0);
    case 'downloaded':
      return S.updDownloaded;
    case 'error':
      return S.updError(u.message ?? 'unknown error');
    case 'dev':
      return S.updDev;
    default:
      return '';
  }
}

// Toon de changelog-regels in de taal van de interface. Het bestand mengt
// Engelse (### Fixed) en Nederlandse (### Opgelost) koppen binnen één versie;
// pak wat bij de interface past, en val terug op de andere taal als een versie
// daar niets heeft. Versies zonder koppen komen er ongewijzigd door.
function entriesForLang(v: ChangelogVersion, uiLang: 'en' | 'nl'): ChangelogEntry[] {
  const hasLangTagged = v.entries.some((e) => e.lang !== 'unknown');
  if (!hasLangTagged) return v.entries;
  const matching = v.entries.filter((e) => e.lang === uiLang);
  if (matching.length) return matching;
  return v.entries.filter((e) => e.lang !== 'unknown');
}

// Minimale inline-markdown: **vet** wordt vet, de rest blijft tekst.
function renderInline(text: string): ReactNode {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
    );
}

function ChangelogVersionBlock({
  version,
  uiLang,
  S,
}: {
  version: ChangelogVersion;
  uiLang: 'en' | 'nl';
  S: UiStrings;
}) {
  const entries = entriesForLang(version, uiLang);
  return (
    <div>
      {/* Versienummer en datum zijn gegevens: `tabular-nums`, zodat de nummers
          van opeenvolgende versies onder elkaar op dezelfde plek staan. */}
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[13.5px] font-semibold tabular-nums">
          {S.changelogVersionPrefix} {version.version}
        </span>
        {version.date && <span className="text-xs tabular-nums text-neutral-500">{version.date}</span>}
      </div>
      {entries.map((entry, ei) => {
        const label = S.changelogCategory(entry.heading);
        return (
          <div key={ei} className="mb-2 last:mb-0">
            {label && (
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</div>
            )}
            <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed">
              {entry.items.map((item, ii) => (
                <li key={ii}>{renderInline(item)}</li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// Over de app: naam, versie, updatestatus met de knoppen die bij die stand
// horen, en de changelog eronder.
export function AboutSection({
  S,
  uiLang,
  update,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
}: {
  S: UiStrings;
  uiLang: 'en' | 'nl';
  update: UpdateStatus;
  onCheckUpdate: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
}) {
  // De changelog komt één keer uit het hoofdproces, dat CHANGELOG.md leest.
  const [changelog, setChangelog] = useState<ChangelogVersion[]>([]);
  const [showOlder, setShowOlder] = useState(false);
  useEffect(() => {
    let alive = true;
    window.desktop
      ?.getChangelog()
      .then((v) => {
        if (alive) setChangelog(Array.isArray(v) ? v : []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const busy = update.state === 'checking' || update.state === 'downloading';
  const statusText = updateStatusText(update, S);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[20px] font-semibold tracking-tight">{S.sectionAbout}</h2>

      <div className={CARD}>
        <SettingRow label={APP_NAME}>
          {/* Het versienummer is gegevens: `tabular-nums`. */}
          <span className="text-[13px] tabular-nums text-neutral-500">
            {S.versionPrefix} {update.currentVersion ?? '—'}
          </span>
        </SettingRow>

        {/* De stand van de update staat als bijtekst onder de naam van de rij, en
            de knoppen die bij die stand horen ernaast. Ook een fout staat in
            `neutral-500`: rood is een tint, en de richting laat er maar één toe.
            De tekst zelf zegt wat er mis is ("Couldn't check for updates: …"). */}
        <SettingRow label={S.updates} description={statusText || undefined}>
          {update.state === 'available' && (
            <button type="button" onClick={onDownloadUpdate} className={PRIMARY}>
              {S.updateNow}
            </button>
          )}
          {update.state === 'downloaded' && (
            <button type="button" onClick={onInstallUpdate} className={PRIMARY}>
              {S.restartInstall}
            </button>
          )}
          <button type="button" onClick={onCheckUpdate} disabled={busy} className={BUTTON}>
            {update.state === 'checking' ? S.checking : S.checkForUpdates}
          </button>
        </SettingRow>
      </div>

      <h3 className="mt-2 text-[13.5px] font-semibold">{S.sectionWhatsNew}</h3>

      <div className="rounded-xl border border-black/[0.08] bg-white p-4 dark:border-white/[0.08] dark:bg-neutral-900">
        {changelog.length === 0 ? (
          <p className="text-[13px] text-neutral-500">{S.changelogEmpty}</p>
        ) : (
          <>
            <ChangelogVersionBlock version={changelog[0]} uiLang={uiLang} S={S} />
            {changelog.length > 1 && (
              <>
                {showOlder && (
                  <div className="mt-4 flex flex-col gap-4 border-t border-black/[0.08] pt-4 dark:border-white/[0.08]">
                    {changelog.slice(1).map((v) => (
                      <ChangelogVersionBlock key={v.version} version={v} uiLang={uiLang} S={S} />
                    ))}
                  </div>
                )}
                {/* Geen blauwe tekstlink: het blauw in dit paneel is van de
                    updateknop. Dit is een knop die tekst uitklapt. */}
                <button
                  type="button"
                  onClick={() => setShowOlder((s) => !s)}
                  aria-expanded={showOlder}
                  className={`mt-3 rounded text-[13px] font-medium text-neutral-500 transition hover:text-neutral-900 dark:hover:text-neutral-100 motion-reduce:transition-none ${FOCUS_RING}`}
                >
                  {showOlder ? S.hideOlder : S.showOlder}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
