// Where the relay is and which Pub/Sub topic Gmail publishes to; with either missing, push
// stays off. The environment wins over the file, which is out of this public repo because
// the topic name contains the GCP project.
//
// A plain ws:// url is rejected off loopback: the first frame carries a live access token.


//===========================
// Types
//===========================

export interface PushConfig {
  relayUrl: string;
  pushTopic: string;
}


//===========================
// Constants
//===========================

const WS_SCHEME = /^wss?:\/\//i;
const PLAIN_SCHEME = /^ws:\/\//i;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);


//===========================
// Exported functions
//===========================

/**
 * Reads the push configuration, with the environment overriding the file
 *
 * @param raw the parsed config file contents
 * @param env
 * @returns the configuration, or null when push should stay off
 */
export function parsePushConfig(raw: unknown, env: NodeJS.ProcessEnv): PushConfig | null {
  const file = (raw ?? {}) as { relayUrl?: unknown; pushTopic?: unknown };
  const relayUrl = pick(env.GMAIL_PUSH_RELAY_URL, file.relayUrl);
  const pushTopic = pick(env.GMAIL_PUSH_TOPIC, file.pushTopic);
  if (!relayUrl || !pushTopic) return null;
  if (!WS_SCHEME.test(relayUrl)) return null;
  if (PLAIN_SCHEME.test(relayUrl) && !isLoopback(relayUrl)) return null;
  return { relayUrl, pushTopic };
}


//===========================
// Helper functions
//===========================

/**
 * Whether a relay URL points at this machine
 *
 * @param url
 * @returns true for localhost, 127.0.0.1 and ::1
 * @private
 */
function isLoopback(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return LOOPBACK.has(hostname);
  } catch {
    return false;
  }
}

/**
 * Takes the environment value when it has one, the file value otherwise
 *
 * @param fromEnv
 * @param fromFile
 * @returns the winning value, trimmed, or an empty string
 * @private
 */
const pick = (fromEnv: string | undefined, fromFile: unknown): string => {
  const env = (fromEnv ?? '').trim();
  if (env) return env;
  return typeof fromFile === 'string' ? fromFile.trim() : '';
};
