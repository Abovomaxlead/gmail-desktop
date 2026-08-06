// Where a Google app opens (in the app, its own window or the browser), which apps can
// be pinned to the bar, and which of those pins the account in view can actually open.

import { describe, expect, it } from 'vitest';
import { googleAppTarget, pinnedSurfaces } from '../electron/google-apps-open';
import { pinnedSurfacesFor } from '../renderer/lib/google-apps';
import { openableSurfaces } from '../renderer/lib/surfaces';

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

  it('lets "always a new window" beat the per-app exception', () => {
    // Both master switches settle every app at once, so the exclusion list has no say
    // while either is set - which is what lets the settings panel disable that list
    // without hiding a setting that still bites.
    expect(googleAppTarget('keep', { openInApp: true, alwaysNewWindow: true, excluded: ['keep'] })).toBe(
      'new-window',
    );
  });

  it('keeps a stored exclusion for when the master switches are off again', () => {
    const stored = { openInApp: true, alwaysNewWindow: true, excluded: ['keep'] };
    expect(googleAppTarget('keep', stored)).toBe('new-window');
    expect(googleAppTarget('keep', { ...stored, alwaysNewWindow: false })).toBe('external');
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

describe('pinnedSurfacesFor', () => {
  const PINS = ['drive', 'calendar', 'docs'];

  it('keeps every pin for one of your own accounts', () => {
    const openable = openableSurfaces({ kind: 'authuser', hasCalendar: true });
    expect(pinnedSurfacesFor(PINS, openable)).toEqual(['drive', 'calendar', 'docs']);
  });

  it('drops the Google apps for a delegated mailbox and keeps its calendar', () => {
    const openable = openableSurfaces({ kind: 'delegated', hasCalendar: true });
    expect(pinnedSurfacesFor(PINS, openable)).toEqual(['calendar']);
  });

  it('leaves a delegated mailbox without a calendar with nothing pinned', () => {
    const openable = openableSurfaces({ kind: 'delegated', hasCalendar: false });
    expect(pinnedSurfacesFor(PINS, openable)).toEqual([]);
  });

  it('pins nothing while a tab is still provisional', () => {
    const openable = openableSurfaces({ kind: 'authuser', hasCalendar: true, provisional: true });
    expect(pinnedSurfacesFor(PINS, openable)).toEqual([]);
  });

  it('keeps the order of the pinned list, not of the openable list', () => {
    const openable = openableSurfaces({ kind: 'authuser', hasCalendar: true });
    expect(pinnedSurfacesFor(['docs', 'drive'], openable)).toEqual(['docs', 'drive']);
    expect(pinnedSurfacesFor(['drive', 'docs'], openable)).toEqual(['drive', 'docs']);
  });

  it('still drops keys no version of the app can pin', () => {
    const openable = openableSurfaces({ kind: 'authuser', hasCalendar: true });
    expect(pinnedSurfacesFor(['photos', 'mail', 'drive'], openable)).toEqual(['drive']);
  });

  it('pins nothing when no account is in view', () => {
    expect(pinnedSurfacesFor(PINS, [])).toEqual([]);
  });
});
