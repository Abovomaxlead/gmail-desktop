// The custom title bar: theme, overlay options, window background and platform support.

import { describe, it, expect } from 'vitest';
import {
  isDarkTheme,
  overlayOptions,
  supportsOverlay,
  supportsOverlayUpdate,
  windowBackground,
} from '../electron/titlebar';
import { TOPBAR_HEIGHT } from '../electron/layout';

describe('isDarkTheme', () => {
  it('follows the explicit choice', () => {
    expect(isDarkTheme('dark', false)).toBe(true);
    expect(isDarkTheme('light', true)).toBe(false);
  });

  it('follows the system only when the choice is system', () => {
    expect(isDarkTheme('system', true)).toBe(true);
    expect(isDarkTheme('system', false)).toBe(false);
  });
});

describe('overlayOptions', () => {
  it('gives a dark bar dark colours and a light bar light ones', () => {
    const dark = overlayOptions('dark', false, false);
    const light = overlayOptions('light', true, false);
    expect(dark.color).not.toBe(light.color);
    expect(dark.symbolColor).not.toBe(light.symbolColor);
  });

  it('matches the renderer background, so the bar and the buttons are one surface', () => {
    expect(overlayOptions('light', false, false).color).toBe('#f5f5f5');
    expect(overlayOptions('dark', false, false).color).toBe('#0a0a0a');
  });

  it('is as tall as the bar', () => {
    expect(overlayOptions('light', false, false).height).toBe(TOPBAR_HEIGHT);
  });

  it('doubles for Rene mode, which zooms the renderer to 200%', () => {
    expect(overlayOptions('light', false, true).height).toBe(TOPBAR_HEIGHT * 2);
  });
});

describe('windowBackground', () => {
  it('follows the theme instead of always being dark', () => {
    expect(windowBackground('light', false)).toBe('#f5f5f5');
    expect(windowBackground('dark', false)).toBe('#0a0a0a');
    expect(windowBackground('system', false)).toBe('#f5f5f5');
    expect(windowBackground('system', true)).toBe('#0a0a0a');
  });

  it('matches the bar it sits behind', () => {
    expect(windowBackground('light', false)).toBe(overlayOptions('light', false, false).color);
    expect(windowBackground('dark', false)).toBe(overlayOptions('dark', false, false).color);
  });
});

describe('supportsOverlay', () => {
  it('is available on Windows and macOS', () => {
    expect(supportsOverlay('win32')).toBe(true);
    expect(supportsOverlay('darwin')).toBe(true);
  });

  it('is not available on Linux', () => {
    expect(supportsOverlay('linux')).toBe(false);
  });
});

describe('supportsOverlayUpdate', () => {
  it('allows updating the overlay on Windows', () => {
    expect(supportsOverlayUpdate('win32')).toBe(true);
  });

  it('accepts the option on macOS but refuses the update', () => {
    expect(supportsOverlay('darwin')).toBe(true);
    expect(supportsOverlayUpdate('darwin')).toBe(false);
  });

  it('refuses the update on Linux, where we never enable the overlay', () => {
    expect(supportsOverlayUpdate('linux')).toBe(false);
  });
});
