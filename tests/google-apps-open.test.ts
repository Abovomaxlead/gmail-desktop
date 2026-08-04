// Where a Google app opens (in the app, its own window or the browser) and which apps
// can be pinned to the bar.

import { describe, expect, it } from 'vitest';
import { googleAppTarget, pinnedSurfaces } from '../electron/google-apps-open';

const BASE = { openInApp: true, alwaysNewWindow: false, excluded: [] as string[] };

describe('googleAppTarget', () => {
  it('opens in the existing window by default', () => {
    expect(googleAppTarget('calendar', BASE)).toBe('in-app');
    expect(googleAppTarget('drive', BASE)).toBe('in-app');
  });

  it('opens a separate window when asked to', () => {
    expect(googleAppTarget('drive', { ...BASE, alwaysNewWindow: true })).toBe('new-window');
  });

  it('sends everything to the browser when the app is switched off', () => {
    expect(googleAppTarget('drive', { ...BASE, openInApp: false })).toBe('external');
    expect(googleAppTarget('calendar', { ...BASE, openInApp: false })).toBe('external');
  });

  it('sends an excluded app to the browser', () => {
    expect(googleAppTarget('keep', { ...BASE, excluded: ['keep'] })).toBe('external');
  });

  it('leaves the apps that are not on the list alone', () => {
    const prefs = { ...BASE, excluded: ['keep'] };
    expect(googleAppTarget('keep', prefs)).toBe('external');
    expect(googleAppTarget('drive', prefs)).toBe('in-app');
  });

  it('lets the per-app exception beat "always a new window"', () => {
    expect(googleAppTarget('keep', { openInApp: true, alwaysNewWindow: true, excluded: ['keep'] })).toBe(
      'external',
    );
  });

  it('lets "not in the app" beat "always a new window"', () => {
    expect(googleAppTarget('drive', { openInApp: false, alwaysNewWindow: true, excluded: [] })).toBe(
      'external',
    );
  });

  it('still says browser when every reason to say so is set', () => {
    expect(
      googleAppTarget('keep', { openInApp: false, alwaysNewWindow: true, excluded: ['keep'] }),
    ).toBe('external');
  });
});

const KNOWN = ['calendar', 'drive', 'docs', 'keep'];

describe('pinnedSurfaces', () => {
  it('keeps the known keys in the order given', () => {
    expect(pinnedSurfaces(['keep', 'calendar', 'docs'], KNOWN)).toEqual(['keep', 'calendar', 'docs']);
  });

  it('does not fall back to the order of the known list', () => {
    expect(pinnedSurfaces(['docs', 'calendar'], KNOWN)).toEqual(['docs', 'calendar']);
    expect(pinnedSurfaces(['calendar', 'docs'], KNOWN)).toEqual(['calendar', 'docs']);
  });

  it('drops keys the app does not know', () => {
    expect(pinnedSurfaces(['drive', 'tasks', 'photos'], KNOWN)).toEqual(['drive']);
    expect(pinnedSurfaces(['nope'], KNOWN)).toEqual([]);
  });

  it('removes duplicates and keeps the first position', () => {
    expect(pinnedSurfaces(['drive', 'docs', 'drive'], KNOWN)).toEqual(['drive', 'docs']);
  });

  it('handles empty input on either side', () => {
    expect(pinnedSurfaces([], KNOWN)).toEqual([]);
    expect(pinnedSurfaces(['drive'], [])).toEqual([]);
    expect(pinnedSurfaces([], [])).toEqual([]);
  });

  it('leaves the given list untouched', () => {
    const stored = ['drive', 'nope', 'drive'];
    expect(pinnedSurfaces(stored, KNOWN)).toEqual(['drive']);
    expect(stored).toEqual(['drive', 'nope', 'drive']);
  });
});
