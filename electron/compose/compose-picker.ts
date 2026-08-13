// The bookkeeping behind the account picker, kept free of Electron so it can be tested
// without a window: main injects `open`, `close` and `redispatch`, the same shape as
// tray-controller.ts and layout.ts. One promise is in flight at a time; a second mailto:
// arriving while the picker is up is parked rather than dropped, because that second
// link comes in through `second-instance`, which focuses the window first — the user
// would otherwise see a picker still headlined with the first recipient and compose to
// the wrong person. The parked link is redispatched in a microtask rather than inline, so
// the awaiting caller finishes opening the compose window for the first answer before the
// next picker appears and takes focus.
//
// The sizing is here too because it is pure arithmetic over a row count: the card is a
// fixed width, one row per account, and everything scales with the Rene zoom factor since
// a brand-new window starts at factor 1 and inherits nothing from the main window, and the
// height is clamped to what the display can actually hold.


//===========================
// Types
//===========================

export interface PickerSize {
  width: number;
  height: number;
}

export interface ComposePickerHooks<Req, Parked> {
  open: (request: Req) => void;
  close: () => void;
  redispatch: (parked: Parked) => void;
}


//===========================
// Constants
//===========================

export const PICKER_WIDTH = 420;

// the header block plus the "send from" eyebrow that sits between it and the list
export const PICKER_HEADER_HEIGHT = 104;

export const PICKER_ROW_HEIGHT = 58;
export const PICKER_FOOTER_HEIGHT = 60;

// rows past the ninth have no digit shortcut left, so the list scrolls beyond that
export const PICKER_MAX_VISIBLE_ROWS = 9;


//===========================
// Exported functions
//===========================

/**
 * The opening size of the picker window
 *
 * Constants over a row count cannot know how a subject wraps, how long an address is, or
 * what the OS font metrics are, so the page measures its own card once it has laid out and
 * main resizes the still-hidden window to the measured value. These only have to get the
 * window close enough that the correction is small.
 *
 * @param rows one per account
 * @param zoom a brand-new window starts at factor 1 and inherits nothing from the main one
 * @param maxHeight what the display can actually hold
 * @returns {PickerSize}
 */
export function pickerWindowSize(rows: number, zoom = 1, maxHeight = Infinity): PickerSize {
  const visible = Math.max(1, Math.min(Math.floor(rows), PICKER_MAX_VISIBLE_ROWS));
  const natural = PICKER_HEADER_HEIGHT + visible * PICKER_ROW_HEIGHT + PICKER_FOOTER_HEIGHT;
  return {
    width: Math.round(PICKER_WIDTH * zoom),
    height: Math.min(Math.round(natural * zoom), Math.round(maxHeight)),
  };
}


//===========================
// Picker
//===========================

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
   * Opens the picker, or parks the request when one is already open
   *
   * The parked request is redispatched once the open one is answered.
   *
   * @param request
   * @param parked what to come back to, when this call has to wait its turn
   * @returns {Promise<number|null>} the account chosen, or null when the picker was
   *   dismissed or this request was parked
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

  /**
   * Answers the open picker, exactly once
   *
   * The resolver is read and nulled before closing, so the window's own `closed` event —
   * which closing triggers — finds nothing left to settle.
   *
   * @param index the account chosen, or null when the picker was dismissed
   */
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
