// Which relay URL the app may call, and where it is read from. One module for both
// endpoints, because the rule is about the credential rather than the question: every call
// carries a live Google access token in a header, and that token reaches mail.
//
// https only, the same sentence push already applies to ws:// (`push-config.ts:45`).
// Loopback stays allowed, or the only way to try a local relay is to edit the file that
// holds the client secret.


//===========================
// Exported functions
//===========================

/**
 * Reads a configured relay endpoint
 *
 * @param raw the value out of the OAuth config file or the environment
 * @returns the URL to call, or null when there is none to use
 */
export function parseRelayUrl(raw: unknown): string | null {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol === 'https:') return text;
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  return url.protocol === 'http:' && loopback ? text : null;
}

/**
 * Picks the relay endpoint in force, environment before file
 *
 * An env var that is set but unusable is not quietly replaced by the file: it was set on
 * purpose, and falling back would hide the mistake behind something that looks like it
 * worked.
 *
 * @param fromEnv the environment variable's value, unset or blank when absent
 * @param fromFile the value under this endpoint's key in the OAuth config
 * @returns the URL to call, or null when neither source yields a usable one
 */
export function chooseRelayUrl(fromEnv: string | undefined, fromFile: unknown): string | null {
  const env = (fromEnv ?? '').trim();
  if (env !== '') return parseRelayUrl(env);
  return parseRelayUrl(fromFile);
}
