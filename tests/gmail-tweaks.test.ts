// The CSS injected into Gmail's own page, and the rules that drive it.

import { describe, it, expect } from 'vitest';
import { GMAIL_TWEAK_RULES, gmailTweakCss } from '../electron/gmail-tweaks';

describe('gmailTweakCss', () => {
  it('is empty when nothing is switched on', () => {
    expect(gmailTweakCss({ hideInboxFooter: false })).toBe('');
  });

  it('emits a rule when the footer is hidden', () => {
    const css = gmailTweakCss({ hideInboxFooter: true });
    expect(css).not.toBe('');
    expect(css).toContain('display: none');
    expect(css.split('{').length).toBe(css.split('}').length);
    expect(css.trimEnd().endsWith('}')).toBe(true);
  });
});

describe('GMAIL_TWEAK_RULES', () => {
  it('has exactly one rule, for the inbox footer', () => {
    expect(GMAIL_TWEAK_RULES).toHaveLength(1);
    expect(GMAIL_TWEAK_RULES[0].pref).toBe('hideInboxFooter');
  });

  it('gives every rule at least one selector', () => {
    for (const rule of GMAIL_TWEAK_RULES) expect(rule.selectors.length).toBeGreaterThan(0);
  });

  it('never uses an unbounded :has()', () => {
    for (const rule of GMAIL_TWEAK_RULES) {
      for (const selector of rule.selectors) {
        if (!selector.includes(':has(')) continue;
        expect(selector).toContain(':has(>');
      }
    }
  });

  it('never leans only on obfuscated class names', () => {
    for (const rule of GMAIL_TWEAK_RULES) {
      const semantic = rule.selectors.some((s) => /\[|role=|href|aria-/.test(s));
      expect(semantic).toBe(true);
    }
  });
});
