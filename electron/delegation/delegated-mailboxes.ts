// Which mailboxes the person may reach, asked of the relay rather than read out of Google's
// account-switcher DOM.
//
// The app cannot work this out itself: the Gmail API answers "who may reach mailbox X" and
// never "which mailboxes may I reach", so the inversion has to happen somewhere that may
// impersonate every mailbox in the domain — which is the relay, and is why the answer is
// taken on trust as far as membership goes. What is not taken on trust is its shape: this
// list becomes rows in the sidebar, and a relay bug should not be able to put an arbitrary
// string there under the name of a mailbox.
//
// Addresses only. The relay knows no URL for these mailboxes and never will — the id in
// `/mail/u/<n>/d/<id>/` exists only in Google's own interface — so what comes back is a
// mailbox you can reach over the API, not necessarily one you can open.



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
  /** An access token for the account doing the asking; the relay filters on its identity. */
  requesterToken: string;
  fetch?: typeof fetch;
}

export type MailboxesOutcome =
  | { ok: true; mailboxes: string[]; refreshedAt: number }
  | { ok: false; status: number; error: string };


//===========================
// Exported functions
//===========================

// Which URL may be called at all is `relay-url.ts`, shared with the token endpoint: the rule
// belongs to the credential every relay call carries, not to the question being asked.

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
