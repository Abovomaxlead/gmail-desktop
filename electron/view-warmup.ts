import { mailboxTitleLoaded } from './unread-parser';

// Hoe lang een warmloop maximaal buiten het venster mag blijven staan. Terugval
// voor een account dat nooit inlaadt (uitgelogd, geen netwerk, een inlogpagina):
// zonder bovengrens zou zo'n view daar blijven hangen.
export const WARMUP_CAP_MS = 25_000;
// Nazak-marge na het klaar-signaal. De paginatitel kan omslaan terwijl Gmail zijn
// berichtenlijst nog tekent, dus koelen we niet op hetzelfde moment.
export const WARMUP_SETTLE_MS = 1_500;

export type WarmupVerdict = 'wait' | 'cool' | 'unknown';

interface WarmupEntry {
  startedAt: number;
  // Het eerste moment waarop de titel de postvakvorm had. Blijft staan als de
  // titel daarna weer verandert (Gmail zet hem tijdens een navigatie kort terug),
  // zodat de nazak-marge niet opnieuw begint.
  readyAt: number | null;
}

// Houdt per account bij hoe zijn eenmalige warmloop ervoor staat. Alle tijd komt
// als parameter binnen en er is geen Electron in zicht, dus los te testen — in de
// lijn van detection-planner.ts en account-order.ts.
export class WarmupTracker {
  private entries = new Map<string, WarmupEntry>();
  // Sleutels die hun warmloop achter zich hebben. Voorladen gebeurt één keer per
  // sessie, dus een afgeronde sleutel mag niet opnieuw beginnen.
  private done = new Set<string>();

  // Geeft terug of er een warmloop is gestart. False betekent: deze sleutel is al
  // bezig of al klaar, en de aanroeper hoeft niets te doen.
  begin(key: string, now: number): boolean {
    if (this.entries.has(key) || this.done.has(key)) return false;
    this.entries.set(key, { startedAt: now, readyAt: null });
    return true;
  }

  // Mag deze warmloop koelen? Neemt de huidige paginatitel als klaar-signaal mee.
  verdict(key: string, title: string | null | undefined, now: number): WarmupVerdict {
    const entry = this.entries.get(key);
    if (!entry) return 'unknown';
    if (entry.readyAt === null && mailboxTitleLoaded(title)) entry.readyAt = now;
    if (entry.readyAt !== null && now - entry.readyAt >= WARMUP_SETTLE_MS) return 'cool';
    if (now - entry.startedAt >= WARMUP_CAP_MS) return 'cool';
    return 'wait';
  }

  finish(key: string): void {
    this.entries.delete(key);
    this.done.add(key);
  }

  pending(): string[] {
    return [...this.entries.keys()];
  }
}
