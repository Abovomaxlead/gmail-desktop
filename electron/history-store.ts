// Per account, the last historyId seen from Gmail — the cursor for history.list.
// Deliberately apart from google-tokens.json because this is progress, not a secret:
// the file can be deleted without losing the link and the app re-calibrates on the
// next sync. An unreadable file is treated as empty for the same reason —
// re-calibrating costs one request, getting stuck costs every notification.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class HistoryStore {
  constructor(private readonly filePath: string) {}

  private all(): Record<string, string> {
    if (!existsSync(this.filePath)) return {};
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
      return raw as Record<string, string>;
    } catch {
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
