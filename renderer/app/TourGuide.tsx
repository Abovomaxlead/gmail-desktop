'use client';

import { useEffect, useRef } from 'react';
import Shepherd from 'shepherd.js';
import { offset } from '@floating-ui/dom';
import type { StepOptions } from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import { anchorSelector, type TourStage, type TourStep } from './tour-steps';
import type { UiStrings } from './strings';

// Shepherd owns every pixel it draws, so this component renders nothing itself: its whole
// job is to build the tour, start it, and make sure every way out lands on onEnd exactly
// once. The Gmail views are hidden for the tour's duration, so a path out of here that
// forgets to report would leave the window blank.
//
// The effect has no dependencies on purpose. Rebuilding the tour on a re-render would
// restart it at step one every time an unread count arrived, and unread counts arrive
// constantly. The strings and the steps are read once, at the moment the tour starts.
//
// canClickTarget is false throughout: a click on the highlighted gear would open the
// settings panel over the tour, which the tour cannot see and cannot recover from.
//
// A staged step is anchored to something this tour renders itself, and shepherd looks its
// target up *before* beforeShowPromise runs. So skipMissingElement and waitForElement, which
// are right for every other step, are exactly wrong for these two: the first would skip the
// step because the stage is not on screen yet, and the second would sit out its whole timeout
// waiting for an element that only appears once the promise below has resolved. Hence the two
// overrides, and hence beforeShowPromise announcing the stage and waiting for a paint.


//===========================
// Constants
//===========================

// Long enough for the card to have settled before the OS menu takes the pointer. Popping it
// in the same frame as the step is shown lands a native window on top of a card that is still
// being positioned, and the menu then reads as a glitch rather than an answer.
const TAB_MENU_DELAY_MS = 400;


//===========================
// Component
//===========================

/**
 * Runs the guided tour and reports when it is over
 *
 * @param steps the planned steps, already filtered to what this window can show
 * @param S the active string set
 * @param onStage called on every step with what the tour should have on screen, null included
 * @param onTabMenu called when a step wants the real OS tab menu popped
 * @param onEnd called once, whether the tour was finished, skipped or unmounted
 */
export function TourGuide({
  steps,
  S,
  onStage,
  onTabMenu,
  onEnd,
}: {
  steps: TourStep[];
  S: UiStrings;
  onStage(stage: TourStage): void;
  onTabMenu(): void;
  onEnd(): void;
}) {
  // Read through refs so a new callback identity cannot re-run the effect and restart the tour
  const end = useRef(onEnd);
  end.current = onEnd;
  const stage = useRef(onStage);
  stage.current = onStage;
  const tabMenu = useRef(onTabMenu);
  tabMenu.current = onTabMenu;

  useEffect(() => {
    if (steps.length === 0) {
      end.current();
      return;
    }

    const tour = new Shepherd.Tour({
      useModalOverlay: true,
      defaultStepOptions: {
        canClickTarget: false,
        skipMissingElement: true,
        waitForElement: 2000,
        scrollTo: false,
        cancelIcon: { enabled: true },
        modalOverlayOpeningPadding: 6,
        modalOverlayOpeningRadius: 10,
      },
    });

    const timers: number[] = [];

    steps.forEach((step, i) => {
      const selector = anchorSelector(step.anchor);
      const options: StepOptions = {
        id: step.id,
        title: S[step.titleKey],
        text: S[step.bodyKey],
        // Every step announces its stage, null included, so leaving a staged step clears it
        // without the next step having to know what the last one put up.
        beforeShowPromise: () => {
          stage.current(step.stage);
          return afterPaint();
        },
        buttons: [
          i === 0
            ? { text: S.tourSkip, secondary: true, action: () => void tour.cancel() }
            : { text: S.tourBack, secondary: true, action: () => void tour.back() },
          i === steps.length - 1
            ? { text: S.tourDone, action: () => tour.complete() }
            : { text: S.tourNext, action: () => void tour.next() },
        ],
      };
      if (selector) options.attachTo = { element: selector, on: step.on };
      if (step.classes) options.classes = step.classes;
      // Concatenated with shepherd's own flip and shift rather than replacing them, because it
      // merges the two with deepmerge-ts and that joins arrays. The arrow survives too: it is
      // appended only when the merged list holds no middleware named 'arrow'.
      if (step.offset) options.floatingUIOptions = { middleware: [offset(step.offset)] };
      if (step.stage !== null) {
        options.skipMissingElement = false;
        options.waitForElement = 0;
      }
      if (step.opensTabMenu) {
        options.when = {
          show: () => {
            timers.push(window.setTimeout(() => tabMenu.current(), TAB_MENU_DELAY_MS));
          },
        };
      }
      tour.addStep(options);
    });

    // Finishing and skipping differ in what the user learned, not in what the app has to
    // do, so both arrive here. The flag is what keeps the unmount path from reporting a
    // second time after the tour has already ended on its own.
    let reported = false;
    const finish = () => {
      if (reported) return;
      reported = true;
      for (const t of timers) window.clearTimeout(t);
      // The stage outlives shepherd's own teardown, so it has to be taken down by hand or a
      // demo strip would stay on screen after the tour is gone.
      stage.current(null);
      end.current();
    };
    tour.on('complete', finish);
    tour.on('cancel', finish);
    void tour.start();

    // Torn down silently. Completing the tour here would report it as finished and write
    // tour.seen, so anything that unmounts and remounts this component -- StrictMode in a dev
    // build being the obvious one -- would mark the tour done and then run it again with the
    // window no longer given over to it. A window closed halfway leaves seen false instead,
    // which means the tour comes back, and that is the kinder of the two mistakes.
    return () => {
      for (const t of timers) window.clearTimeout(t);
      tour.off('complete', finish);
      tour.off('cancel', finish);
      if (tour.isActive()) void tour.cancel();
      stage.current(null);
    };
  }, []);

  return null;
}


//===========================
// Helper functions
//===========================

/**
 * Resolves once the browser has painted
 *
 * Two frames rather than one: the first is where React commits the stage, the second is the
 * first moment its element has a box for shepherd to measure.
 *
 * @returns {Promise<void>}
 * @private
 */
function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}
