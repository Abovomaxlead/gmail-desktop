// What the release-notes modal is told, in renderer/lib so main and the page read one
// declaration instead of two that have to be kept equal by hand.
//
// The notes are already parsed when they arrive: main owns the changelog parser, and the
// panel and this modal draw the same shape so one release never reads two ways.

import type { ChangelogVersion } from './changelog-types';


//===========================
// Types
//===========================

export interface ReleaseNotesAsk {
  /** The version that is being offered, which is not the one running */
  version: string;
  /** What that release says about itself; null when the release carried no notes */
  notes: ChangelogVersion | null;
  /** True once the download is already running, which is what turns the button into a line
   * of text -- a second press would start nothing and say nothing. */
  downloading: boolean;
  locale: 'en' | 'nl';
  reneMode: boolean;
  /** Whether the app is drawing dark; the modal runs in its own window and cannot read the
   * class the sidebar page puts on itself */
  dark: boolean;
}
