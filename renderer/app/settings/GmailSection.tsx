'use client';

import type { Prefs } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';
import { HINT } from './tokens';

// Gmail: wat de app aan Gmail verandert. Twee groepen, en die indeling is niet
// cosmetisch — hij scheidt twee soorten ingrepen die anders stukgaan. "Postvak" is
// CSS die over Google's pagina heen gaat (electron/gmail-tweaks.ts); "Opstellen"
// verandert niets aan die pagina maar aan de app zelf (het opstelvenster). Wie ze
// door elkaar zet, gaat later zoeken waarom de ene helft na een Gmail-update stil is
// opgehouden en de andere niet.
//
// Hier stonden ook "verstop het logo", "verstop de afwezigheidsbalk" en "verstop de
// opslagknop". Die zijn er op verzoek weer uit; wat ze deden zat in dezelfde
// CSS-tabel als de tekst onderaan het postvak, en die tabel heeft nu één regel.
//
// Elke schakelaar leest `=== true` en niet `!== false`. Alles staat standaard uit:
// dit zijn ingrepen in een pagina die niet van ons is, en wie de app bijwerkt hoort
// zijn Gmail te zien zoals Google hem levert totdat hij zelf iets omzet. Met
// `!== false` zou een voorkeurenbestand van vóór deze tab alles ineens aan hebben.
export function GmailSection({ S, prefs }: { S: UiStrings; prefs: Prefs | null }) {
  const gmail = prefs?.gmail;

  return (
    <Section title={S.navGmail}>
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
        {/* Deze rij was eerst zo'n regel, en is nu een schakelaar: het venster dat de
            app zelf opent krijgt een eigen, minimale preload die alleen op Verzenden
            let. `disabled` zolang opstellen in een eigen venster uit staat — in
            Gmail's eigen hoekje is er geen venster om te sluiten, en een schakelaar
            die dan wél te zetten is belooft iets dat niet gebeurt. */}
        <SettingRow
          label={S.gmailCloseCompose}
          description={S.gmailCloseComposeDescription}
          htmlFor="setting-gmail-close-compose"
        >
          <Switch
            id="setting-gmail-close-compose"
            disabled={gmail?.alwaysComposeInNewWindow !== true}
            checked={gmail?.closeComposeAfterSend === true}
            onChange={(v) => window.desktop?.setGmail({ closeComposeAfterSend: v })}
          />
        </SettingRow>
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

        {/* De enige overgebleven ingreep in Gmail's eigen pagina, en dus de enige die
            stil kan ophouden te werken als Google daar iets omgooit. Dat hoort in
            beeld te staan: gebeurt het, dan is dít de reden, en dan weet je dat het
            niet aan jou ligt en dat het te repareren is. */}
        <p className={`mt-1 max-w-[46ch] ${HINT}`}>{S.gmailTweakFragile}</p>
      </SettingsGroup>
    </Section>
  );
}
