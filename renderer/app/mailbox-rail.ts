// What the rail beside the label list draws, and what the footer says about the mailboxes
// it is not showing.
//
// One column per account fits three mailboxes and falls apart at nine, so the picker shows
// one mailbox at a time. That only works if the rail answers, per mailbox, what the columns
// used to answer by being in sight: how much is ticked there, whether the mail is already
// there, whether it can be read at all, and — while a search is running — whether there is
// anything to find. Everything here is derived, so the rail can never disagree with the
// list beside it: the match count comes out of the same filter the list uses.

import { filterLabels } from './label-search';
import type { ExistingInMailbox } from './existing-labels';


//===========================
// Types
//===========================

export interface RailAccount {
  email: string;
  labels: Array<{ id: string; name: string }>;
  error?: string;
}

export interface MailboxRow {
  email: string;
  pickedCount: number;
  /** How many labels the search leaves standing here; null while nothing is typed. */
  matchCount: number | null;
  hasExisting: boolean;
  error?: string;
}

export interface PickedChip {
  email: string;
  /** The first label ticked in this mailbox, by name. */
  label: string;
  /** How many more are ticked there. */
  extra: number;
}


//===========================
// Exported functions
//===========================

/**
 * One rail row per mailbox, in the order the accounts came in
 *
 * @param accounts the label lists, own and delegated
 * @param picked the labels ticked per mailbox
 * @param existing what the duplicate scan found
 * @param search what is typed in the one search box
 * @returns a row per mailbox, whatever it has to say
 */
export function mailboxRows(
  accounts: RailAccount[],
  picked: Record<string, string[]>,
  existing: ExistingInMailbox[],
  search: string,
): MailboxRow[] {
  const typed = (search ?? '').trim().length > 0;
  return accounts.map((account) => {
    const mine = picked[account.email] ?? [];
    const found = existing.find((m) => m.email === account.email);
    return {
      email: account.email,
      pickedCount: mine.length,
      matchCount: typed ? filterLabels(account.labels, search, mine).length : null,
      hasExisting: (found?.labels.length ?? 0) > 0,
      ...(account.error ? { error: account.error } : {}),
    };
  });
}

/**
 * What the footer shows about every mailbox something is ticked in
 *
 * A total says "3 labels" and leaves out where they are, which is the one thing a rail
 * hides. Naming the first label per mailbox keeps that readable without listing everything.
 *
 * @param picked the labels ticked per mailbox
 * @param accounts the label lists, for the names behind the ids
 * @returns one chip per mailbox with a tick, in mailbox order
 */
export function pickedChips(
  picked: Record<string, string[]>,
  accounts: RailAccount[],
): PickedChip[] {
  const chips: PickedChip[] = [];
  for (const account of accounts) {
    const mine = picked[account.email] ?? [];
    if (mine.length === 0) continue;
    const first = mine[0];
    const name = account.labels.find((l) => l.id === first)?.name ?? first;
    chips.push({ email: account.email, label: name, extra: mine.length - 1 });
  }
  return chips;
}

/**
 * The mailbox the picker opens on
 *
 * @param accounts
 * @returns the first that can be read, else the first there is, else nothing
 */
export function firstPickable(accounts: RailAccount[]): string {
  return (accounts.find((a) => !a.error) ?? accounts[0])?.email ?? '';
}

/**
 * The address without its domain, for where the full one does not fit
 *
 * @param email
 * @returns everything before the last @, or the whole thing when it holds none
 */
export function localPart(email: string): string {
  const at = (email ?? '').lastIndexOf('@');
  return at > 0 ? email.slice(0, at) : (email ?? '');
}
