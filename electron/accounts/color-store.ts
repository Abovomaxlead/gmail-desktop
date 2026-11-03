// Per-account tab colour, kept in colors.json. Read on every call rather than cached,
// so an unreadable or hand-edited file degrades to "no colour set" instead of
// failing.

import { readJsonFile, writeJsonFile } from '../core/json-store';

export class ColorStore {
  constructor(private readonly filePath: string) {}

  /**
   * Reads colors.json, treating anything unusable as no colours at all
   *
   * Keys are normalised the same way get and set key them, so a file saved before this
   * normalisation existed — mixed-case keys — still matches. Where two keys collide after
   * normalising, the first one in the file wins.
   *
   * @returns colour per normalised email
   * @private
   */
  private read(): Record<string, string> {
    const parsed = readJsonFile(this.filePath);
    const raw = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
    const normalised: Record<string, string> = {};
    for (const [email, color] of Object.entries(raw)) {
      const key = email.trim().toLowerCase();
      if (!(key in normalised)) normalised[key] = color;
    }
    return normalised;
  }

  get(email: string): string | undefined {
    return this.read()[email.trim().toLowerCase()];
  }

  set(email: string, color: string): void {
    writeJsonFile(this.filePath, { ...this.read(), [email.trim().toLowerCase()]: color });
  }
}
