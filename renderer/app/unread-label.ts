// The unread number in a tab, capped at 9999: a badge does not truncate, so a longer
// counter would grow past the name's own max width, and above the cap it reads
// `9.999+`. The thousands separator follows the app language (`numberLocale`).
export const UNREAD_CAP = 9999;

/**
 * The unread number as a tab shows it
 *
 * @param count
 * @param locale which separator groups the thousands
 * @returns the number, or `9.999+` above the cap
 */
export function unreadLabel(count: number, locale: string): string {
  const capped = Math.min(Math.floor(count), UNREAD_CAP);
  const text = capped.toLocaleString(locale);
  return count > capped ? `${text}+` : text;
}
