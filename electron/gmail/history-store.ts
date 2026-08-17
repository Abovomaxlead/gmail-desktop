// Per account, the last historyId seen from Gmail — the cursor for history.list.
//
// Apart from google-tokens.json because this is progress, not a secret: deleting it costs
// one re-calibration, where getting stuck costs every notification.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class HistoryStore {
  constructor(private readonly filePath: string) {}

  /**
   * Reads the cursors, treating an unreadable file as none
   *
   * @returns historyId per lowercased email
   * @private
   */
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

  /**
   * The last historyId seen for an account
   *
   * @param email
   * @returns the cursor, or undefined when the account has to re-calibrate
   */
  get(email: string): string | undefined {
    const value = this.all()[email.toLowerCase()];
    return typeof value === 'string' && value ? value : undefined;
  }

  /**
   * Advances an account's cursor
   *
   * @param email
   * @param historyId
   */
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
