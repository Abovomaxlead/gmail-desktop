// Where the stack window goes. Split from toast-window.ts so it can be tested without a
// display: a monitor left of the primary one has a negative x, and getting that wrong puts
// the toasts off screen.
//
// Sizes arrive in CSS pixels and are multiplied by the zoom factor in effect, or Rene mode
// clips every card in half.


//===========================
// Types
//===========================

export interface ToastRect {
  x: number;
  y: number;
  width: number;
  height: number;
}


//===========================
// Constants
//===========================

/** Gap between the stack and the screen edges, on both axes. */
export const TOAST_MARGIN = 16;


//===========================
// Exported functions
//===========================

/**
 * Where the stack window belongs
 *
 * Bottom-right of the work area, sized to what the page measured and clamped to what
 * fits.
 *
 * @param workArea
 * @param cssSize what the page measured, in CSS pixels
 * @param zoom the factor actually in effect
 * @returns the bounds to give the window
 */
export function toastWindowBounds(
  workArea: ToastRect,
  cssSize: { width: number; height: number },
  zoom: number,
): ToastRect {
  const width = Math.max(1, Math.round(cssSize.width * zoom));
  const height = Math.max(1, Math.min(Math.round(cssSize.height * zoom), usableHeight(workArea)));
  return {
    x: workArea.x + workArea.width - width - TOAST_MARGIN,
    y: workArea.y + workArea.height - height - TOAST_MARGIN,
    width,
    height,
  };
}

/**
 * Whether a screen point falls inside a rect
 *
 * Asks whether the pointer is still over the stack, which the page cannot answer: a
 * click-through window is forwarded mouse moves but not the leave that ends them.
 *
 * @param rect
 * @param point
 * @returns true inside; half-open on the far edges, as pixel bounds are
 */
export function containsPoint(rect: ToastRect, point: { x: number; y: number }): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  );
}

/**
 * Whether a stack this tall would not fit
 *
 * @param workArea
 * @param cssHeight what the page measured, in CSS pixels
 * @param zoom the factor actually in effect
 * @returns true when the height is a second reason to collapse the stack
 */
export function exceedsWorkArea(workArea: ToastRect, cssHeight: number, zoom: number): boolean {
  return Math.round(cssHeight * zoom) > usableHeight(workArea);
}


//===========================
// Helper functions
//===========================

/**
 * The height left over once both margins are taken off
 *
 * @param workArea
 * @returns at least one pixel, so a tiny work area cannot produce a zero-height window
 * @private
 */
function usableHeight(workArea: ToastRect): number {
  return Math.max(1, workArea.height - TOAST_MARGIN * 2);
}
