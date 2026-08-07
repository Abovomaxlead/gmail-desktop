'use client';

import type { ReactNode } from 'react';
import { SURFACES, SURFACE_CONFIG, type Surface } from '../../lib/surfaces';
import type { Prefs } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';
import { CHECKBOX, FOCUS_RING, HAIRLINE, HINT, PANEL } from './tokens';

// Google Apps: how Calendar and the other Google apps open, and which of them are
// pinned to the title bar. The app list comes from renderer/lib/surfaces.ts so it
// cannot drift from the tab menu, minus mail. `known()` filters out keys a prefs
// file from another version may still hold, and every write sends that cleaned list.
// The new-window row is disabled rather than hidden so the section does not jump.
//
// Either master switch settles every app at once - "open in app" off sends them all to
// the browser, "always a new window" gives them all their own window - and in both
// cases googleAppTarget never reaches the exclusion list. So the list is disabled while
// either is set, with a line saying which switch is deciding: ticking apps there would
// be double work. The ticks are kept, not cleared, so they come back into play once
// both switches are off again.

const GOOGLE_APPS: readonly Surface[] = SURFACES.filter((s) => s !== 'mail');

const appLabel = (s: Surface): string => SURFACE_CONFIG[s].label;

function known(keys: readonly string[]): Surface[] {
  const out: Surface[] = [];
  for (const key of keys) {
    const match = GOOGLE_APPS.find((s) => s === key);
    if (match && !out.includes(match)) out.push(match);
  }
  return out;
}

const EXCLUDED_LABEL_ID = 'setting-ga-excluded-label';

export function GoogleAppsSection({ S, prefs }: { S: UiStrings; prefs: Prefs | null }) {
  const ga = prefs?.googleApps;
  const allExternal = ga?.openInApp === false;
  const allNewWindow = !allExternal && ga?.alwaysNewWindow === true;
  const settled = allExternal || allNewWindow;
  const excluded = known(ga?.excluded ?? []);
  const pinned = known(ga?.pinned ?? []);
  const available = GOOGLE_APPS.filter((s) => !pinned.includes(s));

  const toggleExcluded = (s: Surface, on: boolean) => {
    const next = on ? [...excluded, s] : excluded.filter((k) => k !== s);
    window.desktop?.setGoogleApps({ excluded: next });
  };
  const pin = (s: Surface) => window.desktop?.setGoogleApps({ pinned: [...pinned, s] });
  const unpin = (s: Surface) =>
    window.desktop?.setGoogleApps({ pinned: pinned.filter((k) => k !== s) });

  return (
    <Section title={S.navGoogleApps}>
      <SettingsGroup>
        <SettingRow
          label={S.gaOpenInApp}
          description={S.gaOpenInAppDescription}
          htmlFor="setting-ga-open-in-app"
        >
          <Switch
            id="setting-ga-open-in-app"
            checked={ga?.openInApp !== false}
            onChange={(v) => window.desktop?.setGoogleApps({ openInApp: v })}
          />
        </SettingRow>

        <SettingRow
          label={S.gaAlwaysNewWindow}
          description={S.gaAlwaysNewWindowDescription}
          htmlFor="setting-ga-new-window"
        >
          <Switch
            id="setting-ga-new-window"
            disabled={ga?.openInApp === false}
            checked={ga?.alwaysNewWindow === true}
            onChange={(v) => window.desktop?.setGoogleApps({ alwaysNewWindow: v })}
          />
        </SettingRow>

        <div className="py-3">
          <p id={EXCLUDED_LABEL_ID} className="text-[13.5px] font-medium leading-5">
            {S.gaExcluded}
          </p>
          <p className={`mt-1 max-w-[46ch] ${HINT}`}>
            {allExternal
              ? S.gaExcludedAllExternal
              : allNewWindow
                ? S.gaExcludedAllNewWindow
                : S.gaExcludedDescription}
          </p>
          <p className={`mb-2 mt-2 ${HINT}`}>
            {excluded.length === 0 ? S.gaExcludedNone : excluded.map(appLabel).join(', ')}
          </p>
          <div
            role="group"
            aria-labelledby={EXCLUDED_LABEL_ID}
            aria-disabled={settled || undefined}
            className={`${PANEL} p-1 ${settled ? 'opacity-50' : ''}`}
          >
            {GOOGLE_APPS.map((s) => (
              <label
                key={s}
                className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition motion-reduce:transition-none ${
                  settled
                    ? 'cursor-not-allowed'
                    : 'cursor-pointer hover:bg-black/[0.04] dark:hover:bg-white/5'
                }`}
              >
                <input
                  type="checkbox"
                  checked={excluded.includes(s)}
                  disabled={settled}
                  onChange={(e) => toggleExcluded(s, e.target.checked)}
                  className={`${CHECKBOX} disabled:cursor-not-allowed`}
                />
                <span className="min-w-0 flex-1 truncate">{appLabel(s)}</span>
              </label>
            ))}
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup>
        <SettingRow
          label={S.gaShowAccountLabel}
          description={S.gaShowAccountLabelDescription}
          htmlFor="setting-ga-account-label"
        >
          <Switch
            id="setting-ga-account-label"
            checked={ga?.showAccountLabel !== false}
            onChange={(v) => window.desktop?.setGoogleApps({ showAccountLabel: v })}
          />
        </SettingRow>

        <SettingRow
          label={S.gaShowAccountColor}
          description={S.gaShowAccountColorDescription}
          htmlFor="setting-ga-account-color"
        >
          <Switch
            id="setting-ga-account-color"
            checked={ga?.showAccountColor !== false}
            onChange={(v) => window.desktop?.setGoogleApps({ showAccountColor: v })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup>
        <div className="py-3">
          <p className="text-[13.5px] font-medium leading-5">{S.gaPinned}</p>
          <p className={`mt-1 max-w-[46ch] ${HINT}`}>{S.gaPinnedDescription}</p>

          <ChipRow heading={S.gaPinnedHeading}>
            {pinned.length === 0 ? (
              <span className={HINT}>{S.gaExcludedNone}</span>
            ) : (
              pinned.map((s) => (
                <Chip
                  key={s}
                  label={appLabel(s)}
                  action={S.gaUnpin(appLabel(s))}
                  glyph="×"
                  onClick={() => unpin(s)}
                />
              ))
            )}
          </ChipRow>

          <ChipRow heading={S.gaAvailableHeading}>
            {available.length === 0 ? (
              <span className={HINT}>{S.gaExcludedNone}</span>
            ) : (
              available.map((s) => (
                <Chip
                  key={s}
                  label={appLabel(s)}
                  action={S.gaPin(appLabel(s))}
                  glyph="+"
                  onClick={() => pin(s)}
                />
              ))
            )}
          </ChipRow>
        </div>
      </SettingsGroup>
    </Section>
  );
}

function ChipRow({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={heading} className="mt-3">
      <p className={`mb-1.5 ${HINT}`}>{heading}</p>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  label,
  action,
  glyph,
  onClick,
}: {
  label: string;
  action: string;
  glyph: '+' | '×';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={action}
      title={action}
      className={`inline-flex items-center gap-1.5 rounded-full border ${HAIRLINE} px-2.5 py-1 text-[13px] text-neutral-900 transition hover:bg-black/[0.04] dark:text-neutral-100 dark:hover:bg-white/5 motion-reduce:transition-none ${FOCUS_RING}`}
    >
      <span>{label}</span>
      <span aria-hidden className="text-neutral-500 dark:text-neutral-400">
        {glyph}
      </span>
    </button>
  );
}
