// A window.open the main process denies returns null, which Gmail reports as a blocked
// popup, so the wrapper hands back a harmless stub instead.

import { describe, expect, it, vi } from 'vitest';
import { wrapWindowOpen } from '../electron/preload';

describe('wrapWindowOpen', () => {
  it('returns the real window when the open is allowed', () => {
    const real = { name: 'real' };
    const open = vi.fn(() => real);
    const wrapped = wrapWindowOpen(open as unknown as typeof window.open);
    expect(wrapped('https://x', '_blank')).toBe(real);
    expect(open).toHaveBeenCalledWith('https://x', '_blank');
  });

  it('returns a window-like stub instead of null when the open was denied', () => {
    const open = vi.fn(() => null);
    const wrapped = wrapWindowOpen(open as unknown as typeof window.open);
    const w = wrapped('https://mail.google.com/mail/u/0/#inbox/abc') as Window;
    expect(w).toBeTruthy();
    expect(w.closed).toBe(true);
    expect(() => {
      w.close();
      w.focus();
      w.blur();
      w.postMessage('x', '*');
    }).not.toThrow();
  });
});
