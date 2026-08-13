// The fixed account colours, handed out by index.
export const PALETTE = ['#4285F4', '#EA4335', '#34A853', '#FBBC05', '#A142F4', '#00ACC1'] as const;

/**
 * Returns the palette colour for an account position
 *
 * @param index wraps around, so any position gets a colour
 * @returns a hex colour
 */
export function colorForIndex(index: number): string {
  return PALETTE[index % PALETTE.length];
}
