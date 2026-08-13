// Regression coverage for the delegated-discovery ordering bug: `refreshDelegatedFromApi()`
// was fired from `did-finish-load` before `startDetection()` had populated `profiles`, so
// `requestersInOrder()` always saw zero own accounts and the scan latched "done" without ever
// asking the relay anything.

import { describe, it, expect } from 'vitest';
import { canRunDelegatedApiScan } from '../electron/delegation/delegated-discovery-gate';

describe('canRunDelegatedApiScan', () => {
  it('refuses to run before any own account has been detected', () => {
    // This is exactly the state main.ts was in when `did-finish-load` called
    // `refreshDelegatedFromApi()` ahead of `startDetection()`: zero authuser profiles.
    expect(canRunDelegatedApiScan(0, false)).toBe(false);
  });

  it('runs once an own account exists and the scan has not started yet', () => {
    expect(canRunDelegatedApiScan(1, false)).toBe(true);
  });

  it('does not run again once already started, even with accounts present', () => {
    expect(canRunDelegatedApiScan(3, true)).toBe(false);
  });

  it('does not run with zero accounts even if not yet started', () => {
    expect(canRunDelegatedApiScan(0, true)).toBe(false);
  });
});
