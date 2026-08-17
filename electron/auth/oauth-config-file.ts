// Whether a file someone picked in the panel's import button is the OAuth config this app
// needs. Only clientId and clientSecret are checked; the rest of the file passes through
// untouched, because relayUrl and pushTopic live in it and dropping them would leave a
// machine that links accounts and then never notifies about them.

export interface OAuthConfigFileOk {
  ok: true;
  text: string;
}

export interface OAuthConfigFileBad {
  ok: false;
}

export type OAuthConfigFileCheck = OAuthConfigFileOk | OAuthConfigFileBad;

function nonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

function fromGoogleDownload(o: Record<string, unknown>): { clientId: string; clientSecret: string } | null {
  for (const wrapper of ['installed', 'web'] as const) {
    const inner = o[wrapper];
    if (!inner || typeof inner !== 'object') continue;
    const i = inner as Record<string, unknown>;
    if (nonEmptyString(i.client_id) && nonEmptyString(i.client_secret)) {
      return { clientId: String(i.client_id).trim(), clientSecret: String(i.client_secret).trim() };
    }
  }
  return null;
}

/**
 * Reads a picked file as the OAuth config, or does not
 *
 * One verdict rather than a reason code: to whoever picked it, bad JSON and a JSON file
 * lacking the fields are the same answer. Our own shape passes through byte for byte;
 * Google's download is converted, since nothing else here reads `installed.client_id`.
 *
 * @param text the raw file contents
 * @returns ok with the text to write, or a flat refusal
 */
export function checkOAuthConfigFile(text: string): OAuthConfigFileCheck {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false };
  const o = raw as Record<string, unknown>;

  if (nonEmptyString(o.clientId) && nonEmptyString(o.clientSecret)) {
    return { ok: true, text };
  }

  const google = fromGoogleDownload(o);
  if (google) return { ok: true, text: `${JSON.stringify(google, null, 2)}\n` };

  return { ok: false };
}
