'use client';

import type { AccountPref, Prefs, Profile } from '../page';
import { isCompleteTime } from '../settings-utils';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import { Switch } from './Switch';
import { BLOCK_TITLE, CHECKBOX, DIVIDER, FIELD, HAIRLINE, PANEL } from './tokens';

// De tijdvelden dragen `tabular-nums`: een tijd is een getal, en een getal dat
// van 09:59 naar 10:00 springt hoort niet ook nog van breedte te veranderen.
// `disabled:` erbij, want ze blijven staan als de stille uren uit staan.
const TIME = `${FIELD} tabular-nums disabled:cursor-not-allowed disabled:opacity-50`;

// Het id waarmee het rooster naar zijn eigen kop wijst. Vast en niet gegenereerd:
// er staat er precies één in het paneel, want er is één sectie tegelijk open.
const MATRIX_TITLE_ID = 'per-account-notifications-title';

// Het id van de "tot" tussen de twee tijdvelden, die de naam van het tweede veld
// is. Zelfde reden om het vast te zetten: één per paneel.
const QUIET_END_LABEL_ID = 'setting-quiet-end-label';

// Eén kolom van het rooster: dezelfde instelling voor elk account.
interface ToggleColumn {
  key: string;
  // De kolomkop in beeld. Kort, want de kolom is 64px breed.
  header: string;
  // De volledige tekst. Dit is de toegankelijke naam van elk vakje in de kolom
  // (de bestaande `*Title`-teksten eindigen al op "voor dit account", dus samen
  // met de rijkop van de tabel klopt de zin) en de tooltip van de kop.
  name: string;
  // `null` betekent: deze instelling bestaat voor dit account niet. Dan komt er
  // geen vakje in de cel, want een vakje dat je niet kan omzetten liegt over
  // waar je zeggenschap over hebt.
  cell: (p: Profile, a: AccountPref | undefined) => { checked: boolean; set: (v: boolean) => void } | null;
}

// De vijf instellingen per account, in de volgorde waarin ze in de accountkaart
// stonden. De polariteit per instelling is letterlijk overgenomen: `!== false`
// waar de instelling aan staat tenzij je hem uitzet (post, getal, geluid), en
// `=== true` waar hij uit staat tenzij je hem aanzet (agenda, blijven staan). De
// standaarden verschillen per instelling en het verschil is dus geen slordigheid.
function toggleColumns(S: UiStrings): ToggleColumn[] {
  return [
    {
      key: 'notify',
      header: S.mailToggle,
      name: S.mailToggleTitle,
      cell: (p, a) => ({
        checked: a?.notify !== false,
        set: (v) => window.desktop?.setAccountPref({ email: p.email, notify: v }),
      }),
    },
    {
      key: 'calendar',
      header: S.calendarToggle,
      name: S.calendarToggleTitle,
      // Een gedeeld postvak zonder agenda heeft geen agenda om meldingen van te
      // geven; de kolom blijft staan (anders verspringt het rooster per rij),
      // maar de cel is leeg.
      cell: (p, a) =>
        p.hasCalendar
          ? {
              checked: a?.calendarNotify === true,
              set: (v) => window.desktop?.setAccountPref({ email: p.email, calendarNotify: v }),
            }
          : null,
    },
    {
      key: 'badge',
      header: S.badgeToggle,
      name: S.badgeToggleTitle,
      cell: (p, a) => ({
        checked: a?.badgeCount !== false,
        set: (v) => window.desktop?.setAccountPref({ email: p.email, badgeCount: v }),
      }),
    },
    {
      key: 'sound',
      header: S.soundToggle,
      name: S.soundToggleTitle,
      cell: (p, a) => ({
        checked: a?.notifySound !== false,
        set: (v) => window.desktop?.setAccountPref({ email: p.email, notifySound: v }),
      }),
    },
    {
      key: 'persist',
      header: S.persistToggle,
      name: S.persistToggleTitle,
      cell: (p, a) => ({
        checked: a?.notifyPersist === true,
        set: (v) => window.desktop?.setAccountPref({ email: p.email, notifyPersist: v }),
      }),
    },
  ];
}

// Waaraan je een account in de rij herkent: het label dat de gebruiker zelf gaf,
// anders de naam die Google eraan hangt, anders het adres. Nooit leeg, want een
// naamloze rij in een rooster is een rij zonder eigenaar.
function displayName(p: Profile): string {
  return p.label?.trim() || p.name?.trim() || p.email;
}

