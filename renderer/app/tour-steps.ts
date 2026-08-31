// The tour's script: which steps exist, in what order, and which of them this window can
// actually show. Pure on purpose - no React and no shepherd - so the order and the string
// keys are checked by a test instead of by running the app and watching.
//
// A step with a null anchor is a card in the middle of the window with nothing spotlit.
// Anchors name a [data-tour] attribute on one of Topbar's own controls, never a class or a
// position: a class is a styling decision that may change, and the attribute exists for
// this and nothing else.
//
// Two steps describe interface a first-time user has never triggered, so they carry a stage:
// the tour puts the real component on screen with example data for as long as the step lasts,
// and anchors the card to it. The stage is the one anchor the tour draws itself, which is why
// TourGuide has to render it before the step positions rather than after.
//
// Where a card lands is steered per step by three knobs, in the order to reach for them:
// `on` for which side of the anchor it sits on, `offset` for a nudge when no side is quite
// right, and `classes` for styling that one card. Shepherd's `classPrefix` is none of these --
// it is tour-wide and only renames shepherd's own class names.

import type { UiStrings } from './strings';


//===========================
// Types
//===========================

export type TourAnchor = 'tabs' | 'add' | 'pinned' | 'feedback' | 'gear' | 'stage' | null;

/** What the tour puts on screen for the length of a step. */
export type TourStage = 'strip' | 'label-panel' | null;

/**
 * Where a card sits relative to its anchor.
 *
 * Shepherd's own placement union, written out here rather than imported: this module stays
 * free of shepherd so the tests can load it under vitest's node environment.
 */
export type TourPlacement =
  | 'top'
  | 'top-start'
  | 'top-end'
  | 'bottom'
  | 'bottom-start'
  | 'bottom-end'
  | 'left'
  | 'left-start'
  | 'left-end'
  | 'right'
  | 'right-start'
  | 'right-end';

/** How far a card is nudged off its anchor, in CSS pixels. */
export interface TourOffset {
  /** Away from the anchor, along the placement's own axis. */
  mainAxis?: number;
  /** Sideways along the anchor's edge. */
  crossAxis?: number;
}

/** The plain-string members of UiStrings; a tour step never takes a parameter. */
export type TourTextKey = {
  [K in keyof UiStrings]: UiStrings[K] extends string ? K : never;
}[keyof UiStrings];

export interface TourStep {
  id: string;
  anchor: TourAnchor;
  /** Ignored when anchor is null: a centred card has nothing to sit beside. */
  on: TourPlacement;
  titleKey: TourTextKey;
  bodyKey: TourTextKey;
  /** null for every step that points at interface the window already shows. */
  stage: TourStage;
  /** Whether entering this step pops the real OS tab menu, which no stage can imitate. */
  opensTabMenu: boolean;
  /**
   * Extra classes on this step's card, for a step that needs styling its neighbours do not.
   *
   * Shepherd's own `classPrefix` is not this hook: it sits on the tour rather than the step,
   * and it renames shepherd's internal class names instead of adding one. A padding class
   * widens the card rather than moving it, because FloatingUI positions the element with
   * `left` and `top`; moving a card is `on` and `offset` below.
   */
  classes?: string;
  /**
   * Nudges the card off its anchor, on top of whatever `on` already decided.
   *
   * Reach for `on` first: a different placement costs nothing and cannot fight FloatingUI.
   * This is for the case where no placement is quite right, and it carries one caveat worth
   * knowing. Shepherd merges its own middleware with ours through deepmerge-ts, which
   * concatenates arrays, so ours lands *after* its flip and shift rather than before. A modest
   * nudge is fine; a large one near the edge of the window can be clamped by a shift that was
   * decided before the nudge existed.
   */
  offset?: TourOffset;
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
    stage: null,
    opensTabMenu: false,
  },
  {
    id: 'tabs',
    anchor: 'tabs',
    on: 'bottom-start',
    titleKey: 'tourTabsTitle',
    bodyKey: 'tourTabsBody',
    stage: null,
    opensTabMenu: false,
  },
  // bottom-end where its neighbours are bottom-start, and it has to stay that way: this is the
  // one step that pops the OS menu, the menu opens under the active tab towards the left of the
  // strip, and a card at bottom-start would sit underneath it with the text unreadable. The
  // spotlight still cuts around the whole strip; only the card moves out of the way.
  {
    id: 'tab-menu',
    anchor: 'tabs',
    on: 'bottom-end',
    titleKey: 'tourTabMenuTitle',
    bodyKey: 'tourTabMenuBody',
    stage: null,
    opensTabMenu: true,
  },
  {
    id: 'add',
    anchor: 'add',
    on: 'bottom',
    titleKey: 'tourAddTitle',
    bodyKey: 'tourAddBody',
    stage: null,
    opensTabMenu: false,
  },
  {
    id: 'pinned',
    anchor: 'pinned',
    on: 'bottom-end',
    titleKey: 'tourPinnedTitle',
    bodyKey: 'tourPinnedBody',
    stage: null,
    opensTabMenu: false,
  },
  // Saving mail out comes before filing it back in, because the strip is what produces the
  // files the drop panel then asks about.
  {
    id: 'strip',
    anchor: 'stage',
    on: 'bottom',
    titleKey: 'tourStripTitle',
    bodyKey: 'tourStripBody',
    stage: 'strip',
    opensTabMenu: false,
  },
  {
    id: 'maildrop',
    anchor: 'stage',
    on: 'bottom',
    titleKey: 'tourMailDropTitle',
    bodyKey: 'tourMailDropBody',
    stage: 'label-panel',
    opensTabMenu: false,
  },
  {
    id: 'feedback',
    anchor: 'feedback',
    on: 'bottom-end',
    titleKey: 'tourFeedbackTitle',
    bodyKey: 'tourFeedbackBody',
    stage: null,
    opensTabMenu: false,
  },
  {
    id: 'gear',
    anchor: 'gear',
    on: 'bottom-end',
    titleKey: 'tourGearTitle',
    bodyKey: 'tourGearBody',
    stage: null,
    opensTabMenu: false,
  },
];


//===========================
// Exported functions
//===========================

/**
 * The steps, in order
 *
 * Every step is always shown. The pinned step used to be dropped when the bar had no pinned
 * Google app, which meant the one feature nobody discovers went unmentioned to exactly the
 * users who had not discovered it. The bar now borrows an example button for the length of
 * the tour instead, so there is always something to point at.
 *
 * @returns fresh copies of the script
 */
export function planTour(): TourStep[] {
  return STEPS.map((step) => ({ ...step }));
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

/**
 * Turns the comma-separated example labels into rows the demo panel can draw
 *
 * @param csv the tourDemoLabels string, which is one translated key rather than an array
 *   because UiStrings is flat and a translator should see the names together
 * @returns one row per name, with an id no real Gmail label can collide with
 */
export function demoLabels(csv: string): { id: string; name: string }[] {
  return csv
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')
    .map((name, i) => ({ id: `tour-demo-label-${i}`, name }));
}
