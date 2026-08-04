'use client';

import type { Prefs } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';
import { DANGER_TEXT, FIELD, HINT } from './tokens';

// Verificatiecodes: de app leest een binnengekomen bericht, herkent er een code in
// en zet die op het klembord. Alles staat standaard uit — zie
// `electron/prefs-store.ts`.
//
// De sectie bestaat uit twee groepen, en die scheiding is de betekenis: bovenin
// staat wát er wordt herkend, onderin wat er ná het kopiëren met de mail gebeurt.
// De tweede groep heeft geen kop, want er is geen tekst voor; de haarlijn zegt al
// dat het over iets anders gaat.
export function VerificationCodesSection({ S, prefs }: { S: UiStrings; prefs: Prefs | null }) {
  const vc = prefs?.verificationCodes;
  // Staat het kopiëren uit, dan gebeurt er niets: er wordt niet gezocht, dus de
  // zekerheid doet niets, en er wordt niet gekopieerd, dus "daarna" bestaat niet.
  // De drie rijen worden uitgeschakeld en niet verborgen — verdwijnt een rij, dan
  // verspringt de sectie onder je handen zodra je de schakelaar erboven omzet, en
  // dan is ook niet meer te zien dát die keuzes bestaan. Zelfde afweging als bij
  // het tray-icoon in `AppearanceSection`.
  const locked = vc?.autoCopy !== true;

  return (
    <Section title={S.navVerificationCodes}>
      {/* Bovenaan en niet als voetnoot: de vier schakelaars hieronder schrijven wél
          een voorkeur weg, maar er is nog niets dat op nieuwe post reageert. Wie dat
          niet weet, zet ze aan en concludeert dat de app stuk is. Het herkennen zelf
          is er (electron/verification-code.ts, met tests); wat ontbreekt is de haak op
          binnenkomende mail, en voor "gelezen" en "weggooien" een Google-recht dat de
          app nooit heeft gevraagd. */}
      <SettingsGroup>
        <p className={`mb-1 max-w-[46ch] ${HINT}`}>{S.vcNotWiredYet}</p>
      </SettingsGroup>

      <SettingsGroup>
        <SettingRow label={S.vcAutoCopy} description={S.vcAutoCopyDescription} htmlFor="setting-vc-auto-copy">
          <Switch
            id="setting-vc-auto-copy"
            checked={vc?.autoCopy === true}
            onChange={(v) => window.desktop?.setVerificationCodes({ autoCopy: v })}
          />
        </SettingRow>

        <SettingRow
          label={S.vcConfidence}
          description={S.vcConfidenceDescription}
          htmlFor="setting-vc-confidence"
        >
          <select
            id="setting-vc-confidence"
            disabled={locked}
            value={vc?.confidence ?? 'high'}
            onChange={(e) =>
              window.desktop?.setVerificationCodes({
                confidence: e.target.value as 'medium' | 'high',
              })
            }
            className={`${FIELD} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <option value="medium">{S.vcConfidenceMedium}</option>
            <option value="high">{S.vcConfidenceHigh}</option>
          </select>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup>
        <SettingRow label={S.vcMarkRead} description={S.vcMarkReadDescription} htmlFor="setting-vc-mark-read">
          <Switch
            id="setting-vc-mark-read"
            disabled={locked}
            checked={vc?.markRead === true}
            onChange={(v) => window.desktop?.setVerificationCodes({ markRead: v })}
          />
        </SettingRow>

        {/* De enige onomkeerbare instelling in dit paneel, en de enige rij met een
            rode regel eronder. Rood is in dit paneel voorbehouden aan gevaar (zie
            de uitleg boven `DANGER_TEXT` in ./tokens), en dit is precies dat:
            herkent de app het verkeerde getal, dan gooit hij een echte mail weg en
            is er niets dat dat terugdraait. De waarschuwing staat daarom in de rij
            zelf en niet als losse regel onderaan de sectie — hij hoort bij deze
            schakelaar en moet meebewegen met de blik die op die schakelaar landt.
            Geen apart getint vlak (`DANGER_PANEL`): dat is voor een vraag die je
            moet beantwoorden, en dit is een keuze die je maakt. */}
        <SettingRow
          label={S.vcDelete}
          description={
            <>
              {S.vcDeleteDescription}
              <span className={`mt-1 block font-medium ${DANGER_TEXT}`}>{S.vcDeleteWarning}</span>
            </>
          }
          htmlFor="setting-vc-delete"
        >
          <Switch
            id="setting-vc-delete"
            disabled={locked}
            checked={vc?.deleteAfter === true}
            onChange={(v) => window.desktop?.setVerificationCodes({ deleteAfter: v })}
          />
        </SettingRow>
      </SettingsGroup>
    </Section>
  );
}
