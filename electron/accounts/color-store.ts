// Per-account tab colour, kept in colors.json. Read on every call rather than cached,
// so an unreadable or hand-edited file degrades to "no colour set" instead of
// failing.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class ColorStore {
  constructor(private readonly filePath: string) {}

  /**
   * Reads colors.json, treating anything unusable as no colours at all
   *
   * @returns colour per email
   * @private
   */
  private read(): Record<string, string> {
    if (!existsSync(this.filePath)) return {};
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, string>)
        : {};
    } catch {
      return {};
    }
  }

  get(email: string): string | undefined {
    return this.read()[email];
  }

  set(email: string, color: string): void {
    const next = { ...this.read(), [email]: color };
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(next, null, 2), 'utf8');
  }
}
