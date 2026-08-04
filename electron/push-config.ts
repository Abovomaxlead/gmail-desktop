// Where the relay is and which Pub/Sub topic Gmail publishes to. With either value
// missing, push stays off and the app behaves exactly as before. Environment
// variables win over the file, which lives beside the OAuth data in userData and not
// in this public repo, since the topic name contains the GCP project. A plain ws://
// url is rejected unless it is loopback: the first frame we send carries a live
// Google access token, and unencrypted that may only travel to this machine.
export interface PushConfig {
  relayUrl: string;
  pushTopic: string;
}

const WS_SCHEME = /^wss?:\/\//i;
const PLAIN_SCHEME = /^ws:\/\//i;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

function isLoopback(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return LOOPBACK.has(hostname);
  } catch {
    return false;
  }
}

const pick = (fromEnv: string | undefined, fromFile: unknown): string => {
  const env = (fromEnv ?? '').trim();
  if (env) return env;
  return typeof fromFile === 'string' ? fromFile.trim() : '';
};

export function parsePushConfig(raw: unknown, env: NodeJS.ProcessEnv): PushConfig | null {
  const file = (raw ?? {}) as { relayUrl?: unknown; pushTopic?: unknown };
  const relayUrl = pick(env.GMAIL_PUSH_RELAY_URL, file.relayUrl);
  const pushTopic = pick(env.GMAIL_PUSH_TOPIC, file.pushTopic);
  if (!relayUrl || !pushTopic) return null;
  if (!WS_SCHEME.test(relayUrl)) return null;
  if (PLAIN_SCHEME.test(relayUrl) && !isLoopback(relayUrl)) return null;
  return { relayUrl, pushTopic };
}
