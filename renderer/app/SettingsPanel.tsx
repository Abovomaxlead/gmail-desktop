'use client';

import { useEffect, useRef, useState } from 'react';
import type { Prefs, Profile, UpdateStatus } from './page';
import { advanceReneSequence, RENE_SEQUENCE } from './settings-utils';
import { getStrings, type UiStrings } from './strings';
import { AboutSection } from './settings/AboutSection';
import { AccountsSection } from './settings/AccountsSection';
import { AdvancedSection } from './settings/AdvancedSection';
import { AppearanceSection } from './settings/AppearanceSection';
import { DownloadsSection } from './settings/DownloadsSection';
import { GeneralSection } from './settings/GeneralSection';
import { LanguagesSection } from './settings/LanguagesSection';
import { NotificationsSection } from './settings/NotificationsSection';
import { PhishingSection } from './settings/PhishingSection';
import { EmptyNote, Section } from './settings/Section';
import { SettingsShell } from './settings/SettingsShell';
import { UpdatesSection } from './settings/UpdatesSection';
import { WhatsNewSection } from './settings/WhatsNewSection';
import { DEFAULT_SECTION, attentionFrom, type SettingsSection } from './settings/nav';
import { NOTICE } from './settings/tokens';

// De naam van een sectie: in de kolom én als kop erboven. Eén naam per sectie, en
// daarom één sleutel per sectie — zie de opmerking bij `nav*` in `strings.ts`.
//
// Een `switch` en geen object met de secties als sleutels: dan klaagt de compiler
// zodra er een sectie in `nav.ts` bij komt zonder naam hier, in plaats van een
// naamloos item in de kolom te zetten.
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
    case 'blocker':
      return S.navBlocker;
    case 'downloads':
      return S.navDownloads;
    case 'gmail':
      return S.navGmail;
    case 'google-apps':
      return S.navGoogleApps;
    case 'languages':
      return S.navLanguages;
    case 'notifications':
      return S.navNotifications;
    case 'phishing-protection':
      return S.navPhishingProtection;
    case 'unified-inbox':
      return S.navUnifiedInbox;
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

// Het instellingenpaneel is de schil plus één sectie. Alle opmaak zit in
// `settings/`; hier staat wat er tussen de secties gedeeld is: welke sectie open
// is, welke component daarbij hoort, en het Rene-easteregg.
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
  onSetDefaultMail,
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
  onSetDefaultMail: (v: boolean) => void;
}) {
  // Algemeen staat vooraan omdat je daar het vaakst komt. De keuze leeft alleen
  // zolang het paneel open is: bij de volgende keer openen wil je weer bovenaan
  // beginnen, niet in de sectie waar je vorige week iets zocht.
  const [section, setSection] = useState<SettingsSection>(DEFAULT_SECTION);

  const rene = prefs?.reneMode === true;
  const S = getStrings(rene);
  // De Rene-stand kiest de taal van het hele paneel, dus ook die van de
  // changelog. Eén bron: `prefs.reneMode` hierboven, en `WhatsNewSection` leidt er
  // niets zelf uit af.
  const uiLang: 'en' | 'nl' = rene ? 'nl' : 'en';

  // Het Rene-easteregg (↑ ↓ ← → a b) werkt alleen hier: deze luisteraar bestaat
  // zolang het instellingenpaneel gemonteerd is. Toetsen in een tekstveld tellen
  // niet — daar zijn pijltjes en letters gewoon tekst bewerken.
  //
  // De navigatiekolom in de schil gebruikt óók ↑ en ↓, en de reeks begint met
  // precies die twee. Dat botst niet, en dat is geen toeval:
  //  * deze luisteraar hangt op `window` in de *capture*-fase, dus hij ziet elke
  //    toets voordat welk element in het paneel dan ook hem in handen krijgt —
  //    ook als de kolom ooit `stopPropagation()` zou gaan doen;
  //  * hij kijkt alléén mee: geen `preventDefault()`, geen `stopPropagation()`.
  //    De toets reist dus ongeschonden door naar de kolom, die hem gewoon
  //    afhandelt. De `preventDefault()` van de kolom stopt op zijn beurt alleen
  //    het scrollen van de browser en niet het doorgeven van de toets.
  // Het zijn dus een waarnemer en een verbruiker, en niet twee verbruikers die
  // om dezelfde toets vechten. Dat ↑ gevolgd door ↓ de kolom terugbrengt op de
  // sectie waar hij stond, en dat ← → a b daar niets doen, is een prettige
  // bijkomstigheid: de hele reeks laat de navigatie precies zoals hij was.
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
      // Een puntje bij Meldingen als je meldingen uit staan, en bij Bijwerken als
      // er een update op je wacht. Het samenstellen staat in `nav.ts` en is daar
      // getest: "meldingen uit" is niet alleen de schakelaar in dit paneel maar
      // ook een tijdelijke demping uit het tray-menu (`dndUntil`), en juist dat
      // tweede geval is waarvoor je een puntje wil zien.
      attention={attentionFrom(prefs?.notifications, update.state)}
      attentionLabel={S.settingsAttention}
      onClose={onClose}
      closeLabel={S.close}
      escLabel={S.escKey}
      banner={rene ? <div className={NOTICE}>{S.reneBanner}</div> : undefined}
    >
      {/* De secties die iets bevatten. De rest van de kolom staat in de `default`
          hieronder: een kop met één regel eronder dat er nog niets is ingericht.
          Dat is met opzet geen lijst met uitzonderingen — een sectie krijgt inhoud
          door hier een `case` te worden, en tot die tijd is hij er wel en doet hij
          niets, precies zoals hij in de kolom staat. */}
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
                onSetDefaultMail={onSetDefaultMail}
              />
            );
          case 'accounts':
            return <AccountsSection S={S} profiles={profiles} onRedetect={onRedetect} />;
          case 'appearance':
            return <AppearanceSection S={S} prefs={prefs} />;
          case 'downloads':
            return <DownloadsSection S={S} prefs={prefs} />;
          case 'languages':
            return <LanguagesSection S={S} prefs={prefs} />;
          case 'phishing-protection':
            return <PhishingSection S={S} prefs={prefs} />;
          case 'advanced':
            return <AdvancedSection S={S} prefs={prefs} />;
          // Meldingen krijgt de accounts erbij: de schakelaars per account staan
          // daar, want daar ga je kijken als je je afvraagt wat je bereikt.
          // Accounts houdt wie een account is.
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