// Meldingen: eerst wat voor alles geldt (niet storen, stille uren), daarna wat
// per account geldt.
export function NotificationsSection({
  S,
  prefs,
  profiles,
  onSetNotifications,
}: {
  S: UiStrings;
  prefs: Prefs | null;
  profiles: Profile[];
  onSetNotifications: (arg: {
    dnd: boolean;
    quietHours: { enabled: boolean; start: string; end: string };
  }) => void;
}) {
  const quiet = prefs?.notifications.quietHours;
  const quietOn = quiet?.enabled === true;
  const columns = toggleColumns(S);

  return (
    <Section title={S.navNotifications}>
      <SettingsGroup>
        <SettingRow label={S.dnd} description={S.dndDescription} htmlFor="setting-dnd">
          <Switch
            id="setting-dnd"
            checked={!!prefs?.notifications.dnd}
            onChange={(v) => {
              if (!prefs) return;
              onSetNotifications({ dnd: v, quietHours: prefs.notifications.quietHours });
            }}
          />
        </SettingRow>

        <SettingRow
          label={S.quietHours}
          description={S.quietHoursDescription}
          htmlFor="setting-quiet-hours"
        >
          <Switch
            id="setting-quiet-hours"
            checked={!!quiet?.enabled}
            onChange={(v) => {
              if (!prefs) return;
              onSetNotifications({
                dnd: prefs.notifications.dnd,
                quietHours: { ...prefs.notifications.quietHours, enabled: v },
              });
            }}
          />
        </SettingRow>

        {/* Beide tijden op één rij, met "tot" ertussen: dat is één instelling en
            niet twee. Staan de stille uren uit, dan zijn de velden uitgeschakeld
            en niet verborgen — anders verspringt de sectie onder je handen zodra
            je de schakelaar hierboven omzet. */}
        <SettingRow label={S.from} htmlFor="setting-quiet-start">
          {/* `key` op "zijn de voorkeuren al binnen": de velden zijn
              onbeheerd (`defaultValue`), dus wat er bij het monteren staat is wat
              er staat. De sectie kan een tik eerder monteren dan dat de
              voorkeuren uit het hoofdproces binnen zijn, en dan zou er voor
              altijd een leeg veld staan. De sleutel klapt precies één keer om,
              bij die eerste voorkeuren; latere wijzigingen laten het veld staan
              zodat er niets remount terwijl de gebruiker typt.

              De naam van het veld staat in de sleutel: twee zusjes met dezelfde
              `key` is een dubbele sleutel, waar React in de ontwikkelstand over
              klaagt en waarbij het onvoorspelbaar is welk van de twee velden een
              hermontage krijgt. */}
          <input
            key={quiet ? 'start-ready' : 'start-loading'}
            id="setting-quiet-start"
            type="time"
            disabled={!quietOn}
            defaultValue={quiet?.start ?? ''}
            onChange={(e) => {
              // Chromium vuurt onChange met '' terwijl je een deel van de tijd
              // typt. Zonder deze poort wordt de opgeslagen tijd gewist onder de
              // cursor van de gebruiker; alleen een volledige HH:MM mag door.
              if (!prefs || !isCompleteTime(e.target.value)) return;
              onSetNotifications({
                dnd: prefs.notifications.dnd,
                quietHours: { ...prefs.notifications.quietHours, start: e.target.value },
              });
            }}
            className={TIME}
          />
          {/* Het rijlabel ("van") hoort via `htmlFor` bij het eerste veld, dus
              zonder dit heeft het tweede veld geen naam en kondigt een
              schermlezer een naamloos tijdveld aan. "tot" wordt die naam met
              `aria-labelledby` en niet met een `<label>`: de rij zelf is al een
              `<label>` (zie `SettingRow`), en een label in een label is ongeldige
              HTML. Zo blijft de tekst in beeld de enige bron van die naam. */}
          <span id={QUIET_END_LABEL_ID} className="text-xs text-neutral-500">
            {S.to}
          </span>
          <input
            key={quiet ? 'end-ready' : 'end-loading'}
            id="setting-quiet-end"
            aria-labelledby={QUIET_END_LABEL_ID}
            type="time"
            disabled={!quietOn}
            defaultValue={quiet?.end ?? ''}
            onChange={(e) => {
              if (!prefs || !isCompleteTime(e.target.value)) return;
              onSetNotifications({
                dnd: prefs.notifications.dnd,
                quietHours: { ...prefs.notifications.quietHours, end: e.target.value },
              });
            }}
            className={TIME}
          />
        </SettingRow>

        {/* Wat een klik op een melding doet. Het stond bij Algemeen, en dat was
            de verkeerde plek: je komt hier kijken als een melding iets deed wat je
            niet verwachtte, niet daar. */}
        <SettingRow
          label={S.notificationOpenLabel}
          description={S.notificationOpenDescription}
          htmlFor="setting-notification-open"
        >
          <select
            id="setting-notification-open"
            value={prefs?.notificationOpen ?? 'app'}
            onChange={(e) => window.desktop?.setNotificationOpen(e.target.value as 'app' | 'window')}
            className={FIELD}
          >
            <option value="app">{S.openInApp}</option>
            <option value="window">{S.openInWindow}</option>
          </select>
        </SettingRow>
      </SettingsGroup>

      {/* Het rooster: één rij per account, één kolom per instelling. Vijf keer
          dezelfde vijf schakelaars onder elkaar met een naam per stuk is een muur;
          zo staat elke instelling onder elkaar en zie je in één blik welk account
          de luidruchtige is. Een echte tabel en geen rooster van divs: de kop van
          de kolom en de naam van de rij zijn dan voor een schermlezer de context
          van het vakje, zonder dat er per cel een zin in elkaar gezet wordt. */}
      {/* De kop van deze groep is ook de naam van de tabel (`aria-labelledby` op
          de tabel wijst hierheen), dus hij staat hier met een id op en niet via de
          `title`-prop van de groep: die maakt een kop zonder id. */}
      <SettingsGroup>
        <h3 id={MATRIX_TITLE_ID} className={`${BLOCK_TITLE} mb-3`}>
          {S.perAccountNotifications}
        </h3>

        {profiles.length === 0 ? (
          <p className={`${PANEL} px-4 py-3.5 text-[13.5px] text-neutral-500`}>{S.noAccounts}</p>
        ) : (
          // `overflow-x-auto` op de kaart: een tabel kan niet herschikken, en in
          // de Rene-stand staat alles op 200%. Dan schuift het rooster liever
          // zijwaarts dan dat de kolommen tot onleesbaar worden geknepen —
          // `min-w-[420px]` is de bodem waaronder hij niet meer krimpt.
          <div className={`${PANEL} overflow-x-auto`}>
            <table
              aria-labelledby={MATRIX_TITLE_ID}
              className="w-full min-w-[420px] table-fixed text-[13px]"
            >
              <thead>
                <tr className={`border-b ${HAIRLINE}`}>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-neutral-500">
                    {S.accountLabelField}
                  </th>
                  {/* 64px per kolom: dat is wat er over is naast een naamkolom
                      die mag meegroeien, en het past op de langste kop van beide
                      talen. De kop mag afbreken (`whitespace-normal`) in plaats
                      van afgekapt te worden: "Blijft staan" op twee regels is te
                      lezen, "Blijft st…" niet. Daarom ook `align-bottom` — een
                      kop van twee regels blijft dan op dezelfde lijn staan als
                      een kop van één. De volledige tekst zit in `title` en in de
                      naam van elk vakje in de kolom, dus er gaat niets verloren. */}
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      title={c.name}
                      className="w-16 px-1 py-2 align-bottom text-center text-xs font-medium leading-tight text-neutral-500"
                    >
                      <span className="block whitespace-normal break-words">{c.header}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className={`divide-y ${DIVIDER}`}>
                {profiles.map((p) => {
                  const account = prefs?.accounts?.[p.email];
                  return (
                    <tr key={p.email}>
                      {/* De rijkop draagt de kleur van het account, als stip van
                          8px. Dat is dezelfde taal als de rug van 3px op de
                          accountkaart en het streepje onder het tabblad: kleur
                          zegt in dit paneel één ding, en dat is van wie iets is.
                          Het adres staat in `title` en niet in beeld — wie dit
                          account is hoort bij Accounts, hier hoort alleen wie het
                          is. */}
                      <th scope="row" title={p.email} className="px-4 py-2 text-left font-normal">
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            aria-hidden
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: p.color }}
                          />
                          <span className="min-w-0 truncate font-medium leading-tight">
                            {displayName(p)}
                          </span>
                        </span>
                      </th>
                      {columns.map((c) => {
                        const cell = c.cell(p, account);
                        return (
                          <td key={c.key} className="px-1 py-2 text-center">
                            {cell ? (
                              <input
                                type="checkbox"
                                checked={cell.checked}
                                onChange={(e) => cell.set(e.target.checked)}
                                aria-label={c.name}
                                title={c.name}
                                className={CHECKBOX}
                              />
                            ) : (
                              // Een streepje in plaats van een dood vakje. Het
                              // streepje is een teken en geen tekst, dus de
                              // betekenis staat er in woorden naast voor wie het
                              // niet ziet.
                              <>
                                <span aria-hidden className="text-neutral-400 dark:text-neutral-600">
                                  —
                                </span>
                                <span className="sr-only">{S.toggleNotApplicable}</span>
                              </>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SettingsGroup>
    </Section>
  );
}
