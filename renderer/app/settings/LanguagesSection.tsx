'use client';

import { useEffect, useState } from 'react';
import type { Prefs, SpellcheckLanguage } from '../page';
import type { UiStrings } from '../strings';
import { EmptyNote, Section, SettingsGroup } from './Section';
import { CHECKBOX, HAIRLINE, HINT, PANEL } from './tokens';

// Languages: which languages the spellchecker uses besides the system one. The
// available languages come from Chromium, since which dictionaries exist depends on
// the build. A scrolling list of checkboxes rather than a `<select multiple>`, where
// one stray click would wipe everything already chosen.

export function LanguagesSection({ S, prefs }: { S: UiStrings; prefs: Prefs | null }) {
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
