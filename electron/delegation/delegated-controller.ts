// Mailboxes reached by delegation: which ones this person may open, where each one lives,
// and keeping both current.
//
// The two halves come from different places on purpose. Membership comes from Google's
// delegation administration through the relay, which is an answer rather than a reading of
// someone else's markup. The URL comes from Gmail's account switcher, which is the only
// place the opaque id in /mail/u/<n>/d/<id>/ exists at all -- no API returns it, it cannot be
// built from the address (/mail/b/<address>/ silently opens your own mailbox, which is worse
// than an error), and it rotates, so capturing it once does not hold.
//
// That is why the switcher scrape is still here after discovery moved to the relay. Losing
// it would mean a delegated mailbox you may use over the API and can never look at.

import { requestDelegatedMailboxes } from './delegated-mailboxes';
import { SWITCHER_SCRAPE_JS, parseDelegatedEntries } from './delegation';
import { canRunDelegatedApiScan } from './delegated-discovery-gate';
import { pushProfiles } from '../core/broadcast';
import {
  colorForEmail,
  colors,
  delegated,
  keyOf,
  keyOfIndex,
  manager,
  oauthTokens,
  profiles,
  removed,
} from '../core/runtime';
import { delegatedMailboxesUrl, oauthConfig } from '../auth/oauth-config';
import { requestersInOrder } from '../auth/mailbox-token';
import { accessTokenFor } from '../auth/oauth-flow';
import { syncCalendarViews, warmAccount } from '../windows/view-surfaces';
import { SURFACES, surfacesForRef } from '../../renderer/lib/surfaces';
import type { AccountRef } from '../accounts/account-ref';
import type { StoredDelegate } from './delegated-store';
import type { Profile } from '../windows/profile-view-manager';


//===========================
// Exported functions
//===========================

function delegatedProfileFor(d: StoredDelegate): Profile {
  const ref: AccountRef = {
    kind: 'delegated',
    email: d.email,
    mailUrl: d.mailUrl,
    calendarUrl: d.calendarUrl,
  };
  return {
    ref,
    kind: 'delegated',
    email: d.email,
    name: d.email,
    avatarUrl: '',
    color: colors?.get(d.email) ?? colorForEmail(d.email),
  };
}

export function loadDelegatedProfiles(): void {
  if (!delegated) return;
  const fresh: Profile[] = [];
  for (const d of delegated.list()) {
    const email = d.email.toLowerCase();
    if (removed?.has(email)) continue;
    if (profiles.some((p) => p.email.toLowerCase() === email)) continue;
    const profile = delegatedProfileFor({ ...d, email });
    profiles.push(profile);
    fresh.push(profile);
  }
  if (fresh.length > 0) {
    pushProfiles();
    syncCalendarViews();
    // A mailbox known only by address has nothing to warm — surfacesForRef says so, and
    // SURFACE_CONFIG.mail.url would throw if anything tried.
    for (const profile of fresh) {
      if (surfacesForRef(profile.ref).length > 0) warmAccount(profile);
    }
  }
}

/** One account's switcher. Defaults to the first, which is where a delegation almost always
 * shows up and is the only one the periodic refresh has ever needed to read. */
async function scanSwitcherEntries(
  acctKey: string = keyOfIndex(0),
): Promise<Array<{ email: string; mailUrl: string }>> {
  if (!manager) return [];
  const raw = await manager.scrapeSwitcher(acctKey, SWITCHER_SCRAPE_JS).catch(() => []);
  return parseDelegatedEntries(raw).map((e) => ({ email: e.email, mailUrl: e.mailUrl }));
}

let delegatedScanStarted = false;

/** The one delayed switcher read per session, started once the interface is up. Seven
 * seconds in, because a scrape clicks the avatar in a live mail view and waits on Google's
 * widget frame, and doing that while the app is still settling is visible activity for a
 * question that is usually already answered. */
