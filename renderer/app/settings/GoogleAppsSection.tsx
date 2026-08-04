'use client';

import type { ReactNode } from 'react';
import { SURFACES, SURFACE_CONFIG, type Surface } from '../../lib/surfaces';
import type { Prefs } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';
import { CHECKBOX, FOCUS_RING, HAIRLINE, HINT, PANEL } from './tokens';

// Google Apps: hoe de agenda en de andere Google-apps opengaan, wat er op een
// tabblad van zo'n app te zien is, en welke ervan als icoon in de titelbalk staan.
//
// De lijst apps komt uit `renderer/lib/surfaces.ts` en niet uit een eigen lijst
// hier. Dat is dezelfde afspraak als in het tabmenu: staat de lijst twee keer, dan
// krijgt de ene helft van de app een app erbij en de andere niet, en dan biedt dit
// paneel een vinkje aan voor iets dat nergens opengaat.
//
// Mail hoort er niet bij. "Open in de app" over de post zetten zou de app zichzelf
// naar de browser laten sturen — dan is er niets meer om in te stellen. Dit gaat
// over de ándere surfaces; `SURFACES` min mail is precies dat.
const GOOGLE_APPS: readonly Surface[] = SURFACES.filter((s) => s !== 'mail');

// De leesbare naam van een app komt uit `SURFACE_CONFIG[...].label` en staat dus
// niet in de stringsbundel. Bewust: het zijn de namen die Google zelf gebruikt
// ("Drive", "Keep"), die worden niet vertaald, en de balk en de OS-menu's tekenen
// ze al uit dezelfde kaart. Een tweede naam in `strings.ts` zou de twee uit elkaar
// laten lopen zodra er een app bijkomt.
const appLabel = (s: Surface): string => SURFACE_CONFIG[s].label;

// Alleen de sleutels die deze versie van de app kent, in de volgorde waarin ze op
// schijf stonden. Waarom: het voorkeurenbestand overleeft de app-versie, dus er kan
// een app in staan die hier niet meer bestaat — en `SURFACE_CONFIG[key]` van een
// onbekende sleutel is `undefined`, wat een chip zonder naam en een lege knop
// oplevert. Main doet hetzelfde met `pinnedSurfaces()` uit
// `electron/google-apps-open.ts`; dat bestand is hier niet te importeren, want
// Next.js compileert niets van buiten zijn eigen map.
function known(keys: readonly string[]): Surface[] {
  const out: Surface[] = [];
  for (const key of keys) {
    const match = GOOGLE_APPS.find((s) => s === key);
    if (match && !out.includes(match)) out.push(match);
  }
  return out;
}

// De id van de kop boven de vinkjeslijst, zodat de lijst met `aria-labelledby` een
// naam heeft. Een `<label>` kan het niet zijn: dat wijst naar één control en dit is
// een groep van negen.
const EXCLUDED_LABEL_ID = 'setting-ga-excluded-label';

