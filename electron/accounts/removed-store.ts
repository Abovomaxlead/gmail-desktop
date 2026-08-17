// The account emails the user explicitly removed, so detection does not pick them up
// again from the shared Google session. Signing in through the "+" flow clears one.

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

  private write(list: string[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf8');
  }

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
