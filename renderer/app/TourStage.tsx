'use client';

import {
  CANCEL_ID,
  CANCEL_LABEL,
  DROPZONE_CSS,
  DROPZONE_ID,
  DROPZONE_LABEL,
} from '../../electron/mail/dropzone';
import { TOPBAR_HEIGHT } from '../lib/topbar';
import { LabelPane, MailboxRail, type AccountLabels } from './maildrop/panel-parts';
import { mailboxRows } from './mailbox-rail';
import { demoLabels, type TourStage as Stage } from './tour-steps';
import type { UiStrings } from './strings';

// What the tour puts on screen for a step that describes interface the user has never
// triggered. Both stages show the real thing rather than a picture of it: the strip is styled
// by DROPZONE_CSS itself, and the panel is the real MailboxRail and LabelPane with example
// props. Nothing here can drift from what the app actually draws, which is the whole reason it
// is built this way instead of as a mockup.
//
// Positioned inside the content area, below the topbar, because that is where both of these
// live in the real app: the strip is fixed to the top of the Gmail page, and Gmail starts
// under the bar.
//
// The strip needs two overrides on the real stylesheet and no more. `position: absolute`
// instead of fixed, since here it sits inside a box that already starts below the bar rather
// than in the Gmail page. And a z-index it can actually be seen under: DROPZONE_Z is
// 2147483646, which would put the demo over shepherd's own card.


//===========================
// Constants
//===========================

const STRIP_OVERRIDE = `
#${DROPZONE_ID} { position: absolute; z-index: 1; }
#${CANCEL_ID} { pointer-events: none; }
`;

/** Roughly the real panel's proportions, small enough to leave the card room underneath. */
const PANEL_WIDTH = 620;
const PANEL_HEIGHT = 320;


//===========================
// Component
//===========================

/**
 * Draws the stage a step asked for
 *
 * @param stage which stage, or null to draw nothing
 * @param email the mailbox the demo panel names, so the rail shows a real address
 * @param S the active string set
 */
export function TourStage({
  stage,
  email,
  S,
}: {
  stage: Stage;
  email: string;
  S: UiStrings;
}) {
  if (stage === null) return null;

  return (
    <div
      data-tour="stage"
      className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center"
      style={{ top: TOPBAR_HEIGHT }}
    >
      {stage === 'strip' ? <DemoStrip /> : <DemoPanel email={email} S={S} />}
    </div>
  );
}


//===========================
// Helper components
//===========================

/**
 * The drag-to-save strip exactly as Gmail's own page shows it
 *
 * @private
 */
function DemoStrip() {
  return (
    <>
      <style>{DROPZONE_CSS + STRIP_OVERRIDE}</style>
      <div id={DROPZONE_ID} data-state="armed">
        {DROPZONE_LABEL}
        <button id={CANCEL_ID} type="button" tabIndex={-1}>
          {CANCEL_LABEL}
        </button>
      </div>
    </>
  );
}

/**
 * The label picker's two halves, the real components with example labels in them
 *
 * @param email the mailbox the rail names
 * @param S
 * @private
 */
function DemoPanel({ email, S }: { email: string; S: UiStrings }) {
  const labels = demoLabels(S.tourDemoLabels);
  const account: AccountLabels = { email, labels };
  // One ticked label, so the panel shows what a choice looks like rather than an empty list
  const picked = labels.length > 0 ? [labels[0].id] : [];
  const rows = mailboxRows([{ email, labels }], { [email]: picked }, [], '');

  return (
    <div
      className="mt-6 flex overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl dark:border-white/10 dark:bg-neutral-900"
      style={{ width: PANEL_WIDTH, height: PANEL_HEIGHT }}
    >
      <MailboxRail rows={rows} active={email} onSelect={noop} />
      <LabelPane
        account={account}
        search=""
        recent={[]}
        picked={picked}
        disabled={false}
        tree={null}
        treeOffered={false}
        onFlatMode={noop}
        countExisting={zero}
        onToggle={noop}
      />
    </div>
  );
}


//===========================
// Helper functions
//===========================

// The stage is a picture, not a control: the wrapper takes pointer events away, and these two
// stand in for the handlers the real panel wires to IPC.
function noop(): void {}

function zero(): number {
  return 0;
}
