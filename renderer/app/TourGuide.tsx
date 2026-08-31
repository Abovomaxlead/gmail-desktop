'use client';

import { useEffect, useRef } from 'react';
import Shepherd from 'shepherd.js';
import type { StepOptions } from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import { anchorSelector, type TourStep } from './tour-steps';
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


//===========================
// Component
//===========================

/**
 * Runs the guided tour and reports when it is over
 *
 * @param steps the planned steps, already filtered to what this window can show
 * @param S the active string set
 * @param onEnd called once, whether the tour was finished, skipped or unmounted
 */
export function TourGuide({
  steps,
  S,
  onEnd,
}: {
  steps: TourStep[];
  S: UiStrings;
  onEnd(): void;
}) {
  // Read through a ref so a new onEnd identity cannot re-run the effect and restart the tour
  const end = useRef(onEnd);
  end.current = onEnd;

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

    steps.forEach((step, i) => {
      const selector = anchorSelector(step.anchor);
      const options: StepOptions = {
        id: step.id,
        title: S[step.titleKey],
        text: S[step.bodyKey],
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
      tour.addStep(options);
    });

    // Finishing and skipping differ in what the user learned, not in what the app has to
    // do, so both arrive here. The flag is what keeps the unmount path from reporting a
    // second time after the tour has already ended on its own.
    let reported = false;
    const finish = () => {
      if (reported) return;
      reported = true;
      end.current();
    };
    tour.on('complete', finish);
    tour.on('cancel', finish);
    void tour.start();

    return () => {
      if (!reported) tour.complete();
    };
  }, []);

  return null;
}
