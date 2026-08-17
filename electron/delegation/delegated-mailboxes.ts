// Which mailboxes the person may reach, asked of the relay rather than read out of Google's
// account-switcher DOM.
//
// The Gmail API answers "who may reach mailbox X" and never the inverse, so the relay is the
// only thing that can. Its membership answer is trusted; its shape is not, since these
// become sidebar rows. Addresses only — the relay knows no URL and never will.



//===========================
// Constants
//===========================

// The same address test the switcher scrape applies.
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;


//===========================
// Types
//===========================

export interface MailboxesDeps {
  url: string;
  requesterToken: string;
  fetch?: typeof fetch;
}

export type MailboxesOutcome =
  | { ok: true; mailboxes: string[]; refreshedAt: number }
  | { ok: false; status: number; error: string };


//===========================
// Exported functions
//===========================


/**
 * Asks the relay which mailboxes the requester may reach
 *
 * @param deps
 * @returns the addresses, or why the relay could not answer
 */
export async function requestDelegatedMailboxes(deps: MailboxesDeps): Promise<MailboxesOutcome> {
  const doFetch = deps.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(deps.url, {
      headers: { authorization: `Bearer ${deps.requesterToken}` },
    });
  } catch (e) {
    return { ok: false, status: 0, error: `Relay niet bereikbaar: ${(e as Error).message}` };
  }

  const json = (await res.json().catch(() => ({}))) as { mailboxes?: unknown; refreshedAt?: unknown; error?: unknown };
  if (!res.ok) {
    const error = typeof json.error === 'string' && json.error !== '' ? json.error : `HTTP ${res.status}`;
    return { ok: false, status: res.status, error };
  }
  const raw = Array.isArray(json.mailboxes) ? json.mailboxes : [];
  const mailboxes = raw
    .filter((m): m is string => typeof m === 'string' && EMAIL_RE.test(m.trim()))
    .map((m) => m.trim().toLowerCase());
  return {
    ok: true,
    mailboxes,
    refreshedAt: typeof json.refreshedAt === 'number' ? json.refreshedAt : 0,
  };
}
