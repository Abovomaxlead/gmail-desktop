// Turning the scan the main process ran into what the picker draws: a line per mailbox that
// already holds the dragged mail, and the count a single label row shows.
//
// The scan answers in label ids; the names live in the lists the picker already fetched. An
// id it cannot name is dropped, since "staat al in Label_7" is not a sentence anybody can
// act on — but the mailbox keeps its warning, because the mail is in there regardless.


//===========================
// Types
//===========================

export interface ExistingLabel {
  labelId: string;
  count: number;
}

export interface ExistingInMailbox {
  email: string;
  labels: ExistingLabel[];
  error?: string;
}

export interface LabelledAccount {
  email: string;
  labels: Array<{ id: string; name: string }>;
}

export interface ExistingNotice {
  email: string;
  labels: string[];
  error?: string;
}

/** One answer from the scan. `serial` names the drag it belongs to and `answered` how many
 * mailboxes have replied, since the scan reports per mailbox and several of these arrive for
 * one drag. A mailbox holding none of the drag adds no entry to `accounts`, so the count is
 * the only thing that says which of two answers knows more. */
export interface ExistingAnswer {
  accounts: ExistingInMailbox[];
  scanned: number;
  serial: number;
  answered: number;
}


//===========================
// Exported functions
//===========================

/**
 * Which of two answers the picker should draw
 *
 * The reply to the picker's own question and the pushes that follow it do not share a queue,
 * so an answer can arrive after one that already knew more.
 *
 * @param current what it is drawing now
 * @param incoming what just arrived
 * @returns the answer of the newest drag, and within one drag the one that has heard from
 *   the most mailboxes, so a warning never disappears again once it has been shown
 */
export function newerExisting(
  current: ExistingAnswer,
  incoming: ExistingAnswer,
): ExistingAnswer {
  if (incoming.serial !== current.serial) {
    return incoming.serial > current.serial ? incoming : current;
  }
  return incoming.answered >= current.answered ? incoming : current;
}

/**
 * The lines the warning banner shows, one per mailbox
 *
 * @param existing what the scan found
 * @param accounts the label lists the picker drew its columns from
 * @returns one notice per mailbox, in the order the scan reported them
 */
export function existingNotices(
  existing: ExistingInMailbox[],
  accounts: LabelledAccount[],
): ExistingNotice[] {
  return existing.map((mailbox) => {
    const known = accounts.find((a) => a.email === mailbox.email)?.labels ?? [];
    const labels = mailbox.labels
      .map((l) => known.find((k) => k.id === l.labelId)?.name)
      .filter((name): name is string => !!name);
    return { email: mailbox.email, labels, ...(mailbox.error ? { error: mailbox.error } : {}) };
  });
}

/**
 * How many of the dragged messages one label of one mailbox already holds
 *
 * @param existing what the scan found
 * @param email
 * @param labelId
 * @returns the count, 0 when this label holds none of it
 */
export function existingCount(
  existing: ExistingInMailbox[],
  email: string,
  labelId: string,
): number {
  const mailbox = existing.find((m) => m.email === email);
  return mailbox?.labels.find((l) => l.labelId === labelId)?.count ?? 0;
}