export function GoogleAppsSection({ S, prefs }: { S: UiStrings; prefs: Prefs | null }) {
  const ga = prefs?.googleApps;
  const excluded = known(ga?.excluded ?? []);
  const pinned = known(ga?.pinned ?? []);
  // De rest, in de volgorde van de app zelf en niet in die van de gebruiker: dit is
  // een voorraad om uit te kiezen, geen rij die iets betekent.
  const available = GOOGLE_APPS.filter((s) => !pinned.includes(s));

  // Elke schrijfactie stuurt de geschoonde lijst en niet de ruwe. Anders zou het
  // afvinken van één app een onbekende sleutel die er al stond meeschrijven, en
  // blijft die eeuwig staan omdat geen enkel vinkje in dit paneel hem kan raken.
  const toggleExcluded = (s: Surface, on: boolean) => {
    const next = on ? [...excluded, s] : excluded.filter((k) => k !== s);
    window.desktop?.setGoogleApps({ excluded: next });
  };
  // Vastzetten hangt achteraan: de volgorde is de volgorde in de balk, en een nieuw
  // icoon hoort naast de bestaande te komen en niet tussen twee die je net zo had
  // gezet.
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
            // `!== false` en niet `=== true`: zolang de voorkeuren nog niet binnen
            // zijn is `ga` undefined, en dan hoort de schakelaar de standaard te
            // tonen (aan) in plaats van één tel om te springen.
            checked={ga?.openInApp !== false}
            onChange={(v) => window.desktop?.setGoogleApps({ openInApp: v })}
          />
        </SettingRow>

        {/* Uitgeschakeld en niet verborgen als de app niets mag openen: verdwijnt de
            rij, dan verspringt de sectie onder je handen zodra je de schakelaar
            erboven omzet. En de stand blijft leesbaar — een nieuw venster is een
            venster van déze app, dus met "open in de app" uit valt er niets te
            kiezen (zie de rangorde in `electron/google-apps-open.ts`). */}
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

        {/* Een lijst met vinkjes en geen keuzelijst met meervoudige selectie. Zo'n
            `<select multiple>` is met de muis een valkuil — één klik wist alles wat
            je al had gekozen — en met het toetsenbord nauwelijks te doen. Zelfde
            afweging als bij de talen. Geen `SettingRow`: die zet één control naast
            een naam, en dit is een blok onder een naam. */}
        <div className="py-3">
          <p id={EXCLUDED_LABEL_ID} className="text-[13.5px] font-medium leading-5">
            {S.gaExcluded}
          </p>
          <p className={`mt-1 max-w-[46ch] ${HINT}`}>{S.gaExcludedDescription}</p>
          {/* De stand in woorden boven de lijst. In het ontwerp staat hier een
              keuzelijst die "None" leest, en dat is het enige wat die lijst zei; met
              negen vinkjes eronder is "wat staat er nu aan" anders alleen te vinden
              door ze allemaal na te kijken. De namen zelf en geen aantal: negen
              items passen op één regel en een getal zou minder zeggen dan de lijst. */}
          <p className={`mb-2 mt-2 ${HINT}`}>
            {excluded.length === 0 ? S.gaExcludedNone : excluded.map(appLabel).join(', ')}
          </p>
          <div role="group" aria-labelledby={EXCLUDED_LABEL_ID} className={`${PANEL} p-1`}>
            {GOOGLE_APPS.map((s) => (
              <label
                key={s}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition hover:bg-black/[0.04] dark:hover:bg-white/5 motion-reduce:transition-none"
              >
                <input
                  type="checkbox"
                  checked={excluded.includes(s)}
                  onChange={(e) => toggleExcluded(s, e.target.checked)}
                  className={CHECKBOX}
                />
                <span className="min-w-0 flex-1 truncate">{appLabel(s)}</span>
              </label>
            ))}
          </div>
        </div>
      </SettingsGroup>

      {/* Geen kop boven deze groep: de haarlijn van `SettingsGroup` zegt al dat het
          hierboven over iets anders ging, en een kop van twee woorden boven twee
          rijen die zichzelf uitleggen voegt niets toe. */}
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

          {/* Twee rijen chips en geen lijst met vinkjes: de bovenste rij ís de balk
              in het klein — dezelfde volgorde, van links naar rechts — en dat is wat
              deze instelling doet. Beide rijen staan er altijd, ook leeg: verschijnt
              en verdwijnt een kop, dan verspringt alles eronder bij elke klik.
              `role="group"` met de kop als naam, want los is "Drive ×" niet te
              plaatsen. */}
          <ChipRow heading={S.gaPinnedHeading}>
            {pinned.length === 0 ? (
              // Hergebruik van "Geen": er is geen eigen tekst voor een lege balk, en
              // dit zegt precies hetzelfde als in de lijst hierboven.
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

// Eén rij chips met een kop erboven. `role="group"` en `aria-label`: een chip alleen
// ("Drive ×") vertelt niet of hij vast staat of nog te kiezen is.
function ChipRow({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={heading} className="mt-3">
      <p className={`mb-1.5 ${HINT}`}>{heading}</p>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

// Eén app als chip. De hele chip is de knop en niet alleen het tekentje ernaast: een
// × van 12px is een doel van een paar pixels, en er is hier niets anders te doen met
// een chip dan hem omzetten. Daarom is de naam ook geen aparte tekst — hij staat in
// de knop.
//
// Niets dat naar slepen wijst: herordenen met de muis zit er (nog) niet in, en een
// greepje of `cursor-move` dat niets doet is erger dan een rij die eerlijk zegt dat
// je alleen kan toevoegen en weghalen. De volgorde van de balk is de volgorde waarin
// je vastzet.
function Chip({
  label,
  action,
  glyph,
  onClick,
}: {
  label: string;
  // De naam voor een schermlezer en de tooltip: "Zet Drive vast" / "Haal Drive weg".
  // Het tekentje zelf is versiering en zegt niets zonder die tekst.
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
      {/* `aria-hidden`: de knop heeft zijn naam al uit `aria-label`, en een
          schermlezer die "plus" of "maal" voorleest maakt daar onzin van. */}
      <span aria-hidden className="text-neutral-500">
        {glyph}
      </span>
    </button>
  );
}
