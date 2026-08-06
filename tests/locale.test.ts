// Turning the language pref plus the system language into the locale the UI uses.

import { describe, it, expect } from 'vitest';
import { resolveLocale } from '../electron/locale';

describe('resolveLocale', () => {
  it('follows a Dutch system language', () => {
    expect(resolveLocale('system', 'nl')).toBe('nl');
    expect(resolveLocale('system', 'nl-NL')).toBe('nl');
    expect(resolveLocale('system', 'nl-BE')).toBe('nl');
  });

  it('falls back to English for any other system language', () => {
    expect(resolveLocale('system', 'en-US')).toBe('en');
    expect(resolveLocale('system', 'de-DE')).toBe('en');
    expect(resolveLocale('system', 'fr')).toBe('en');
  });

  it('ignores case in the system language', () => {
    expect(resolveLocale('system', 'NL-nl')).toBe('nl');
  });

  it('does not match a language that merely starts with the same letters', () => {
    expect(resolveLocale('system', 'nlx')).toBe('en');
    expect(resolveLocale('system', 'nld')).toBe('en');
  });

  it('lets an explicit choice beat the system language', () => {
    expect(resolveLocale('en', 'nl-NL')).toBe('en');
    expect(resolveLocale('nl', 'en-US')).toBe('nl');
  });

  it('survives a missing or malformed system language', () => {
    expect(resolveLocale('system', '')).toBe('en');
    expect(resolveLocale('system', undefined as unknown as string)).toBe('en');
    expect(resolveLocale('nl', '')).toBe('nl');
  });
});
