// Persists the account emails the user explicitly removed. Accounts are auto-detected
// from the shared Google session, so without this a removed account would reappear at
// the next detection. Detection skips any email listed here; signing in again through
// the "+" flow clears it.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class RemovedStore {
  constructor(private readonly filePath: string) {}

  /**
   * Reads the removed list, treating an unreadable file as empty
   *
   * @returns the removed addresses
   * @private
   */
  private read(): string[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  /**
   * Writes the removed list
   *
   * @param list
   * @private
   */
  private write(list: string[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf8');
  }

  /**
   * Returns every address the user removed
   *
   * @returns the removed addresses
   */
  list(): string[] {
    return this.read();
  }

  /**
   * Tells whether detection should skip an address
   *
   * @param email
   * @returns true when the user removed it
   */
  has(email: string): boolean {
    return this.read().includes(email);
  }

  /**
   * Remembers that the user removed an address
   *
   * @param email
   */
  add(email: string): void {
    const list = this.read();
    if (!list.includes(email)) {
      list.push(email);
      this.write(list);
    }
  }

  /**
   * Forgets a removal, so detection may pick the address up again
   *
   * @param email
   */
  remove(email: string): void {
    this.write(this.read().filter((e) => e !== email));
  }
}
