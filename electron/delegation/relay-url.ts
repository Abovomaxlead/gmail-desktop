// Which relay URL the app may call, and where it is read from. One module for both
// endpoints, because the rule is about the credential and not about the question being asked:
// every call to the relay carries a live Google access token in a header, and that token
// reaches mail.
//
// It lived in delegated-mailboxes.ts and covered the mailboxes endpoint alone. The token
// endpoint — the one whose token carries gmail.insert and gmail.modify — validated nothing at
// all: a plain http host of any name was accepted and the token travelled to it in clear.
// That is the asymmetry this module exists to remove. Push already refused plain ws:// off
// loopback (`push-config.ts:45`); this is the same sentence for https.
//
// Loopback stays allowed on purpose. A relay under test runs on this machine, and refusing it
// would mean the only way to try one is to edit the file that holds the client secret.
//
// Free of Electron and of the filesystem, so both decisions can be tested by passing strings.


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
 * The environment wins for the reason push follows the same order (`push-config.ts:34`): a
 * relay on loopback has to be reachable without editing the one file that holds the client
 * secret, and on a machine whose config lives in userData that file is not even in the repo.
 *
 * An env var that is set but unusable is not quietly replaced by the file. It was set on
 * purpose, and falling back would hide the mistake behind behaviour that looks like it
 * worked — the failure mode the whole config path is written to avoid.
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
