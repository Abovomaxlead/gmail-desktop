// Decides whether the account probed at `index` should be registered and whether
// detection should stop. No identity or an already-seen address ends the run:
// authuser indexes are contiguous, so the first gap is the end of the list.

/**
 * Decides what to do with the account just probed
 *
 * @param seenEmails addresses already registered this run
 * @param index the authuser index just probed
 * @param identity what the probed view reported, or null
 * @param maxAccounts hard ceiling on how far detection walks
 * @returns whether to register the account and whether to stop
 */
export function planNext(
  seenEmails: string[],
  index: number,
  identity: { email: string } | null,
  maxAccounts = 10,
): { register: boolean; stop: boolean } {
  if (!identity || !identity.email) return { register: false, stop: true };
  if (seenEmails.includes(identity.email)) return { register: false, stop: true };
  return { register: true, stop: index + 1 >= maxAccounts };
}
