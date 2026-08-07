// The app now ships a default OAuth config so a fresh machine can link at all, while a
// machine set up by hand keeps what it was given. These tests pin the precedence, and in
// particular the fallback: a broken local file must cost you your own project's settings,
// not the ability to use the app — the failure it used to cause was total and silent.

import { describe, expect, it } from 'vitest';
import { chooseOAuthConfigText } from '../electron/oauth-source';

const local = JSON.stringify({ clientId: 'local-id', clientSecret: 'local-secret' });
const bundled = JSON.stringify({ clientId: 'bundled-id', clientSecret: 'bundled-secret' });

describe('chooseOAuthConfigText', () => {
  it('prefers the config the machine was set up with', () => {
    expect(chooseOAuthConfigText(local, bundled)).toBe(local);
  });

  it('uses the shipped one on a machine that has none — the colleague case', () => {
    expect(chooseOAuthConfigText(null, bundled)).toBe(bundled);
  });

  it('still works when only a local config exists, as before this change', () => {
    expect(chooseOAuthConfigText(local, null)).toBe(local);
  });

  it('is null when neither source has one, so callers can still say "not set up"', () => {
    expect(chooseOAuthConfigText(null, null)).toBeNull();
  });

  // The rule that keeps a typo in a hand-copied file from bricking linking entirely.
  it('falls through to the shipped config when the local one is unusable', () => {
    expect(chooseOAuthConfigText('{ broken json', bundled)).toBe(bundled);
    expect(chooseOAuthConfigText('{}', bundled)).toBe(bundled);
    expect(chooseOAuthConfigText(JSON.stringify({ clientId: 'only-half' }), bundled)).toBe(bundled);
  });

  it('reports nothing usable when both are broken, rather than handing on rubbish', () => {
    expect(chooseOAuthConfigText('{ broken', 'also broken')).toBeNull();
  });

  it('does not let a broken shipped config override a good local one', () => {
    expect(chooseOAuthConfigText(local, 'not json at all')).toBe(local);
  });
});
