'use client';

import type { Prefs } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';
import { HINT } from './tokens';

// Gmail: wat de app in Gmail's eigen pagina verandert. Drie groepen, en die
// indeling is niet cosmetisch — hij scheidt twee soorten ingrepen die anders
// stukgaan. "Weergave" en "Postvak" zijn CSS die over Google's pagina heen gaat
// (electron/gmail-tweaks.ts); "Opstellen" verandert niets aan die pagina maar aan
// de app zelf (het opstelvenster). Wie ze door elkaar zet, gaat later zoeken
// waarom de ene helft na een Gmail-update stil is opgehouden en de andere niet.
//
// Elke schakelaar leest `=== true` en niet `!== false`. Alles staat standaard uit:
// dit zijn ingrepen in een pagina die niet van ons is, en wie de app bijwerkt hoort
// zijn Gmail te zien zoals Google hem levert totdat hij zelf iets omzet. Met
// `!== false` zou een voorkeurenbestand van vóór deze tab alles ineens aan hebben.
export function GmailSection({ S, prefs }: { S: UiStrings; prefs: Prefs | null }) {
  const gmail = prefs?.gmail;

  return (
    <Section title={S.navGmail}>
      <SettingsGroup title={S.gmailAppearanceGroup}>
        <SettingRow
          label={S.gmailHideLogo}
          description={S.gmailHideLogoDescription}
          htmlFor="setting-gmail-hide-logo"
        >
          <Switch
            id="setting-gmail-hide-logo"
            checked={gmail?.hideLogo === true}
            onChange={(v) => window.desktop?.setGmail({ hideLogo: v })}
          />
        </SettingRow>

        {/* De balk die zegt dat je automatische antwoord aan staat. Verbergen haalt
            de balk weg en niet het antwoord: het staat nog aan, je ziet het alleen
            niet meer bovenaan. Dat verschil hoort in de bijtekst te staan. */}
        <SettingRow
          label={S.gmailHideOutOfOffice}
          description={S.gmailHideOutOfOfficeDescription}
          htmlFor="setting-gmail-hide-out-of-office"
        >
          <Switch
            id="setting-gmail-hide-out-of-office"
            checked={gmail?.hideOutOfOfficeBanner === true}
            onChange={(v) => window.desktop?.setGmail({ hideOutOfOfficeBanner: v })}
          />
        </SettingRow>

        <SettingRow
          label={S.gmailHideUpgrade}
          description={S.gmailHideUpgradeDescription}
          htmlFor="setting-gmail-hide-upgrade"
        >
          <Switch
            id="setting-gmail-hide-upgrade"
            checked={gmail?.hideUpgradeButton === true}
            onChange={(v) => window.desktop?.setGmail({ hideUpgradeButton: v })}
          />
        </SettingRow>

        {/* Deze drie werken door in Gmail's eigen pagina te grijpen, en die pagina is
            van Google. Dat hoort er te staan: gaat er ooit een schakelaar niets meer
            doen, dan is dít de reden, en dan weet je dat het niet aan jou ligt en dat
            het te repareren is. Zonder deze regel lijkt het een kapotte app. */}
        <p className={`mt-1 max-w-[46ch] ${HINT}`}>{S.gmailTweakFragile}</p>
      </SettingsGroup>

      <SettingsGroup title={S.gmailComposeGroup}>
        <SettingRow
          label={S.gmailComposeNewWindow}
          description={S.gmailComposeNewWindowDescription}
          htmlFor="setting-gmail-compose-new-window"
        >
          <Switch
            id="setting-gmail-compose-new-window"
            checked={gmail?.alwaysComposeInNewWindow === true}
            onChange={(v) => window.desktop?.setGmail({ alwaysComposeInNewWindow: v })}
          />
        </SettingRow>

        {/* "Sluit het opstelvenster na verzenden" hoort hier ook, en is geen
            schakelaar maar een regel. Dat is de afspraak uit `GmailPrefs`: die stand
            vraagt een haak binnen Gmail's eigen opstelpagina, en dat venster draait
            met opzet zonder onze preload. Waarom het er niet is staat in beeld en
            niet alleen in dit commentaar — dezelfde aanpak als `trayColourTodo` bij
            Weergave: wie de rij zoekt en niet vindt, hoort te lezen waarom. */}
        <p className={`mt-1 max-w-[46ch] ${HINT}`}>{S.gmailCloseComposeTodo}</p>
      </SettingsGroup>

      <SettingsGroup title={S.gmailInboxGroup}>
        <SettingRow
          label={S.gmailHideInboxFooter}
          description={S.gmailHideInboxFooterDescription}
          htmlFor="setting-gmail-hide-inbox-footer"
        >
          <Switch
            id="setting-gmail-hide-inbox-footer"
            checked={gmail?.hideInboxFooter === true}
            onChange={(v) => window.desktop?.setGmail({ hideInboxFooter: v })}
          />
        </SettingRow>
      </SettingsGroup>
    </Section>
  );
}
