import { describe, it, expect } from 'vitest';
import {
  isDarkTheme,
  overlayOptions,
  supportsOverlay,
  supportsOverlayUpdate,
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
  // Zonder dit staan de vensterknoppen donker-op-donker of licht-op-licht zodra
  // je van thema wisselt.
  it('gives a dark bar dark colours and a light bar light ones', () => {
    const dark = overlayOptions('dark', false, false);
    const light = overlayOptions('light', true, false);
    expect(dark.color).not.toBe(light.color);
    expect(dark.symbolColor).not.toBe(light.symbolColor);
  });

  it('matches the renderer background, so the bar and the buttons are one surface', () => {
    // De balk gebruikt Tailwind's neutral-100 (licht) en neutral-950 (donker).
    expect(overlayOptions('light', false, false).color).toBe('#f5f5f5');
    expect(overlayOptions('dark', false, false).color).toBe('#0a0a0a');
  });

  it('is as tall as the bar', () => {
    expect(overlayOptions('light', false, false).height).toBe(TOPBAR_HEIGHT);
  });

  // De hoogte van de overlay is in vensterpixels en zoomt niet mee met de
  // renderer. Zonder dit hangen de knoppen 40px hoog in een balk van 80px.
  it('doubles for Rene mode, which zooms the renderer to 200%', () => {
    expect(overlayOptions('light', false, true).height).toBe(TOPBAR_HEIGHT * 2);
  });
});

describe('supportsOverlay', () => {
  it('is available on Windows and macOS', () => {
    expect(supportsOverlay('win32')).toBe(true);
    expect(supportsOverlay('darwin')).toBe(true);
  });

  // Er wordt onder WSL ontwikkeld. Daar houden we het native frame, en een
  // blinde setTitleBarOverlay-aanroep zou de app laten omvallen.
  it('is not available on Linux', () => {
    expect(supportsOverlay('linux')).toBe(false);
  });
});

describe('supportsOverlayUpdate', () => {
  it('allows updating the overlay on Windows', () => {
    expect(supportsOverlayUpdate('win32')).toBe(true);
  });

  // Het verschil met supportsOverlay: macOS neemt de constructor-optie wél aan,
  // maar kent win.setTitleBarOverlay niet. Eén gedeelde guard zou daar bij elke
  // themawissel een TypeError geven.
  it('accepts the option on macOS but refuses the update', () => {
    expect(supportsOverlay('darwin')).toBe(true);
    expect(supportsOverlayUpdate('darwin')).toBe(false);
  });

  it('refuses the update on Linux, where we never enable the overlay', () => {
    expect(supportsOverlayUpdate('linux')).toBe(false);
  });
});
