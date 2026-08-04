'use client';

import { useEffect, useState } from 'react';
import type { Prefs, SpellcheckLanguage } from '../page';
import type { UiStrings } from '../strings';
import { EmptyNote, Section, SettingsGroup } from './Section';
import { CHECKBOX, HAIRLINE, HINT, PANEL } from './tokens';

// Talen: welke talen de spellingcontrole naast de systeemtaal meeneemt.
//
// Een lijst met vinkjes en geen keuzelijst met meervoudige selectie. Zo'n
// `<select multiple>` is met de muis een valkuil — één klik wist alles wat je al had
// gekozen — en met het toetsenbord nauwelijks te doen. De lijst is lang (Chromium
// kent er tientallen), dus hij scrollt binnen een eigen vlak in plaats van de sectie
// meters lang te maken.
export function LanguagesSection({ S, prefs }: { S: UiStrings; prefs: Prefs | null }) {
  // De beschikbare talen komen uit Chromium en niet uit een eigen lijst: welke
  // woordenboeken er zijn hangt af van de build, en een eigen lijst zou talen
  // aanbieden die niets doen.
  const [available, setAvailable] = useState<SpellcheckLanguage[]>([]);
  useEffect(() => {
    let alive = true;
    window.desktop
      ?.getSpellcheckLanguages()
      .then((list) => {
        if (alive) setAvailable(Array.isArray(list) ? list : []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const chosen = prefs?.languages.spellcheck ?? [];
  const toggle = (code: string, on: boolean) => {
    const next = on ? [...chosen, code] : chosen.filter((c) => c !== code);
    window.desktop?.setLanguages({ spellcheck: next });
  };

  return (
    <Section title={S.navLanguages}>
      <SettingsGroup title={S.spellchecker}>
        <p className={`mb-3 max-w-[46ch] ${HINT}`}>{S.spellcheckerDescription}</p>

        {available.length === 0 ? (
          <EmptyNote>{S.spellcheckerUnavailable}</EmptyNote>
        ) : (
          <>
            {/* De stand in woorden boven de lijst, want met een lijst van tientallen
                items is "wat staat er nu aan" anders alleen te vinden door te
                scrollen. */}
            <p className={`mb-2 ${HINT}`}>
              {chosen.length === 0 ? S.spellcheckerNone : S.spellcheckerChosen(chosen.length)}
            </p>
            <div className={`${PANEL} max-h-56 overflow-y-auto p-1`}>
              {available.map((lang) => (
                <label
                  key={lang.code}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition hover:bg-black/[0.04] dark:hover:bg-white/5 motion-reduce:transition-none`}
                >
                  <input
                    type="checkbox"
                    checked={chosen.includes(lang.code)}
                    onChange={(e) => toggle(lang.code, e.target.checked)}
                    className={CHECKBOX}
                  />
                  <span className="min-w-0 flex-1 truncate">{lang.label}</span>
                  {/* De code erbij: twee talen kunnen dezelfde naam krijgen ("Engels"
                      voor en-GB en en-US), en dan is de code het enige verschil. */}
                  <span className={`shrink-0 tabular-nums ${HINT}`}>{lang.code}</span>
                </label>
              ))}
            </div>
            <p className={`mt-2 border-t ${HAIRLINE} pt-2 ${HINT}`}>{S.spellcheckerSystemNote}</p>
          </>
        )}
      </SettingsGroup>
    </Section>
  );
}
