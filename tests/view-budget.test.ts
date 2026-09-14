// The low-memory rule: which views survive when only what is on screen may stay loaded.

import { describe, it, expect } from 'vitest';
import {
  mayBuildAheadOfDemand,
  viewsToDiscard,
} from '../electron/windows/view-budget';
import type { ViewId } from '../electron/windows/profile-view-manager';

const v = (accountKey: string, surface: ViewId['surface'] = 'mail'): ViewId => ({
  accountKey,
  surface,
});

describe('viewsToDiscard', () => {
  it('keeps the view on screen and drops the rest', () => {
    const live = [v('u0'), v('u1'), v('d:support@x.nl')];
    expect(viewsToDiscard({ live, onScreen: [v('u1')] })).toEqual([v('u0'), v('d:support@x.nl')]);
  });

  it('drops everything when nothing is on screen', () => {
    const live = [v('u0'), v('u1')];
    expect(viewsToDiscard({ live, onScreen: [] })).toEqual(live);
  });

  it('drops everything when the view on screen is not among the live ones', () => {
    const live = [v('u0'), v('u1')];
    expect(viewsToDiscard({ live, onScreen: [v('u7')] })).toEqual(live);
  });

  it('returns nothing for an empty list', () => {
    expect(viewsToDiscard({ live: [], onScreen: [v('u0')] })).toEqual([]);
  });

  it('does not mutate what it was given', () => {
    const live = [v('u0'), v('u1')];
    const copy = [...live];
    viewsToDiscard({ live, onScreen: [v('u0')] });
    expect(live).toEqual(copy);
  });

  // The bug this module was rewritten for: sweeping mail views alone left every Google-app
  // view resident -- drive, docs, chat and the rest each cost their own renderer -- and the
  // setting did nothing anyone could notice.
  it('sweeps every surface, not just mail', () => {
    const live = [v('u0', 'mail'), v('u0', 'drive'), v('u0', 'chat'), v('u1', 'docs')];
    expect(viewsToDiscard({ live, onScreen: [v('u0', 'mail')] })).toEqual([
      v('u0', 'drive'),
      v('u0', 'chat'),
      v('u1', 'docs'),
    ]);
  });

  // Same account is not the same view: looking at a calendar is no reason to keep its mail
  // view loaded, or the setting would spare a whole second renderer per account.
  it('discards one account\'s mail view while its calendar is on screen', () => {
    const live = [v('u0', 'mail'), v('u0', 'calendar')];
    expect(viewsToDiscard({ live, onScreen: [v('u0', 'calendar')] })).toEqual([v('u0', 'mail')]);
  });

  it('keeps only the exact view on screen when an account holds several', () => {
    const live = [v('u0', 'mail'), v('u0', 'calendar'), v('u0', 'drive')];
    expect(viewsToDiscard({ live, onScreen: [v('u0', 'drive')] })).toEqual([
      v('u0', 'mail'),
      v('u0', 'calendar'),
    ]);
  });

  // A mailbox dragged into a window of its own is as much on screen as the one in the main
  // window. Sweeping it because another window is in front would blank a window the user is
  // reading, which is the one thing this setting may never do.
  it('spares the view in every window, not just the one in front', () => {
    const live = [v('u0'), v('u1'), v('d:support@x.nl')];
    expect(viewsToDiscard({ live, onScreen: [v('u0'), v('d:support@x.nl')] })).toEqual([v('u1')]);
  });
});

describe('mayBuildAheadOfDemand', () => {
  it('refuses under low memory and allows it otherwise', () => {
    expect(mayBuildAheadOfDemand(true)).toBe(false);
    expect(mayBuildAheadOfDemand(false)).toBe(true);
  });
});
