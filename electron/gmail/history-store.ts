// Per account, the last historyId seen from Gmail — the cursor for history.list.
//
// Apart from google-tokens.json because this is progress, not a secret: deleting it costs
// one re-calibration, where getting stuck costs every notification.

import { readJsonFile, writeJsonFile } from '../core/json-store';

export class HistoryStore {
  constructor(private readonly filePath: string) {}

  /**
   * Reads the cursors, treating an unreadable file as none
   *
   * @returns historyId per lowercased email
   * @private
   */
  private all(): Record<string, string> {
    const raw = readJsonFile(this.filePath);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as Record<string, string>;
  }

  private write(map: Record<string, string>): void {
    writeJsonFile(this.filePath, map);
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
