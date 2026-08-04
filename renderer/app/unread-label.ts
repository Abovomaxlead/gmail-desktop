// The unread number in a tab, capped at 9999: a badge does not truncate, so a longer
// counter would grow past the name's own max width, and above the cap it reads
// `9.999+`. The thousands separator follows the app language (`numberLocale`).
export const UNREAD_CAP = 9999;

export function unreadLabel(count: number, locale: string): string {
  const capped = Math.min(Math.floor(count), UNREAD_CAP);
  const text = capped.toLocaleString(locale);
  return count > capped ? `${text}+` : text;
}
