// Turns the "hide this in Gmail" preferences into one CSS text that main injects per
// mail view. Pure — no Electron, no DOM — so the risky part, the selectors, is
// testable without a window.
//
// GMAIL_TWEAK_RULES is the only place a Gmail selector may live. Each rule lists several
// comma-separated candidates, because Google's obfuscated class names change without
// notice and a selector matching nothing is a harmless CSS no-op: prefer ones hanging
// off `role`, `aria-label` or `href` and let the guesses trail. `!important` is required,
// as Gmail sets its own `display` inline. Rules are emitted in table order, not
// preference order, so identical flags produce a byte-identical string and main does not
// re-inject; `''` is returned when nothing is on, and callers skip injection on that.

import type { GmailPrefs } from './prefs-store';

export type GmailHideFlag = 'hideInboxFooter';

export type GmailCssPrefs = Pick<GmailPrefs, GmailHideFlag>;

export type RuleConfidence = 'hoog' | 'midden' | 'laag';

export interface GmailTweakRule {
  readonly pref: GmailHideFlag;
  readonly selectors: readonly string[];
  readonly declarations: string;
  readonly confidence: RuleConfidence;
}

const HIDE = 'display: none !important;';

export const GMAIL_TWEAK_RULES: readonly GmailTweakRule[] = [
  {
    pref: 'hideInboxFooter',
    selectors: [
      '[role="contentinfo"]',
      'div:has(> a[href*="/policies/terms"])',
      'div:has(> span > a[href*="/policies/terms"])',
      '.aeJ .xn',
    ],
    declarations: HIDE,
    confidence: 'laag',
  },
];

export function gmailTweakCss(g: GmailCssPrefs): string {
  const blocks: string[] = [];
  for (const rule of GMAIL_TWEAK_RULES) {
    if (!g[rule.pref]) continue;
    blocks.push(`/* ${rule.pref} */\n${rule.selectors.join(',\n')} { ${rule.declarations} }`);
  }
  return blocks.join('\n\n');
}
