// Whether a file someone picked is the OAuth config this app needs.
//
// The config lives in userData and holds a client secret, so the installer cannot carry it:
// every machine gets it by hand. That was fine while one person set up one machine, and it
// is how a colleague ends up with an app that silently cannot link anything — no consent
// screen when an account is added, no status, no banner, because every one of those paths
// checks the config first and gives up quietly when it is absent.
//
// So the panel offers to import one, and this decides whether what it was handed is really
// it. Two fields are load-bearing — without clientId and clientSecret nothing can be linked
// at all — and they are the only two checked. The rest of the file is passed through
// untouched rather than rebuilt from the fields we recognise: `relayUrl` and `pushTopic`
// live in the same file and are what make push notifications work, and a validator that
// quietly dropped the keys it had no opinion about would hand back a machine that links
// accounts and then never notifies about them. That is a worse bug than the one being
// fixed, because it looks like it worked.

export interface OAuthConfigFileOk {
  ok: true;
  /** The file's own text, to be written through verbatim — see above. */
  text: string;
}

export interface OAuthConfigFileBad {
  ok: false;
}

export type OAuthConfigFileCheck = OAuthConfigFileOk | OAuthConfigFileBad;

function nonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Google's own download for an OAuth client, which nests the credentials under `installed`
 * for a desktop client and `web` for a web one. It is the file a person actually has in
 * their downloads folder after creating a client, so refusing it would mean refusing the
 * obvious thing and demanding a hand-written translation of it. */
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

/** Reads as the OAuth config, or does not. One verdict rather than a reason code: bad JSON
 * and a JSON file that happens to lack the fields are the same thing to whoever picked it —
 * this is not the file — and one sentence is easier to write in three languages than a
 * taxonomy nobody acts on differently.
 *
 * Two shapes are accepted, and they are written out differently on purpose. Our own shape
 * passes through byte for byte, because it may carry `relayUrl` and `pushTopic` and
 * rebuilding it from the fields checked here would silently drop them. Google's download
 * carries nothing but the credentials, so it is converted — and must be, since nothing else
 * in the app reads `installed.client_id`. */
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
