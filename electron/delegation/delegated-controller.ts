// Mailboxes reached by delegation: which ones this person may open, where each one lives,
// and keeping both current.
//
// The two halves come from different places. Membership comes from Google's delegation
// administration through the relay; the URL comes from Gmail's account switcher, the only
// place the opaque id in /mail/u/<n>/d/<id>/ exists at all -- no API returns it, it cannot
// be built from the address, and it rotates. That is why the scrape is still here.

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
    for (const profile of fresh) {
      if (surfacesForRef(profile.ref).length > 0) warmAccount(profile);
    }
  }
}

async function scanSwitcherEntries(
  acctKey: string = keyOfIndex(0),
): Promise<Array<{ email: string; mailUrl: string }>> {
  if (!manager) return [];
  const raw = await manager.scrapeSwitcher(acctKey, SWITCHER_SCRAPE_JS).catch(() => []);
  return parseDelegatedEntries(raw).map((e) => ({ email: e.email, mailUrl: e.mailUrl }));
}

let delegatedScanStarted = false;

export function startDelegatedUrlRefreshOnce(): void {
  if (delegatedScanStarted) return;
  delegatedScanStarted = true;
  setTimeout(() => void refreshDelegatedUrls(), 7000);
}

async function refreshDelegatedUrls(): Promise<void> {
  if (!delegated || !manager) return;
  const entries = await scanSwitcherEntries();
  const stored = delegated.list();

  if (entries.length < stored.filter((d) => d.mailUrl !== null).length) return;
  applySwitcherUrls(entries);
}

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

function delegatedWithoutUrl(): string[] {
  return (delegated?.list() ?? []).filter((d) => d.mailUrl === null).map((d) => d.email);
}

/**
 * Finds the web URL for mailboxes the API discovered
 *
 * Asked account by account and stopped the moment nothing is left, because a scrape clicks
 * the avatar in a live mail view and then waits on Google's widget frame. Account 0 first,
 * since a delegation nearly always appears there. Whatever is left without a URL keeps its
 * "open it once in Gmail" row.
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
    const fresh = res.mailboxes.filter(
      (email) => !known.has(email) && (opts.asked === true || !removed?.has(email)),
    );
    if (fresh.length === 0) {
      if (opts.asked) console.log('[delegated] nothing to add: no delegations beyond what is here');
      return;
    }

    if (opts.asked) for (const email of fresh) removed?.remove(email);

    for (const email of fresh) delegated.upsert({ email, mailUrl: null, calendarUrl: null });
    loadDelegatedProfiles();
    console.log(`[delegated] ${fresh.length} mailbox(es) via ${requester.email}`);

    void resolveDelegatedUrls();
    return;
  }
}

let delegatedApiScanStarted = false;
export function maybeStartDelegatedApiScan(): void {
  const ownAccountCount = profiles.filter((p) => p.kind === 'authuser').length;
  if (!canRunDelegatedApiScan(ownAccountCount, delegatedApiScanStarted)) return;
  delegatedApiScanStarted = true;
  void refreshDelegatedFromApi();
}
