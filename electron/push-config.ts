// Waar de relay staat en naar welk Pub/Sub-topic Gmail moet publiceren. Staat er
// niet allebei iets, dan blijft push uit en werkt de app precies zoals eerst —
// dat is de toestand op elke machine waar deze regels niet in de config staan.
//
// De config zelf staat bij de OAuth-gegevens in userData en niet in de repo: de
// repo is publiek en de topicnaam bevat het GCP-project. Omgevingsvariabelen
// gaan voor, zodat je tegen een lokale relay kunt testen zonder het bestand aan
// te raken.
export interface PushConfig {
  relayUrl: string;
  pushTopic: string;
}

const WS_SCHEME = /^wss?:\/\//i;
const PLAIN_SCHEME = /^ws:\/\//i;

// Over `ws://` gaat het eerste frame dat we sturen — met een levend Google
// access token erin — onversleuteld over de lijn. Dat mag alleen naar deze
// machine zelf; dat is precies wat het lokaal uitproberen uit de spec nodig heeft
// (`ws://localhost:8099`), en alles daarbuiten hoort `wss://` te zijn.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

function isLoopback(url: string): boolean {
  try {
    // URL geeft een IPv6-host terug zonder de blokhaken uit de url.
    return LOOPBACK.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false; // onleesbare url: dan is dit zeker geen bewust lokale test
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
  // Een http-url zou pas bij het verbinden stuk gaan, met een foutmelding die
  // niets over de oorzaak zegt. Hier weigeren is duidelijker.
  if (!WS_SCHEME.test(relayUrl)) return null;
  if (PLAIN_SCHEME.test(relayUrl) && !isLoopback(relayUrl)) return null;
  return { relayUrl, pushTopic };
}
