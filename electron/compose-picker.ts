// The bookkeeping behind the account picker, kept free of Electron so it can be tested
// without a window: main injects `open`, `close` and `redispatch`, the same shape as
// tray-controller.ts and layout.ts. One promise is in flight at a time; a second mailto:
// arriving while the picker is up is parked rather than dropped, because that second
// link comes in through `second-instance`, which focuses the window first — the user
// would otherwise see a picker still headlined with the first recipient and compose to
// the wrong person. `settle` reads and nulls the resolver *before* closing, so the
// window's own `closed` event, which closing triggers, finds nothing left to settle and
// no-ops instead of resolving a second time. The parked link is redispatched in a
// microtask rather than inline, so the awaiting caller finishes opening the compose
// window for the first answer before the next picker appears and takes focus.
//
// The sizing is here too because it is pure arithmetic over a row count: the card is a
// fixed width, one row per account, and everything scales with the Rene zoom factor since
// a brand-new window starts at factor 1 and inherits nothing from the main window. Rows
// past the ninth have no digit shortcut left, so nine is also the natural cap on visible
// rows — beyond that the list scrolls — and the height is clamped to what the display can
// actually hold. This is the OPENING size only: constants over a row count cannot know how
// a subject wraps, how long an address is, or what the OS font metrics are, so the page
// measures its own card once it has laid out and main resizes the still-hidden window to
// the measured value. The constants only have to get the window close enough that the
// correction is small; PICKER_HEADER_HEIGHT covers the header block plus the "send from"
// eyebrow that sits between it and the list.

export const PICKER_WIDTH = 420;
export const PICKER_HEADER_HEIGHT = 104;
export const PICKER_ROW_HEIGHT = 58;
export const PICKER_FOOTER_HEIGHT = 60;
export const PICKER_MAX_VISIBLE_ROWS = 9;

export interface PickerSize {
  width: number;
  height: number;
}

/** The window size for `rows` accounts at `zoom`, never taller than `maxHeight`. */
export function pickerWindowSize(rows: number, zoom = 1, maxHeight = Infinity): PickerSize {
  const visible = Math.max(1, Math.min(Math.floor(rows), PICKER_MAX_VISIBLE_ROWS));
  const natural = PICKER_HEADER_HEIGHT + visible * PICKER_ROW_HEIGHT + PICKER_FOOTER_HEIGHT;
  return {
    width: Math.round(PICKER_WIDTH * zoom),
    height: Math.min(Math.round(natural * zoom), Math.round(maxHeight)),
  };
}

export interface ComposePickerHooks<Req, Parked> {
  open: (request: Req) => void;
  close: () => void;
  redispatch: (parked: Parked) => void;
}

export class ComposePicker<Req, Parked> {
  private resolver: ((index: number | null) => void) | null = null;
  private parked: Parked | null = null;

  constructor(private readonly hooks: ComposePickerHooks<Req, Parked>) {}

  isPending(): boolean {
    return this.resolver !== null;
  }

  hasParked(): boolean {
    return this.parked !== null;
  }

  /**
   * Opens the picker for `request`, or parks `parked` and answers null when one is
   * already open. The parked request is redispatched once the open one is answered.
   */
  ask(request: Req, parked: Parked): Promise<number | null> {
    if (this.resolver) {
      this.parked = parked;
      return Promise.resolve(null);
    }
    this.hooks.open(request);
    return new Promise<number | null>((resolve) => {
      this.resolver = resolve;
    });
  }

  /** Answers the open picker with `index`, exactly once. A second call does nothing. */
  settle(index: number | null): void {
    const resolve = this.resolver;
    if (!resolve) return;
    this.resolver = null;
    this.hooks.close();
    resolve(index);
    const next = this.parked;
    if (next === null) return;
    this.parked = null;
    queueMicrotask(() => this.hooks.redispatch(next));
  }
}
