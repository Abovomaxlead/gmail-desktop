// Where the stack window goes. Split from toast-window.ts so it can be tested without a
// display: a second monitor left of the primary one has a negative x, and getting that
// wrong puts the toasts off screen for exactly the people who would not think to report
// it. Sizes arrive in CSS pixels because that is what the page can measure, and are
// multiplied by the zoom factor actually in effect — Rene mode doubles the whole UI, and
// a window sized to the unzoomed measurement would clip every card in half.

export interface ToastRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Gap between the stack and the screen edges, on both axes. */
export const TOAST_MARGIN = 16;

/** The card width the page lays out to, in CSS pixels. */
export const TOAST_WIDTH = 380;

function usableHeight(workArea: ToastRect): number {
  return Math.max(1, workArea.height - TOAST_MARGIN * 2);
}

/** Bottom-right of the work area, sized to what the page measured, clamped to what fits. */
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

/** True when a stack this tall would not fit, which is a second reason to collapse it. */
export function exceedsWorkArea(workArea: ToastRect, cssHeight: number, zoom: number): boolean {
  return Math.round(cssHeight * zoom) > usableHeight(workArea);
}