export function startDelegatedUrlRefreshOnce(): void {
  if (delegatedScanStarted) return;
  delegatedScanStarted = true;
  setTimeout(() => void refreshDelegatedUrls(), 7000);
}
/**
 * Re-reads the switcher to catch a rotated opaque id, so a stored mailbox keeps opening.
 *
 * This is all the switcher is for now. It used to be where delegated mailboxes were
 * *discovered* — the scan proposed addresses and the "+" menu offered them — and that is
 * gone: membership comes from Google's delegation administration through the relay, which is
 * an answer rather than a reading of someone else's markup.
 *
 * What is left cannot be moved to the API, and not for want of trying. The web view needs
 * `/mail/u/<n>/d/<opaque-id>/`; no API returns that id, it cannot be built from the address
 * (`/mail/b/<address>/` silently opens your own mailbox, which is worse than an error), and
 * it rotates, so capturing it once does not hold. Losing this would mean a delegated mailbox
 * you may use over the API and can never look at.
 */
async function refreshDelegatedUrls(): Promise<void> {
  if (!delegated || !manager) return;
  const entries = await scanSwitcherEntries();
  const stored = delegated.list();
  // Only compare against entries the switcher could plausibly still see: an API-discovered
  // mailbox (mailUrl null) inflates `stored` without ever showing up here, since this reads
  // account 0 only while the API is asked with the active account. Counting those against
  // the scrape would make this bail out forever the moment the API adds one, killing the
  // only code that ever writes a real mailUrl onto a stored entry.
  if (entries.length < stored.filter((d) => d.mailUrl !== null).length) return;
  applySwitcherUrls(entries);
}

/** Writes the URLs a scrape found onto the stored mailboxes, and tells the interface.
 *
 * Two jobs in one loop, because they are the same write. A mailbox whose opaque id rotated
 * gets its new URL; a mailbox the API discovered gets its first one, going from a row that
 * only names it to a row that opens. The views are discarded either way — they were loaded
 * from a URL that is no longer the one to use, or from no URL at all. */
function applySwitcherUrls(entries: Array<{ email: string; mailUrl: string }>): void {
  if (!delegated || !manager) return;
  const freshByEmail = new Map(entries.map((e) => [e.email.toLowerCase(), e.mailUrl]));
  let changed = false;
  for (const d of delegated.list()) {
    const fresh = freshByEmail.get(d.email.toLowerCase());
    if (!fresh || fresh === d.mailUrl) continue;
    delegated.upsert({ ...d, mailUrl: fresh });
    const p = profiles.find((x) => x.kind === 'delegated' && x.email.toLowerCase() === d.email.toLowerCase());
    if (p && p.ref.kind === 'delegated') {
      for (const s of SURFACES) manager.discardView(keyOf(p), s);
      p.ref = { ...p.ref, mailUrl: fresh };
      changed = true;
    }
  }
  if (changed) pushProfiles();
}

/** Which stored mailboxes are known by address and cannot be opened yet. */
function delegatedWithoutUrl(): string[] {
  return (delegated?.list() ?? []).filter((d) => d.mailUrl === null).map((d) => d.email);
}

/**
 * Finds the web URL for mailboxes the API discovered, so the answer to "may I reach this" and
 * the answer to "where is it" do not have to come from the same place.
 *
 * That split is the point. Membership comes from Google's delegation administration, through
 * the relay; the URL comes from the switcher, which is the only place the opaque id in
 * `/mail/u/<n>/d/<id>/` exists at all — no API returns it, and it cannot be built from the
 * address. Tested rather than assumed: `/mail/b/<address>/` silently lands on your own
 * mailbox, which is worse than an error, and `/mail/u/<address>/` errors outright.
 *
 * Asked account by account and stopped the moment nothing is left, because a scrape is not
 * free: it clicks the avatar in that account's live mail view and then waits up to eight
 * seconds for Google's widget frame. Doing that for every account on every start would be
 * visible activity in service of a question that is usually already answered. Account 0
 * first, since a delegation nearly always appears there; the others only exist as a path for
 * a mailbox delegated to a second account, which the API can see and account 0's switcher
 * cannot.
 *
 * Whatever is still without a URL afterwards keeps its "open it once in Gmail" row. That is
 * the honest last resort, not the plan.
 */
