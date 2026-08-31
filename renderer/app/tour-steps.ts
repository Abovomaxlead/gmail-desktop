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

import type { UiStrings } from './strings';


//===========================
// Types
//===========================

export type TourAnchor = 'tabs' | 'add' | 'pinned' | 'feedback' | 'gear' | 'stage' | null;

/** What the tour puts on screen for the length of a step. */
export type TourStage = 'strip' | 'label-panel' | null;

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
  /** null for every step that points at interface the window already shows. */
  stage: TourStage;
  /** Whether entering this step pops the real OS tab menu, which no stage can imitate. */
  opensTabMenu: boolean;
  /**
   * Extra classes on this step's card, for a step that needs styling its neighbours do not.
   *
   * Shepherd's own `classPrefix` is not this hook: it sits on the tour rather than the step,
   * and it renames shepherd's internal class names instead of adding one. Note also that a
   * padding class widens the card rather than moving it, because FloatingUI positions the
   * element with `left` and `top`; shifting a card is `floatingUIOptions`, not a class.
   */
  classes?: string;
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
