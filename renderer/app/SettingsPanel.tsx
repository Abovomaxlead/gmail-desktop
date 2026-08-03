'use client';

import { useEffect, useRef, useState } from 'react';
import type { Prefs, Profile, UpdateStatus } from './page';
import { advanceReneSequence, RENE_SEQUENCE } from './settings-utils';
import { getStrings, type UiStrings } from './strings';
import { AboutSection } from './settings/AboutSection';
import { AccountsSection } from './settings/AccountsSection';
import { GeneralSection } from './settings/GeneralSection';
import { NotificationsSection } from './settings/NotificationsSection';
import { SettingsShell } from './settings/SettingsShell';
import { attentionFrom, type SettingsSection } from './settings/nav';
import { NOTICE } from './settings/tokens';

// De namen in de navigatiekolom. Aparte, korte sleutels: in de kolom is ruimte
// voor één woord, in de sectiekop erboven voor een hele naam.
function sectionLabel(section: SettingsSection, S: UiStrings): string {
  switch (section) {
    case 'general':
      return S.navGeneral;
    case 'notifications':
      return S.navNotifications;
    case 'accounts':
      return S.navAccounts;
    case 'about':
      return S.navAbout;
  }
}

// Het instellingenpaneel is de schil plus één sectie. Alle opmaak zit in
// `settings/`; hier staat wat er tussen de secties gedeeld is: welke sectie open
// is, de opgeslagen-melding, en het Rene-easteregg.
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
  onSetNotifications: (arg: {
    dnd: boolean;
    quietHours: { enabled: boolean; start: string; end: string };
  }) => void;
  isDefaultMail: boolean;
  onSetDefaultMail: () => void;
}) {
  // Algemeen staat vooraan omdat je daar het vaakst komt. De keuze leeft alleen
  // zolang het paneel open is: bij de volgende keer openen wil je weer bovenaan
  // beginnen, niet in de sectie waar je vorige week iets zocht.
  const [section, setSection] = useState<SettingsSection>('general');

  const rene = prefs?.reneMode === true;
  const S = getStrings(rene);
  // De Rene-stand kiest de taal van het hele paneel, dus ook die van de
  // changelog. Eén bron: `prefs.reneMode` hierboven, en `AboutSection` leidt er
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

  // "Opgeslagen ✓": knippert zodra het hoofdproces bijgewerkte voorkeuren
  // terugstuurt (het wegschrijven is dan al gebeurd), en als er op Bewaren wordt
  // gedrukt.
  const [savedFlash, setSavedFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstPrefs = useRef(true);
  const flashSaved = () => {
    setSavedFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setSavedFlash(false), 2000);
  };
  useEffect(() => {
    if (!prefs) return;
    if (firstPrefs.current) {
      firstPrefs.current = false;
      return;
    }
    flashSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs]);
  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  // Elke control legt zichzelf meteen vast; Bewaren maakt daarnaast een
  // label-wijziging af die nog in het veld staat (die gaat normaal op blur of
  // Enter) en bevestigt zichtbaar dat er niets openstaat.
  const saveNow = () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    flashSaved();
  };

  return (
    <SettingsShell
      title={S.settingsTitle}
      sectionLabel={(s) => sectionLabel(s, S)}
      active={section}
      onSelect={setSection}
      // Een puntje bij Meldingen als je meldingen uit staan, en bij Over als er
      // een update op je wacht. Het samenstellen staat in `nav.ts` en is daar
      // getest: "meldingen uit" is niet alleen de schakelaar in dit paneel maar
      // ook een tijdelijke demping uit het tray-menu (`dndUntil`), en juist dat
      // tweede geval is waarvoor je een puntje wil zien.
      attention={attentionFrom(prefs?.notifications, update.state)}
      attentionLabel={S.settingsAttention}
      saved={savedFlash}
      onSave={saveNow}
      onClose={onClose}
      saveLabel={S.save}
      savedLabel={S.saved}
      closeLabel={S.close}
      // De strook was geel: een vierde tint in een paneel dat er drie toestaat
      // (identiteit, de knop die een update uitvoert, gevaar). Zie `NOTICE` in
      // `tokens.ts` voor waarom hij nu grijs is en waar die keuze staat.
      banner={rene ? <div className={NOTICE}>{S.reneBanner}</div> : undefined}
    >
      {section === 'general' && (
        <GeneralSection
          S={S}
          prefs={prefs}
          isDefaultMail={isDefaultMail}
          onSetAutoStart={onSetAutoStart}
          onSetDefaultMail={onSetDefaultMail}
        />
      )}
      {/* Meldingen krijgt de accounts erbij: de schakelaars per account staan
          daar, want daar ga je kijken als je je afvraagt wat je bereikt. Accounts
          houdt wie een account is, en heeft `prefs` daarom niet meer nodig — het
          label, de kleur en de avatar staan al in het profiel. */}
      {section === 'notifications' && (
        <NotificationsSection
          S={S}
          prefs={prefs}
          profiles={profiles}
          onSetNotifications={onSetNotifications}
        />
      )}
      {section === 'accounts' && (
        <AccountsSection S={S} profiles={profiles} onRedetect={onRedetect} />
      )}
      {section === 'about' && (
        <AboutSection
          S={S}
          uiLang={uiLang}
          update={update}
          onCheckUpdate={onCheckUpdate}
          onDownloadUpdate={onDownloadUpdate}
          onInstallUpdate={onInstallUpdate}
        />
      )}
    </SettingsShell>
  );
}
