// The OAuth config shipped inside the app, for a machine that has none of its own.
//

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BUNDLED_OAUTH_CONFIG_PATH = join(__dirname, '..', 'assets', 'oauth-defaults.json');

/**
 * Reads the config shipped inside the app
 *
 * @returns its raw text, or null when this build ships without one
 */
export function readBundledOAuthConfig(): string | null {
  try {
    return readFileSync(BUNDLED_OAUTH_CONFIG_PATH, 'utf8');
  } catch {
    return null;
  }
}
