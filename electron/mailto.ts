// Parses a mailto: URL into Gmail compose fields. Query values are stored raw and
// decoded per field, first occurrence wins, and decoding tolerates malformed percent
// sequences so a bad link never throws.

export interface MailtoFields {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function recipients(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => decode(t).trim())
    .filter(Boolean);
}

export function parseMailto(url: string): MailtoFields | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!/^mailto:/i.test(trimmed)) return null;
  const rest = trimmed.slice('mailto:'.length);
  const q = rest.indexOf('?');
  const pathPart = q === -1 ? rest : rest.slice(0, q);
  const queryPart = q === -1 ? '' : rest.slice(q + 1);

  const query: Record<string, string> = {};
  for (const pair of queryPart.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = (eq === -1 ? pair : pair.slice(0, eq)).toLowerCase();
    const val = eq === -1 ? '' : pair.slice(eq + 1);
    if (!(key in query)) query[key] = val;
  }

  return {
    to: [...recipients(pathPart), ...recipients(query.to ?? '')].join(','),
    cc: recipients(query.cc ?? '').join(','),
    bcc: recipients(query.bcc ?? '').join(','),
    subject: decode(query.subject ?? ''),
    body: decode(query.body ?? ''),
  };
}

export function extractMailtoFromArgv(argv: string[]): string | null {
  if (!Array.isArray(argv)) return null;
  return argv.find((a) => typeof a === 'string' && /^mailto:/i.test(a.trim())) ?? null;
}