async function resolveDelegatedUrls(): Promise<void> {
  if (!delegated || !manager) return;
  if (delegatedWithoutUrl().length === 0) return;
  for (const own of profiles.filter((p) => p.kind === 'authuser')) {
    applySwitcherUrls(await scanSwitcherEntries(keyOf(own)));
    const left = delegatedWithoutUrl();
    if (left.length === 0) {
      console.log('[delegated] all discovered mailboxes resolved to a url');
      return;
    }
    console.log(`[delegated] still without a url after ${own.email}: ${left.join(', ')}`);
  }
}

/** The API's half of discovery. Adds mailboxes the switcher never showed and never removes
 * one it does not mention: it cannot see an out-of-domain delegation, so its silence about a
 * mailbox is not evidence about that mailbox.
 *
 * Asked with one of the user's own accounts, active one first, exactly as a token request
 * is. The loop returns on the first requester that gets an answer, so only one person's
 * delegations are ever discovered per call — trying the rest is only for when the active
 * account itself cannot reach the relay. */
export async function refreshDelegatedFromApi(opts: { asked?: boolean } = {}): Promise<void> {
  const url = delegatedMailboxesUrl();
  if (!url || !delegated) return;
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return;

  for (const requester of requestersInOrder()) {
    const token = await accessTokenFor(cfg, oauthTokens, requester.email);
    if (!token) continue;
    const res = await requestDelegatedMailboxes({ url, requesterToken: token });
    if (!res.ok) {
      console.warn(`[delegated] mailbox list via ${requester.email}: ${res.error}`);
      continue;
    }
    const known = new Set(profiles.map((p) => p.email.toLowerCase()));
    // A removal outranks a background scan and loses to an explicit one. Startup must not
    // undo a mailbox you deliberately closed, or it comes back every morning; but asking for
    // a look is the only way back in, and there is no other control that clears the flag —
    // the suggestion list that used to do it is gone along with the DOM discovery it belonged
    // to. Without this fork a removal would be permanent, which nothing in the interface says.
    const fresh = res.mailboxes.filter(
      (email) => !known.has(email) && (opts.asked === true || !removed?.has(email)),
    );
    if (fresh.length === 0) {
      if (opts.asked) console.log('[delegated] nothing to add: no delegations beyond what is here');
      return;
    }
    // Asked for, so the removal goes with it. Done before the upsert: loadDelegatedProfiles
    // consults the removed list too, and would drop the profile straight back out.
    if (opts.asked) for (const email of fresh) removed?.remove(email);
    // Plain upserts, not mergeScan: upsert is where the keep-the-url rule lives (delegated
    // store), so writing an address over a mailbox the switcher already gave a URL to is
    // harmless.
    for (const email of fresh) delegated.upsert({ email, mailUrl: null, calendarUrl: null });
    loadDelegatedProfiles();
    console.log(`[delegated] ${fresh.length} mailbox(es) via ${requester.email}`);
    // The addresses are in; now find where they live. Not awaited: discovery has already
    // done its job and the sidebar already shows the mailboxes — resolving a URL is what
    // turns a row that names one into a row that opens it, and it is allowed to take the
    // seconds a switcher scrape takes.
    void resolveDelegatedUrls();
    return;
  }
}

/** Starts the relay-based discovery scan the first time an own account exists to ask it
 * with. Called from `settleDetection()` rather than `did-finish-load`: detection runs on its
 * own schedule (more accounts, slower machine, a probe timeout) and a fixed delay picked to
 * "usually" outlast it would just move the race, not close it. Settling is the actual signal
 * that `profiles` holds whatever own accounts this process is going to find before the user
 * adds another one by hand. */
let delegatedApiScanStarted = false;
export function maybeStartDelegatedApiScan(): void {
  const ownAccountCount = profiles.filter((p) => p.kind === 'authuser').length;
  if (!canRunDelegatedApiScan(ownAccountCount, delegatedApiScanStarted)) return;
  delegatedApiScanStarted = true;
  void refreshDelegatedFromApi();
}
