// Helpers for the settings page. Chromium's <input type="time"> fires onChange with ''
// while a segment is being typed, so only a complete HH:MM value may be persisted or
// the stored quiet-hours time is cleared under the user's cursor. RENE_SEQUENCE is
// Rene mode's secret handshake.

export const RENE_SEQUENCE = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'a', 'b'];

/**
 * Whether a time value is finished enough to store
 *
 * @param v
 * @returns true only for a complete HH:MM
 */
export function isCompleteTime(v: string): boolean {
  return /^\d{2}:\d{2}$/.test(v);
}

/**
 * Moves the secret handshake along
 *
 * @param progress how much of the sequence has been typed
 * @param key
 * @returns the new progress; a mismatching first key starts a fresh attempt
 */
export function advanceReneSequence(progress: number, key: string): number {
  const got = key.length === 1 ? key.toLowerCase() : key;
  if (got === RENE_SEQUENCE[progress]) return progress + 1;
  return got === RENE_SEQUENCE[0] ? 1 : 0;
}
