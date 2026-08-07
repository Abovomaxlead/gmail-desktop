// The OAuth config shipped inside the app, for a machine that has none of its own.
//
// Why it ships at all: the credentials used to exist only as a file someone copied into
// userData by hand, so a colleague who installed the same build could link nothing, and the
// app said nothing about it. Shipping a default is the normal arrangement for a desktop
// OAuth client — this app uses PKCE with a loopback redirect, the flow Google designed for
// installed apps precisely because a client secret inside a distributed binary cannot be
// kept secret, and where PKCE rather than the secret is what protects the exchange.
//
// Why it is not in git: the repository is public. A client secret committed to a public
// repository is found by credential scanners within a day and the client is withdrawn,
// which breaks linking for everyone at once and cannot be undone by deleting the file —
// git history keeps it, so recovery means a new client and fresh consent from every user.
// So the file is produced at build time and git-ignored: locally by
// `npm run bundle:oauth-config`, and in CI by the release workflow writing it from a
// repository secret. See scripts/bundle-oauth-config.mjs.
//
// A build without it is not an error. The app then behaves exactly as it did before this
// existed — the panel says the machine is not set up and offers the import button — which
// is also what keeps a fork or an outside contributor's build working.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Inside the asar this resolves to <app.asar>/assets/oauth-defaults.json, next to the
 * icon; in development it is the same path in the working tree. `assets/**` is already in
 * electron-builder's file list, so nothing has to be remembered in the packaging config. */
export const BUNDLED_OAUTH_CONFIG_PATH = join(__dirname, '..', 'assets', 'oauth-defaults.json');

/** The shipped config's raw text, or null when this build ships without one. */
export function readBundledOAuthConfig(): string | null {
  try {
    return readFileSync(BUNDLED_OAUTH_CONFIG_PATH, 'utf8');
  } catch {
    return null;
  }
}
