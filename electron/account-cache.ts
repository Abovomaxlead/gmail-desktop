import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// De laatst bekende eigen accounts, zodat de tabbalk bij het opstarten niet leeg
// begint. Gedelegeerde postbussen staan in delegated.json; hier gaat het om de
// accounts waarop de gebruiker zelf is ingelogd, en die worden nergens anders
// bewaard: prefs.json kent alleen voorkeuren per adres en colors.json alleen
// kleuren, dus zonder dit bestand bestaat een eigen account pas nadat een
// verborgen probe het adres uit de Gmail-pagina heeft gelezen.
//
// Bewust géén sessie-index (het cijfer in /mail/u/2/). Die index hoort bij
// Google's browsersessie en niet bij het account: logt de gebruiker elders in of
// uit, dan wijst slot 2 naar een ander postvak. Een bewaarde index is dus een gok
// waaruit een URL te bouwen valt — precies de fout die we niet willen kúnnen
// maken. Wat hier staat is alleen wat een tab tékent; er komt nooit een URL, een
// teller of een melding uit voort.
export interface CachedAccount {
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
}

/**
 * Leest de bewaarde lijst uit ruwe JSON. Neemt alléén de velden over die een tab
 * tekent: staat er meer in het bestand (bijvoorbeeld een sessie-index uit een
 * oudere of met de hand aangepaste versie), dan wordt dat hier weggelaten in
 * plaats van doorgegeven. Zo kan er nooit iets anders dan tekenwerk uit komen.
 * Een onbruikbaar item wordt overgeslagen, niet fataal: een halve balk is beter
 * dan geen balk.
 */
export function parseCachedAccounts(raw: unknown): CachedAccount[] {
  if (!Array.isArray(raw)) return [];
  const out: CachedAccount[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    const email = typeof r.email === 'string' ? r.email.trim().toLowerCase() : '';
    if (!email) continue; // zonder adres is het geen account: het adres ís de identiteit
    out.push({
      email,
      name: typeof r.name === 'string' ? r.name : '',
      avatarUrl: typeof r.avatarUrl === 'string' ? r.avatarUrl : '',
      color: typeof r.color === 'string' ? r.color : '',
    });
  }
  return out;
}

/**
 * Welke bewaarde accounts nog als voorlopige tab getekend mogen worden: alles wat
 * detectie nog niet heeft bevestigd en de gebruiker niet zelf heeft verwijderd.
 * Bevestigd valt eruit omdat daar dan een echt tabblad voor staat; verwijderd
 * valt eruit omdat een verwijderd account anders bij elke start terugkomt. De
 * bewaarde volgorde blijft staan — dat is de volgorde waarin de tabs stonden toen
 * de app dichtging, dus verschuift er niets als de detectie ze één voor één
 * bevestigt.
 */
export function seedable(
  cached: CachedAccount[],
  opts: { confirmed: string[]; removed: string[] },
): CachedAccount[] {
  const skip = new Set([...opts.confirmed, ...opts.removed].map((e) => e.trim().toLowerCase()));
  const seen = new Set<string>();
  const out: CachedAccount[] = [];
  for (const c of cached) {
    const key = c.email.trim().toLowerCase();
    if (!key || skip.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * Mag de onthouden balk mee naar de zijbalk? Alleen als er een bevestigd tabblad
 * vooraan staat. De zijbalk kiest bij een lege selectie het eerste tabblad als
 * het actieve, en dat mag nooit een voorlopige tab zijn: dan staat er een naam
 * die we alleen maar vermoeden boven het postvak dat main werkelijk toont. Zolang
 * er niets bevestigd is vooraan, blijft de onthouden balk dus achter.
 */
export function seedsAllowed(rows: Array<{ provisional?: boolean }>): boolean {
  return rows.length > 0 && rows[0].provisional !== true;
}

export class AccountCacheStore {
  constructor(private readonly filePath: string) {}

  list(): CachedAccount[] {
    if (!existsSync(this.filePath)) return [];
    try {
      return parseCachedAccounts(JSON.parse(readFileSync(this.filePath, 'utf8')));
    } catch {
      // Halfgeschreven of met de hand verpest: dan begint de balk leeg en vult
      // detectie hem zoals vroeger. Hier blijven hangen kost de hele app.
      return [];
    }
  }

  // Overschrijft de hele lijst: dit is een momentopname van de balk, geen
  // verzameling die groeit. Nog één keer langs de parser, zodat er ook via deze
  // weg niets anders dan tekenwerk in het bestand belandt.
  save(items: CachedAccount[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(parseCachedAccounts(items), null, 2), 'utf8');
  }

  remove(email: string): void {
    if (!existsSync(this.filePath)) return; // niets bewaard: geen leeg bestand achterlaten
    const e = email.trim().toLowerCase();
    this.save(this.list().filter((c) => c.email !== e));
  }
}
