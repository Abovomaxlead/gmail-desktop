import type { NotificationPrefs, Prefs, QuietHours } from './prefs-store';
import { surfacesForRef, type Surface } from '../renderer/lib/surfaces';
import type { AccountRef } from '../renderer/lib/account-ref';

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function inQuietHours(start: string, end: string, minutes: number): boolean {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return false;
  if (s < e) return minutes >= s && minutes < e; // same-day window
  return minutes >= s || minutes < e; // crosses midnight
}

export function notificationsAllowed(
  prefs: Prefs,
  email: string,
  now: Date,
  surface: Surface = 'mail',
  // Krijgt dit account zijn meldingen al van de Gmail API? Dan moet Gmail's
  // eigen melding in de webview zwijgen, anders komt alles dubbel. Alleen voor
  // mail: de agenda meldt via zijn eigen view en staat hier buiten.
  pushCovered = false,
): boolean {
  const { dnd, dndUntil, quietHours } = prefs.notifications;
  if (dnd) return false;
  if (dndUntil && now.getTime() < dndUntil) return false;
  if (
    quietHours.enabled &&
    inQuietHours(quietHours.start, quietHours.end, now.getHours() * 60 + now.getMinutes())
  ) {
    return false;
  }
  const account = prefs.accounts[email];
  // De hoofdschakelaar voor de andere Google-apps staat vóór de keuze per account:
  // uit betekent geen agendaherinneringen, ook niet van een account waarvoor ze aan
  // staan. Standaard aan, dus zonder dat de gebruiker iets doet beslist de keuze
  // per account, precies zoals daarvoor.
  if (surface === 'calendar') {
    return prefs.notifications.googleApps !== false && account?.calendarNotify === true;
  }
  if (surface !== 'mail') return false; // v1: the other Google apps never notify
  if (pushCovered) return false;
  return account?.notify !== false;
}

// Het instellingenpaneel kent alleen `dnd` en `quietHours` — `dndUntil` is geen
// schakelaar daar, alleen het tray-menu zet die. Schrijf de patch van het paneel
// zomaar over de opgeslagen voorkeuren heen, dan verdwijnt een lopende snooze
// zodra je iets anders aan meldingen verandert, ook al heb je "aan/uit" niet
// aangeraakt.
//
// Verandert de gebruiker alleen de stille uren, dan blijft een lopende snooze
// staan: dat zijn twee onafhankelijke stukken beleid en de gebruiker heeft niet
// om het einde van de snooze gevraagd. Wisselt de gebruiker de DND-schakelaar
// zelf om — aan of uit — dan is dat een expliciete uitspraak over de hele
// gedempte staat, en die wint net als bij de tray's eigen acties in `setSnooze`
// (main.ts): "zet uit" en "zet aan (onbeperkt)" wissen daar ook allebei een
// lopende `dndUntil`. Alleen het aanzetten van een timed snooze zet hem juist.
// `...current` staat vóór `...panel` en niet andersom: het paneel weet alleen van
// gedempt zijn en de stille uren, en sinds er ook velden over de inhoud van een
// melding en over geluid in dit blok staan zou een patch van het paneel die
// stilletjes wissen. Zo blijft alles staan waar het paneel niets over zegt.
export function mergeNotificationsFromPanel(
  current: NotificationPrefs,
  panel: { dnd: boolean; quietHours: QuietHours },
): NotificationPrefs {
  return {
    ...current,
    ...panel,
    dndUntil: panel.dnd === current.dnd ? current.dndUntil : undefined,
  };
}

export function notificationSilent(
  prefs: Prefs,
  email: string,
  surface: Surface = 'mail',
): boolean {
  // De hoofdschakelaar geldt hier wél voor elk soort melding, anders dan de keuze
  // per account eronder: "speel geen geluid bij een melding" is een uitspraak over
  // alle meldingen, en een agendaherinnering die alsnog piept terwijl je het geluid
  // uitzette leest als een fout.
  if (prefs.notifications.sound === false) return true;
  if (surface !== 'mail') return false; // v1: only mail honours the per-account toggle
  return prefs.accounts[email]?.notifySound === false;
}

// Opt-in per account, and — unlike the sound toggle — it covers every surface
// that may notify: a calendar reminder is exactly the kind you don't want to
// miss. Surfaces that never notify are already gated by notificationsAllowed.
export function notificationPersist(prefs: Prefs, email: string): boolean {
  return prefs.accounts[email]?.notifyPersist === true;
}

// Should a hidden calendar view be kept alive for this account? It exists only
// to fire reminders, so it follows the calendarNotify opt-in — but the pref
// alone is not enough: a delegated mailbox whose calendar URL was never
// captured has no calendar to load, and asking for one throws.
export function wantsCalendarView(prefs: Prefs, email: string, ref: AccountRef): boolean {
  if (prefs.accounts[email]?.calendarNotify !== true) return false;
  return surfacesForRef(ref).includes('calendar');
}
