'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { ChangelogEntry, ChangelogVersion } from '../changelog-types';
import type { UiStrings } from '../strings';
import { EmptyNote, Section, SettingsGroup } from './Section';
import { FOCUS_RING, HAIRLINE } from './tokens';

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

// Wat is er nieuw: de changelog, met de nieuwste versie open en de rest achter een
// knop. Een eigen sectie in de kolom en niet een blok onderaan Over — het is de
// enige sectie die je leest in plaats van gebruikt, en onder Over kwam je hem
// alleen tegen als je toch al ergens anders naar zocht.
//
// Geen omlijnd blok om de tekst: de changelog is de inhoud van deze sectie, niet
// een ding erin. Een rand eromheen zou een kader om de hele sectie zetten.
export function WhatsNewSection({ S, uiLang }: { S: UiStrings; uiLang: 'en' | 'nl' }) {
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

  return (
    <Section title={S.navWhatsNew}>
      <SettingsGroup>
        {changelog.length === 0 ? (
          <EmptyNote>{S.changelogEmpty}</EmptyNote>
        ) : (
          <>
            <ChangelogVersionBlock version={changelog[0]} uiLang={uiLang} S={S} />
            {changelog.length > 1 && (
              <>
                {showOlder && (
                  <div className={`mt-4 flex flex-col gap-4 border-t ${HAIRLINE} pt-4`}>
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
                  className={`mt-3 self-start rounded text-[13px] font-medium text-neutral-500 transition hover:text-neutral-900 dark:hover:text-neutral-100 motion-reduce:transition-none ${FOCUS_RING}`}
                >
                  {showOlder ? S.hideOlder : S.showOlder}
                </button>
              </>
            )}
          </>
        )}
      </SettingsGroup>
    </Section>
  );
}
