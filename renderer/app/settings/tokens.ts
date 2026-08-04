// Shared style tokens for the settings panel, so its sections cannot drift apart.
// The panel is grey with one white surface, and colour only appears where it means
// something: an account's own colour (data-driven, in AccountsSection), ACCENT_BUTTON
// on the one button that performs an update, and DANGER_* for deletion and failure.
// Any other tint is decoration, and a switch that is on is dark rather than blue.
// Opacity must be bracketed: Tailwind 3's default scale steps by 5, so
// `border-black/8` emits nothing at all while `border-black/[0.08]` works.

export const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-900';

export const SURFACE_FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-100 dark:focus-visible:ring-offset-neutral-950';

export const HAIRLINE = 'border-black/[0.08] dark:border-white/[0.08]';

export const DIVIDER = 'divide-black/[0.08] dark:divide-white/[0.08]';

export const SURFACE = `rounded-2xl border ${HAIRLINE} bg-white dark:bg-neutral-900`;

export const PANEL = `rounded-xl border ${HAIRLINE} bg-white dark:bg-neutral-900`;

export const NOTICE = `rounded-xl bg-neutral-100 px-4 py-3 text-[13px] font-medium dark:bg-neutral-800`;

export const SECTION_TITLE = 'text-[22px] font-semibold tracking-tight';

export const BLOCK_TITLE = 'text-[15px] font-semibold tracking-tight';

export const VALUE = 'text-xs text-neutral-500';

export const HINT = 'text-xs font-normal leading-snug text-neutral-500';

export const BUTTON = `shrink-0 rounded-lg bg-neutral-200 px-3 py-1.5 text-[13px] font-medium text-neutral-900 transition hover:bg-neutral-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700 motion-reduce:transition-none ${FOCUS_RING}`;

export const ACCENT_BUTTON = `shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-blue-500 motion-reduce:transition-none ${FOCUS_RING}`;

export const DANGER_BUTTON = `shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-red-500 motion-reduce:transition-none ${FOCUS_RING}`;

export const DANGER_PANEL =
  'rounded-lg border border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200';

export const DANGER_TEXT = 'text-red-600 dark:text-red-400';

export const CHECKBOX = `h-4 w-4 shrink-0 accent-neutral-900 dark:accent-neutral-100 ${FOCUS_RING}`;

export const FIELD = `rounded-md border ${HAIRLINE} bg-neutral-100 px-2 py-1 text-[13px] text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100 ${FOCUS_RING}`;
