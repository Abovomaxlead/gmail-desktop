import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { StoredToken } from './google-oauth';

// Tokens per account, buiten de repo in userData. Bewust een apart bestand van
// prefs.json: dit zijn geheimen en geen instellingen, en zo is het in één keer
// weg te gooien zonder de rest van je voorkeuren te verliezen.
export class OAuthStore {
  constructor(private readonly filePath: string) {}

  private all(): Record<string, StoredToken> {
    if (!existsSync(this.filePath)) return {};
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
      return raw as Record<string, StoredToken>;
    } catch {
      return {};
    }
  }

  private write(map: Record<string, StoredToken>): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(map, null, 2), 'utf8');
  }

  get(email: string): StoredToken | undefined {
    const t = this.all()[email.toLowerCase()];
    if (!t || typeof t.accessToken !== 'string' || typeof t.refreshToken !== 'string') return undefined;
    return t;
  }

  set(email: string, token: StoredToken): void {
    const map = this.all();
    map[email.toLowerCase()] = token;
    this.write(map);
  }

  remove(email: string): void {
    const map = this.all();
    delete map[email.toLowerCase()];
    this.write(map);
  }

  connected(): string[] {
    return Object.keys(this.all());
  }
}
