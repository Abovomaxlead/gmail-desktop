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
    expect(viewsToDiscard({ live, active: v('u1') })).toEqual([v('u0'), v('d:support@x.nl')]);
  });

  it('drops everything when nothing is on screen', () => {
    const live = [v('u0'), v('u1')];
    expect(viewsToDiscard({ live, active: null })).toEqual(live);
  });

  it('drops everything when the active view is not among the live ones', () => {
    const live = [v('u0'), v('u1')];
    expect(viewsToDiscard({ live, active: v('u7') })).toEqual(live);
  });

  it('returns nothing for an empty list', () => {
    expect(viewsToDiscard({ live: [], active: v('u0') })).toEqual([]);
  });

  it('does not mutate what it was given', () => {
    const live = [v('u0'), v('u1')];
    const copy = [...live];
    viewsToDiscard({ live, active: v('u0') });
    expect(live).toEqual(copy);
  });

  // The bug this module was rewritten for: sweeping mail views alone left every Google-app
  // view resident -- drive, docs, chat and the rest each cost their own renderer -- and the
  // setting did nothing anyone could notice.
  it('sweeps every surface, not just mail', () => {
    const live = [v('u0', 'mail'), v('u0', 'drive'), v('u0', 'chat'), v('u1', 'docs')];
    expect(viewsToDiscard({ live, active: v('u0', 'mail') })).toEqual([
      v('u0', 'drive'),
      v('u0', 'chat'),
      v('u1', 'docs'),
    ]);
  });

  // Same account is not the same view: looking at a calendar is no reason to keep its mail
  // view loaded, or the setting would spare a whole second renderer per account.
  it('discards one account\'s mail view while its calendar is on screen', () => {
    const live = [v('u0', 'mail'), v('u0', 'calendar')];
    expect(viewsToDiscard({ live, active: v('u0', 'calendar') })).toEqual([v('u0', 'mail')]);
  });

  it('keeps only the exact view on screen when an account holds several', () => {
    const live = [v('u0', 'mail'), v('u0', 'calendar'), v('u0', 'drive')];
    expect(viewsToDiscard({ live, active: v('u0', 'drive') })).toEqual([
      v('u0', 'mail'),
      v('u0', 'calendar'),
    ]);
  });
});

describe('mayBuildAheadOfDemand', () => {
  it('refuses under low memory and allows it otherwise', () => {
    expect(mayBuildAheadOfDemand(true)).toBe(false);
    expect(mayBuildAheadOfDemand(false)).toBe(true);
  });
});
