import { describe, it, expect } from 'vitest';
import { GMAIL_TWEAK_RULES, gmailTweakCss } from '../electron/gmail-tweaks';

// De tabel had vier regels; drie ervan (het logo, de afwezigheidsbalk en de
// opslagknop) zijn er op verzoek weer uit. Wat overblijft is de tekst onderaan het
// postvak. De tests hieronder gaan daarom niet over "elke voorkeur draagt zijn eigen
// regel bij" maar over de twee eigenschappen die deze ingreep gevaarlijk maken zodra
// ze wegvallen.

describe('gmailTweakCss', () => {
  // Uit betekent níets injecteren, en niet "een lege stylesheet". De preload leest een
  // lege tekst als "haal het `<style>`-element weg" — zie `applyTweakCss` — en dat is
  // de enige manier waarop uitzetten ook echt terugdraait zonder de pagina te herladen.
  it('is empty when nothing is switched on', () => {
    expect(gmailTweakCss({ hideInboxFooter: false })).toBe('');
  });

  it('emits a rule when the footer is hidden', () => {
    const css = gmailTweakCss({ hideInboxFooter: true });
    expect(css).not.toBe('');
    expect(css).toContain('display: none');
    // Gebalanceerde accolades: een halve regel is een stylesheet die de browser vanaf
    // dat punt negeert, en dan werkt de instelling stil niet.
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

  // De belangrijkste test in dit bestand. Een onbegrensde `div:has(a[href…])` matcht
  // élke voorouder van die link, tot en met de buitenste div — en `display: none`
  // daarop maakt het hele postvak leeg. De `>` bindt de match aan een direct kind en
  // houdt de ingreep klein.
  it('never uses an unbounded :has()', () => {
    for (const rule of GMAIL_TWEAK_RULES) {
      for (const selector of rule.selectors) {
        if (!selector.includes(':has(')) continue;
        expect(selector).toContain(':has(>');
      }
    }
  });

  // Google's klassenamen zijn versleuteld en veranderen zonder aankondiging. Een regel
  // die daar alléén op leunt houdt stil op te werken, dus moet er altijd minstens één
  // kandidaat op iets semantisch staan (een rol, een attribuut, een href).
  it('never leans only on obfuscated class names', () => {
    for (const rule of GMAIL_TWEAK_RULES) {
      const semantic = rule.selectors.some((s) => /\[|role=|href|aria-/.test(s));
      expect(semantic).toBe(true);
    }
  });
});
