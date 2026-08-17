'use client';

import { useEffect, useRef, useState } from 'react';
import type { Prefs, Profile, UpdateStatus } from './page';
import { advanceReneSequence, RENE_SEQUENCE } from './settings-utils';
import { getStrings, type UiStrings } from './strings';
import { AboutSection } from './settings/AboutSection';
import { AccountsSection } from './settings/AccountsSection';
import { AdvancedSection } from './settings/AdvancedSection';
import { AppearanceSection } from './settings/AppearanceSection';
import { DownloadHistorySection } from './settings/DownloadHistorySection';
import { DownloadsSection } from './settings/DownloadsSection';
import { GeneralSection } from './settings/GeneralSection';
import { GoogleAppsSection } from './settings/GoogleAppsSection';
import { NotificationsSection } from './settings/NotificationsSection';
import { PhishingSection } from './settings/PhishingSection';
import { EmptyNote, Section } from './settings/Section';
import { SettingsShell } from './settings/SettingsShell';
import { UpdatesSection } from './settings/UpdatesSection';
import { VerificationCodesSection } from './settings/VerificationCodesSection';
import { WhatsNewSection } from './settings/WhatsNewSection';
import { DEFAULT_SECTION, attentionFrom, type SettingsSection } from './settings/nav';
import { NOTICE } from './settings/tokens';

// The settings panel: the shell plus one section. Which section is open lives here and is
// deliberately not persisted, and sectionLabel is a switch so the compiler catches a
// section without a name.
//
// Also home to the Rene key sequence, which listens only while the panel is mounted and
// never consumes the key it sees.


//===========================
// Component
//===========================

export function SettingsPanel({
  profiles,
  onClose,
  onRedetect,
  update,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
  prefs,
  onSetAutoStart,
  onSetLaunchMinimized,
  onSetNotifications,
  isDefaultMail,
  onRequestDefaultMail,
}: {
  profiles: Profile[];
  onClose: () => void;
  onRedetect: () => void;
  update: UpdateStatus;
  onCheckUpdate: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
  prefs: Prefs | null;
  onSetAutoStart: (v: boolean) => void;
  onSetLaunchMinimized: (v: boolean) => void;
  onSetNotifications: (arg: {
    dnd: boolean;
    quietHours: { enabled: boolean; start: string; end: string };
  }) => void;
  isDefaultMail: boolean;
  onRequestDefaultMail: () => void;
}) {
  const [section, setSection] = useState<SettingsSection>(DEFAULT_SECTION);

  const rene = prefs?.reneMode === true;
  const S = getStrings(prefs?.locale ?? 'en', rene);
  const uiLang: 'en' | 'nl' = rene ? 'nl' : 'en';

  const seqProgress = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const next = advanceReneSequence(seqProgress.current, e.key);
      if (next === RENE_SEQUENCE.length) {
        seqProgress.current = 0;
        window.desktop?.setReneMode(!rene);
      } else {
        seqProgress.current = next;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [rene]);

  return (
    <SettingsShell
      sectionLabel={(s) => sectionLabel(s, S)}
      active={section}
      onSelect={setSection}
      attention={attentionFrom(prefs?.notifications, update.state)}
      attentionLabel={S.settingsAttention}
      onClose={onClose}
      closeLabel={S.close}
      escLabel={S.escKey}
      banner={rene ? <div className={NOTICE}>{S.reneBanner}</div> : undefined}
    >
      {(() => {
        switch (section) {
          case 'general':
            return (
              <GeneralSection
                S={S}
                prefs={prefs}
                isDefaultMail={isDefaultMail}
                onSetAutoStart={onSetAutoStart}
                onSetLaunchMinimized={onSetLaunchMinimized}
                onRequestDefaultMail={onRequestDefaultMail}
              />
            );
          case 'accounts':
            return (
              <AccountsSection S={S} profiles={profiles} onRedetect={onRedetect} />
            );
          case 'google-apps':
            return <GoogleAppsSection S={S} prefs={prefs} />;
          case 'appearance':
            return <AppearanceSection S={S} prefs={prefs} />;
          case 'download-history':
            return <DownloadHistorySection S={S} />;
          case 'verification-codes':
            return <VerificationCodesSection S={S} prefs={prefs} />;
          case 'downloads':
            return <DownloadsSection S={S} prefs={prefs} />;
          case 'phishing-protection':
            return <PhishingSection S={S} prefs={prefs} />;
          case 'advanced':
            return <AdvancedSection S={S} prefs={prefs} />;
          case 'notifications':
            return (
              <NotificationsSection
                S={S}
                prefs={prefs}
                profiles={profiles}
                onSetNotifications={onSetNotifications}
              />
            );
          case 'updates':
            return (
              <UpdatesSection
                S={S}
                prefs={prefs}
                update={update}
                onCheckUpdate={onCheckUpdate}
                onDownloadUpdate={onDownloadUpdate}
                onInstallUpdate={onInstallUpdate}
              />
            );
          case 'whats-new':
            return <WhatsNewSection S={S} uiLang={uiLang} />;
          case 'about':
            return <AboutSection S={S} update={update} />;
          default:
            return (
              <Section title={sectionLabel(section, S)}>
                <EmptyNote>{S.sectionEmpty}</EmptyNote>
              </Section>
            );
        }
      })()}
    </SettingsShell>
  );
}


//===========================
// Helper functions
//===========================

function sectionLabel(section: SettingsSection, S: UiStrings): string {
  switch (section) {
    case 'download-history':
      return S.navDownloadHistory;
    case 'general':
      return S.navGeneral;
    case 'accounts':
      return S.navAccounts;
    case 'appearance':
      return S.navAppearance;
    case 'downloads':
      return S.navDownloads;
    case 'google-apps':
      return S.navGoogleApps;
    case 'notifications':
      return S.navNotifications;
    case 'phishing-protection':
      return S.navPhishingProtection;
    case 'updates':
      return S.navUpdates;
    case 'verification-codes':
      return S.navVerificationCodes;
    case 'advanced':
      return S.navAdvanced;
    case 'whats-new':
      return S.navWhatsNew;
    case 'about':
      return S.navAbout;
  }
}
