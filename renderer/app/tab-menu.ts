// What goes in a tab's right-click menu. Pure, so it can be tested without drawing the bar;
// main turns the plan into a real OS menu. It works on `kind` and `hasCalendar`, because
// the renderer never sees the AccountRef.
//
// A provisional tab has no url for anything, not even its own mail, so it gets no choices.
// Mail leads the list so the way back matches the way out, and an account with nothing but
// mail yields an empty list, which keeps the menu shut.

import { APP_SURFACES, SURFACE_CONFIG, type Surface } from '../lib/surfaces';
import type { NativeMenuItem } from '../lib/native-menu';

export interface TabMenuAccount {
  kind: 'authuser' | 'delegated';
  hasCalendar: boolean;
  provisional?: boolean;
}

/**
 * The surfaces besides mail this account can open
 *
 * @param p
 * @returns {Surface[]} empty for a provisional tab, which has no url for anything
 */
export function tabMenuSurfaces(p: TabMenuAccount): Surface[] {
  const out: Surface[] = [];
  if (p.provisional) return out;
  if (p.hasCalendar) out.push('calendar');
  if (p.kind === 'authuser') out.push(...APP_SURFACES);
  return out;
}

/**
 * Everything the menu offers
 *
 * @param p
 * @returns {Surface[]} mail leads the list so the way back matches the way out; empty for
 *   an account with nothing but mail, which keeps the menu shut
 */
export function tabMenuChoices(p: TabMenuAccount): Surface[] {
  const others = tabMenuSurfaces(p);
  return others.length === 0 ? [] : ['mail', ...others];
}

/**
 * The menu itself, headed by the account it belongs to
 *
 * @param label
 * @param surfaces
 * @returns {NativeMenuItem[]} empty when there is nothing to click
 */
export function planTabMenu(label: string, surfaces: readonly Surface[]): NativeMenuItem[] {
  if (surfaces.length === 0) return [];
  return [
    { kind: 'text', label },
    ...surfaces.map((s): NativeMenuItem => ({
      kind: 'item',
      id: s,
      label: SURFACE_CONFIG[s].label,
      icon: s,
    })),
  ];
}
