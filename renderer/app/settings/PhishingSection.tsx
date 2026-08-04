'use client';

import type { Prefs } from '../page';
import type { UiStrings } from '../strings';
import { EmptyNote, Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';
import { DIVIDER, FOCUS_RING, HINT, PANEL } from './tokens';

// Phishing Protection: één keer kijken naar de host voordat een link je browser in
// gaat.
//
// Wat het niet doet, en dat staat er ook: bepalen of een host kwaadaardig is. Er zit
// geen lijst achter en er wordt niets opgezocht. De winst is dat de bestemming je
// wordt voorgehouden op het moment dat het uitmaakt — bij een phishinglink is de
// zichtbare tekst betrouwbaar en de bestemming niet.
export function PhishingSection({ S, prefs }: { S: UiStrings; prefs: Prefs | null }) {
  const hosts = prefs?.phishing.trustedHosts ?? [];

  return (
    <Section title={S.navPhishingProtection}>
      <SettingsGroup>
        <SettingRow
          label={S.confirmExternalLinks}
          description={S.confirmExternalLinksDescription}
          htmlFor="setting-confirm-links"
        >
          <Switch
            id="setting-confirm-links"
            checked={prefs?.phishing.confirmExternalLinks === true}
            onChange={(v) => window.desktop?.setPhishing({ confirmExternalLinks: v })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={S.trustedHosts}>
        {/* Hoe de lijst groeit staat erbij, want er is hier geen invulveld en dat is
            een keuze: een host met de hand typen is een typefout die stil een
            verkeerde host vertrouwd maakt. Je vult de lijst in het vraagvenster
            zelf, op het moment dat je een link toch opent. */}
        <p className={`mb-3 max-w-[46ch] ${HINT}`}>{S.trustedHostsDescription}</p>

        {hosts.length === 0 ? (
          <EmptyNote>{S.trustedHostsEmpty}</EmptyNote>
        ) : (
          <ul className={`${PANEL} divide-y ${DIVIDER}`}>
            {hosts.map((host) => (
              <li key={host} className="flex items-center justify-between gap-4 px-3 py-2">
                {/* De host is gegevens: `tabular-nums` en `break-all`, want een lange
                    hostnaam moet te lezen zijn en niet afgekapt — juist hier is elk
                    teken het punt. */}
                <span className="min-w-0 break-all text-[13px] tabular-nums">{host}</span>
                <button
                  type="button"
                  onClick={() =>
                    window.desktop?.setPhishing({ trustedHosts: hosts.filter((h) => h !== host) })
                  }
                  aria-label={S.trustedHostRemove(host)}
                  title={S.trustedHostRemove(host)}
                  className={`shrink-0 rounded text-[13px] font-medium text-neutral-500 transition hover:text-neutral-900 dark:hover:text-neutral-100 motion-reduce:transition-none ${FOCUS_RING}`}
                >
                  {S.remove}
                </button>
              </li>
            ))}
          </ul>
        )}
      </SettingsGroup>
    </Section>
  );
}
