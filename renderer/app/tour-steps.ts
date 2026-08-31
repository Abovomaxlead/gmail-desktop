// The tour's script: which steps exist, in what order, and which of them this window can
// actually show. Pure on purpose - no React and no shepherd - so the order and the string
// keys are checked by a test instead of by running the app and watching.
//
// A step with a null anchor is a card in the middle of the window with nothing spotlit.
// Anchors name a [data-tour] attribute on one of Topbar's own controls, never a class or a
// position: a class is a styling decision that may change, and the attribute exists for
// this and nothing else.

import type { UiStrings } from './strings';


//===========================
// Types
//===========================

export type TourAnchor = 'tabs' | 'add' | 'pinned' | 'feedback' | 'gear' | null;

/** The plain-string members of UiStrings; a tour step never takes a parameter. */
export type TourTextKey = {
  [K in keyof UiStrings]: UiStrings[K] extends string ? K : never;
}[keyof UiStrings];

export interface TourStep {
  id: string;
  anchor: TourAnchor;
  /** Ignored when anchor is null: a centred card has nothing to sit below. */
  on: 'bottom' | 'bottom-start' | 'bottom-end';
  titleKey: TourTextKey;
  bodyKey: TourTextKey;
}

export interface TourInput {
  hasPinned: boolean;
}


//===========================
// Constants
//===========================

const STEPS: readonly TourStep[] = [
  {
    id: 'welcome',
    anchor: null,
    on: 'bottom',
    titleKey: 'tourWelcomeTitle',
    bodyKey: 'tourWelcomeBody',
  },
  {
    id: 'tabs',
    anchor: 'tabs',
    on: 'bottom-start',
    titleKey: 'tourTabsTitle',
    bodyKey: 'tourTabsBody',
  },
  {
    id: 'tab-menu',
    anchor: 'tabs',
    on: 'bottom-start',
    titleKey: 'tourTabMenuTitle',
    bodyKey: 'tourTabMenuBody',
  },
  {
    id: 'add',
    anchor: 'add',
    on: 'bottom',
    titleKey: 'tourAddTitle',
    bodyKey: 'tourAddBody',
  },
  {
    id: 'pinned',
    anchor: 'pinned',
    on: 'bottom-end',
    titleKey: 'tourPinnedTitle',
    bodyKey: 'tourPinnedBody',
  },
  {
    id: 'maildrop',
    anchor: null,
    on: 'bottom',
    titleKey: 'tourMailDropTitle',
    bodyKey: 'tourMailDropBody',
  },
  {
    id: 'feedback',
    anchor: 'feedback',
    on: 'bottom-end',
    titleKey: 'tourFeedbackTitle',
    bodyKey: 'tourFeedbackBody',
  },
  {
    id: 'gear',
    anchor: 'gear',
    on: 'bottom-end',
    titleKey: 'tourGearTitle',
    bodyKey: 'tourGearBody',
  },
];


//===========================
// Exported functions
//===========================

/**
 * The steps this window can show, in order
 *
 * @param input what the window currently has on screen
 * @returns fresh copies of the script with unshowable steps removed
 */
export function planTour(input: TourInput): TourStep[] {
  return STEPS.filter((step) => step.anchor !== 'pinned' || input.hasPinned).map((step) => ({
    ...step,
  }));
}

/**
 * The selector a step's anchor resolves to
 *
 * @param anchor
 * @returns the selector, or null for a centred step
 */
export function anchorSelector(anchor: TourAnchor): string | null {
  return anchor === null ? null : `[data-tour="${anchor}"]`;
}
