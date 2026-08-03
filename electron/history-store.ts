import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Per account het laatste historyId dat we van Gmail zagen. Dat is de cursor voor
// history.list: alles ná dit punt is wat we nog niet verwerkt hebben.
//
// Apart van de tokens (google-tokens.json), want dit is geen geheim maar
// voortgang: je kunt dit bestand weggooien zonder je koppeling kwijt te raken.
// De app ijkt dan bij de eerstvolgende sync opnieuw en meldt niets.
export class HistoryStore {
  constructor(private readonly filePath: string) {}

  private all(): Record<string, string> {
    if (!existsSync(this.filePath)) return {};
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
      return raw as Record<string, string>;
    } catch {
      // Halfgeschreven of met de hand verpest: opnieuw ijken kost één verzoek,
      // hier blijven hangen kost alle meldingen.
      return {};
    }
  }

  private write(map: Record<string, string>): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(map, null, 2), 'utf8');
  }

  get(email: string): string | undefined {
    const value = this.all()[email.toLowerCase()];
    return typeof value === 'string' && value ? value : undefined;
  }

  set(email: string, historyId: string): void {
    const map = this.all();
    map[email.toLowerCase()] = historyId;
    this.write(map);
  }

  remove(email: string): void {
    const map = this.all();
    delete map[email.toLowerCase()];
    this.write(map);
  }
}
