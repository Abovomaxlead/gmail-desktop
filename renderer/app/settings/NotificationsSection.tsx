'use client';

import type { Prefs } from '../page';
import { isCompleteTime } from '../settings-utils';
import type { UiStrings } from '../strings';
import { SettingRow } from './SettingRow';
import { CARD, CHECKBOX, FIELD, SECTION_TITLE } from './tokens';

// De tijdvelden dragen `tabular-nums`: een tijd is een getal, en een getal dat
// van 09:59 naar 10:00 springt hoort niet ook nog van breedte te veranderen.
// `disabled:` erbij, want ze blijven staan als de stille uren uit staan.
const TIME = `${FIELD} tabular-nums disabled:cursor-not-allowed disabled:opacity-50`;

// Meldingen: niet storen, en stille uren met twee tijden.
export function NotificationsSection({
  S,
  prefs,
  onSetNotifications,
}: {
  S: UiStrings;
  prefs: Prefs | null;
  onSetNotifications: (arg: {
    dnd: boolean;
    quietHours: { enabled: boolean; start: string; end: string };
  }) => void;
}) {
  const quiet = prefs?.notifications.quietHours;
  const quietOn = quiet?.enabled === true;

  return (
    <section className="flex flex-col gap-4">
      <h2 className={SECTION_TITLE}>{S.sectionNotifications}</h2>

      <div className={CARD}>
        <SettingRow label={S.dnd} description={S.dndDescription} htmlFor="setting-dnd">
          <input
            id="setting-dnd"
            type="checkbox"
            checked={!!prefs?.notifications.dnd}
            onChange={(e) => {
              if (!prefs) return;
              onSetNotifications({ dnd: e.target.checked, quietHours: prefs.notifications.quietHours });
            }}
            className={CHECKBOX}
          />
        </SettingRow>

        <SettingRow
          label={S.quietHours}
          description={S.quietHoursDescription}
          htmlFor="setting-quiet-hours"
        >
          <input
            id="setting-quiet-hours"
            type="checkbox"
            checked={!!quiet?.enabled}
            onChange={(e) => {
              if (!prefs) return;
              onSetNotifications({
                dnd: prefs.notifications.dnd,
                quietHours: { ...prefs.notifications.quietHours, enabled: e.target.checked },
              });
            }}
            className={CHECKBOX}
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
              zodat er niets remount terwijl de gebruiker typt. */}
          <input
            key={quiet ? 'ready' : 'loading'}
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
          <span className="text-xs text-neutral-500">{S.to}</span>
          <input
            key={quiet ? 'ready' : 'loading'}
            id="setting-quiet-end"
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
      </div>
    </section>
  );
}
