// Where a notification click goes when the thread could not be identified. Matching the
// subject against the rows Gmail happens to have rendered is a guess by construction: a
// view showing an open conversation or another label has no list to match, and a long
// subject arrives cut off. Until now a miss opened the account and nothing else, which
// from the outside is the app doing nothing. Searching for the subject lands on the mail
// itself in every case the list could not answer.

import { describe, expect, it } from 'vitest';
import { mailSearchHash } from '../electron/google-urls';

describe('mailSearchHash', () => {
  it('searches for the subject as a phrase', () => {
    expect(mailSearchHash('Factuur maart')).toBe('#search/%22Factuur%20maart%22');
  });

  it('collapses the whitespace a notification body arrives with', () => {
    expect(mailSearchHash('  Factuur   maart \n')).toBe('#search/%22Factuur%20maart%22');
  });

  it('drops the word an ellipsis cut in half', () => {
    // Gmail truncates a long subject, so the last word may be a fragment that matches
    // nothing as part of a phrase.
    expect(mailSearchHash('Herinnering: je factuur van maa…')).toBe(
      '#search/%22Herinnering%3A%20je%20factuur%20van%22',
    );
    expect(mailSearchHash('Herinnering: je factuur van maa...')).toBe(
      '#search/%22Herinnering%3A%20je%20factuur%20van%22',
    );
  });

  it('keeps a quote in the subject from breaking the phrase', () => {
    expect(mailSearchHash('Re: "spoed" graag')).toBe('#search/%22Re%3A%20spoed%20graag%22');
  });

  it('refuses a subject too short to be worth searching for', () => {
    expect(mailSearchHash('')).toBeNull();
    expect(mailSearchHash('   ')).toBeNull();
    expect(mailSearchHash('ok')).toBeNull();
    // Nothing but a cut-off first word is nothing to search for either.
    expect(mailSearchHash('Herinner…')).toBeNull();
  });
});
