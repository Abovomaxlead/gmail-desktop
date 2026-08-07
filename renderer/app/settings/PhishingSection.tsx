'use client';

import type { Prefs } from '../page';
import type { UiStrings } from '../strings';
import { EmptyNote, Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';
import { DIVIDER, FOCUS_RING, HINT, PANEL } from './tokens';

// Phishing Protection: one look at the host before a link leaves for your browser,
// plus the hosts you chose to trust. It does not judge whether a host is malicious -
// there is no list behind it. Hosts are added from the confirmation dialog itself,
// not typed here, since a typo would silently trust the wrong host.

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

        <p className={`mt-1 max-w-[46ch] ${HINT}`}>{S.confirmExternalLinksGoogleNote}</p>
      </SettingsGroup>

      <SettingsGroup title={S.trustedHosts}>
        <p className={`mb-3 max-w-[46ch] ${HINT}`}>{S.trustedHostsDescription}</p>

        {hosts.length === 0 ? (
          <EmptyNote>{S.trustedHostsEmpty}</EmptyNote>
        ) : (
          <ul className={`${PANEL} divide-y ${DIVIDER}`}>
            {hosts.map((host) => (
              <li key={host} className="flex items-center justify-between gap-4 px-3 py-2">
                <span className="min-w-0 break-all text-[13px] tabular-nums">{host}</span>
                <button
                  type="button"
                  onClick={() =>
                    window.desktop?.setPhishing({ trustedHosts: hosts.filter((h) => h !== host) })
                  }
                  aria-label={S.trustedHostRemove(host)}
                  title={S.trustedHostRemove(host)}
                  className={`shrink-0 rounded text-[13px] font-medium text-neutral-500 dark:text-neutral-400 transition hover:text-neutral-900 dark:hover:text-neutral-100 motion-reduce:transition-none ${FOCUS_RING}`}
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
