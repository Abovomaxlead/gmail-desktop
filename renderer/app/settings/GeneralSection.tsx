'use client';

import type { Prefs } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';

// Algemeen: hoe de app zich tegenover Windows gedraagt. Wat hij met een
// mail-link doet, en wat hij doet als je je aanmeldt. Alles wat over het uiterlijk
// gaat staat bij Weergave, alles over meldingen bij Meldingen — deze sectie is de
// eerste in de kolom en hoort daarom de twee dingen te bevatten die je meteen na
// het installeren wil zetten.
export function GeneralSection({
  S,
  prefs,
  isDefaultMail,
  onSetAutoStart,
  onSetLaunchMinimized,
  onSetDefaultMail,
}: {
  S: UiStrings;
  prefs: Prefs | null;
  isDefaultMail: boolean;
  onSetAutoStart: (v: boolean) => void;
  onSetLaunchMinimized: (v: boolean) => void;
  onSetDefaultMail: (v: boolean) => void;
}) {
  return (
    <Section title={S.navGeneral}>
      <SettingsGroup>
        {/* De stand komt niet uit de voorkeuren maar uit Windows zelf
            (`app.isDefaultProtocolClient`), want daar staat hij: de gebruiker kan
            hem ook buiten deze app om omzetten. Daarom is dit de enige schakelaar
            in het paneel die een aparte prop voor zijn stand heeft. */}
        <SettingRow
          label={S.defaultMailClient}
          description={S.defaultMailClientDescription}
          htmlFor="setting-default-mail"
        >
          <Switch id="setting-default-mail" checked={isDefaultMail} onChange={onSetDefaultMail} />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={S.startup}>
        <SettingRow label={S.autoStart} description={S.autoStartDescription} htmlFor="setting-auto-start">
          <Switch id="setting-auto-start" checked={!!prefs?.autoStart} onChange={onSetAutoStart} />
        </SettingRow>

        {/* Geminimaliseerd starten heeft alleen zin als de app zelf opstart, maar
            de rij blijft aan te zetten als dat uit staat: je kan hem ook met de
            hand starten, en een control die uitgeschakeld raakt zodra je de rij
            erboven omzet leest als een fout. */}
        <SettingRow
          label={S.launchMinimized}
          description={S.launchMinimizedDescription}
          htmlFor="setting-launch-minimized"
        >
          <Switch
            id="setting-launch-minimized"
            checked={!!prefs?.launchMinimized}
            onChange={onSetLaunchMinimized}
          />
        </SettingRow>
      </SettingsGroup>
    </Section>
  );
}
