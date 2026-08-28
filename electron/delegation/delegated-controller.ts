// Mailboxes reached by delegation: which ones this person may open, where each one lives,
// and keeping both current.
//
// The two halves come from different places, and neither is allowed to answer for the other.
// Membership comes from Google's delegation administration through the relay, and is folded on
// in both directions by delegated-reconcile.ts. The URL comes from Gmail's account switcher, the
// only place the opaque id in /mail/u/<n>/d/<id>/ exists at all -- no API returns it, it cannot
// be built from the address, and it rotates. That is why the scrape is still here.
//
// Both halves used to be add-only, and that was one bug with two faces. A rotated id was never
// re-read, so the URL kept answering with the signed-in account's own mailbox behind it; and a
// revoked delegation was never dropped, so the sidebar kept a row that could not open. What
// notices the first is delegated-health.ts, off the page title of the view itself; what decides
// the second is the relay, asked as every own account before anything is removed.

import { requestDelegatedMailboxes } from './delegated-mailboxes';
import { SWITCHER_SCRAPE_JS, parseDelegatedEntries } from './delegation';
import { canRunDelegatedApiScan } from './delegated-discovery-gate';
import { deadDelegatedUrls } from './delegated-health';
import { reconcileDelegations, type RequesterAnswer } from './delegated-reconcile';
import { pushProfiles } from '../core/broadcast';
import { notifyLog } from '../notify/notify-log';
import {
  colorForEmail,
  colors,
  delegated,
  hidden,
  keyOf,
  keyOfIndex,
  manager,
  oauthTokens,
  profiles,
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
// Constants
//===========================

// How often the delegated views' titles are read. Reading one is a synchronous
// webContents.getTitle() through ProfileViewManager.titleOf -- no page is touched and Google is
// not asked anything -- so the sampling itself is free; the switcher scrape it can lead to is
// gated on a dead verdict and on the url not having been re-read for that url already.
//
// The first sample lands past WARMUP_CAP_MS (25s in windows/view-warmup.ts), by which time a
// view that was going to load has a title.
const HEALTH_SAMPLE_MS = 30_000;


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
  // The startup scrape answers for a url that rotated while the app was closed, and only when
  // the scrape itself succeeds. The watch answers for the rest: a scrape that came back short,
  // and a rotation halfway through a session that is running now.
  startDelegatedHealthWatch();
}

async function refreshDelegatedUrls(): Promise<void> {
  if (!delegated || !manager) return;
  const entries = await scanSwitcherEntries();
  const withUrl = delegated.list().filter((d) => d.mailUrl !== null).length;

  // A scrape that came back short of what is already held is a scrape that failed, not a
  // switcher that lost mailboxes, and applying it would blank urls that still work. It used to
  // return in silence, which is why a session that started with a rotated id looked exactly
  // like one that started clean -- the health watch below is what still catches that case.
  if (entries.length < withUrl) {
    notifyLog(
      `[delegated] switcher gaf ${entries.length} postvak(ken) terug voor ${withUrl} met een url; genegeerd`,
    );
    return;
  }
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
    // That it changed, never what it changed to: the opaque id is account data, and the log is
    // read by whoever is debugging rather than by the person whose mailbox it is.
    notifyLog(`[delegated] ${d.email}: nieuwe url uit de switcher${d.mailUrl === null ? ' (had er geen)' : ''}`);
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
 * Reads the account switchers until nothing is outstanding any more
 *
 * Asked account by account and stopped the moment nothing is left, because a scrape clicks the
 * avatar in a live mail view and then waits on Google's widget frame. Account 0 first, since a
 * delegation nearly always appears there.
 *
 * @param outstanding which mailboxes still need a url from the switcher; asked again after each
 *   account, so the loop stops as soon as one of them answered for all of them
 * @param why what the log line should call this round
 * @private
 */
async function scrapeSwitchersUntil(outstanding: () => string[], why: string): Promise<void> {
  if (!delegated || !manager) return;
  if (outstanding().length === 0) return;
  for (const own of profiles.filter((p) => p.kind === 'authuser')) {
    applySwitcherUrls(await scanSwitcherEntries(keyOf(own)));
    const left = outstanding();
    if (left.length === 0) {
      notifyLog(`[delegated] ${why}: elk postvak heeft weer een url`);
      return;
    }
    notifyLog(`[delegated] ${why}: nog niet opgelost na ${own.email}: ${left.join(', ')}`);
  }
}

/**
 * Finds the web URL for mailboxes the API discovered
 *
 * Whatever is left without a URL keeps its "open it once in Gmail" row.
 *
 * @private
 */
async function resolveDelegatedUrls(): Promise<void> {
  await scrapeSwitchersUntil(delegatedWithoutUrl, 'nieuw ontdekt');
}

// Which url each mailbox had when the switcher was last re-read for it, so one dead url costs
// one scrape and not one per sample. A url that is replaced and later dies again is a different
// value here, so it earns its own scrape.
const rereadFor = new Map<string, string | null>();

// A scrape waits on Google's widget frame, which takes seconds, and the sampler keeps ticking
// while it does. One at a time: two scrapes in flight would ask the same switchers twice.
let healthCheckInFlight = false;

/**
 * The delegated mail views that are open, with the title each one currently has
 *
 * Only mailboxes that hold a url: one without a url is not broken, it is undiscovered, and it
 * keeps the row that asks the user to open it once in Gmail.
 *
 * @returns one entry per open delegated mail view
 * @private
 */
function delegatedViewTitles(): Array<{ email: string; title: string | null }> {
  const live = manager;
  if (!live || !delegated) return [];
  const withUrl = new Set(
    delegated
      .list()
      .filter((d) => d.mailUrl !== null)
      .map((d) => d.email.toLowerCase()),
  );
  return profiles
    .filter((p) => p.kind === 'delegated' && withUrl.has(p.email.toLowerCase()))
    .filter((p) => live.hasView(keyOf(p), 'mail'))
    .map((p) => ({ email: p.email, title: live.titleOf(keyOf(p), 'mail') }));
}

/**
 * Notices a url that has stopped opening its mailbox, and re-reads the switcher for it
 *
 * The signal is the view's own page title: Gmail titles the mailbox on screen, so a delegated
 * view titled after another address is a view looking at the wrong mail -- which is exactly what
 * a rotated id leaves behind, since the old url keeps answering with the signed-in account's own
 * mailbox. See delegated-health.ts for why nothing else in the title is read.
 *
 * What the scrape then does is unchanged: applySwitcherUrls replaces the url, throws the views
 * away and pushes the profiles, which it already did correctly before any of this.
 */
export async function checkDelegatedUrlHealth(): Promise<void> {
  if (!delegated || !manager || healthCheckInFlight) return;
  const dead = deadDelegatedUrls(delegatedViewTitles());
  if (dead.length === 0) return;

  const held = new Map(delegated.list().map((d) => [d.email.toLowerCase(), d.mailUrl]));
  const worth = dead.filter((email) => {
    const key = email.toLowerCase();
    return held.has(key) && rereadFor.get(key) !== held.get(key);
  });
  if (worth.length === 0) return;

  for (const email of worth) {
    const key = email.toLowerCase();
    rereadFor.set(key, held.get(key) ?? null);
    notifyLog(`[delegated] ${email}: de opgeslagen url opent een ander postvak, switcher wordt opnieuw gelezen`);
  }

  // Outstanding for as long as the url is still the one that was found dead: applySwitcherUrls
  // upserting a different one is what takes a mailbox out of this list.
  const stillDead = (): string[] => {
    const now = new Map(delegated!.list().map((d) => [d.email.toLowerCase(), d.mailUrl]));
    return worth.filter((email) => now.get(email.toLowerCase()) === rereadFor.get(email.toLowerCase()));
  };
  healthCheckInFlight = true;
  try {
    await scrapeSwitchersUntil(stillDead, 'url dood');
  } finally {
    healthCheckInFlight = false;
  }
  // Said as what was seen, not as a diagnosis: the same url coming back also happens when the
  // user simply navigated a delegated view somewhere else, and that mailbox is not broken at all.
  const left = stillDead();
  if (left.length > 0) {
    notifyLog(`[delegated] switcher geeft dezelfde url voor ${left.join(', ')}; niets vervangen`);
  }
}

let healthWatchStarted = false;

/**
 * Starts sampling the delegated views' titles
 *
 * Sampling costs a synchronous getTitle() per open delegated view and touches no page, so it is
 * the cheap half; the switcher is only read when a title says a url is dead. A view opened for
 * the first time an hour into the session is judged on the first sample after it loads, which is
 * why this samples rather than checking once at startup.
 */
export function startDelegatedHealthWatch(): void {
  if (healthWatchStarted) return;
  healthWatchStarted = true;
  setInterval(() => void checkDelegatedUrlHealth(), HEALTH_SAMPLE_MS).unref?.();
}

export async function refreshDelegatedFromApi(opts: { asked?: boolean } = {}): Promise<void> {
  const url = delegatedMailboxesUrl();
  if (!url || !delegated) return;
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return;

  // Every requester, not the first one that answers. The relay answers for the requester it was
  // asked as, so one account's set is not the whole truth -- and a mailbox may only be removed
  // once none of them names it. See delegated-reconcile.ts for what each kind of silence means.
  const requesters = requestersInOrder();
  const answers: RequesterAnswer[] = [];
  for (const requester of requesters) {
    const token = await accessTokenFor(cfg, oauthTokens, requester.email);
    // No entry at all, deliberately: an account that could not be asked has to read as doubt
    // rather than as an answer naming nothing.
    if (!token) continue;
    const res = await requestDelegatedMailboxes({ url, requesterToken: token });
    if (!res.ok) {
      notifyLog(`[delegated] relay weigerde de lijst via ${requester.email}: ${res.error}`);
      answers.push({ ok: false, email: requester.email, error: res.error });
      continue;
    }
    answers.push({ ok: true, email: requester.email, mailboxes: res.mailboxes });
  }

  // Mailboxes the user waved away go in as held, which does both halves of remembering that
  // in one place: nothing held is ever added, so a hidden mailbox is not drawn again; and a
  // held address no answer names comes back as one to remove, so a hidden one whose
  // delegation was revoked at Google leaves the list rather than hiding a mailbox that is
  // not there any more.
  const hiddenHere = hidden?.emailsOfKind('delegated') ?? [];
  const at = reconcileDelegations({
    stored: [...delegated.list().map((d) => d.email), ...hiddenHere],
    answers,
    requesters: requesters.length,
  });

  // An own account the relay happens to name is not a delegated row: detection owns those, and
  // adding one here would draw the same mailbox twice.
  const own = new Set(profiles.filter((p) => p.kind === 'authuser').map((p) => p.email.toLowerCase()));
  const added = at.add.filter((email) => !own.has(email));
  for (const email of added) delegated.upsert({ email, mailUrl: null, calendarUrl: null });
  if (added.length > 0) {
    loadDelegatedProfiles();
    notifyLog(`[delegated] ${added.length} postvak(ken) bijgekomen: ${added.join(', ')}`);
  }

  // A hidden mailbox has no row and no stored entry, so there is nothing to take off the
  // screen: it only stops being hidden. Decided by the same guard that decides a real removal,
  // which refuses on any doubt -- see delegated-reconcile.ts.
  const hiddenSet = new Set(hiddenHere);
  for (const email of at.remove) {
    if (hiddenSet.has(email.toLowerCase())) {
      hidden?.remove(email);
      notifyLog(`[delegated] ${email} is niet meer gedelegeerd; stond verborgen, nu vergeten`);
      continue;
    }
    dropDelegated(email);
  }

  if (added.length === 0 && at.remove.length === 0 && opts.asked) {
    notifyLog(`[delegated] niets veranderd (${at.why})`);
  }
  if (added.length > 0) void resolveDelegatedUrls();
}

/**
 * Takes one mailbox out of the store and off the screen
 *
 * Only ever called for a mailbox every own account's answer agreed was gone -- reconcileDelegations
 * decides that, and refuses to on any doubt. The views go first, the same order registerAccount
 * uses when an own account turns out to hold an address a delegated row already had.
 *
 * @param email as the store spells it
 * @private
 */
function dropDelegated(email: string): void {
  if (!delegated) return;
  delegated.remove(email);
  const at = profiles.findIndex(
    (p) => p.kind === 'delegated' && p.email.toLowerCase() === email.toLowerCase(),
  );
  if (at !== -1) {
    for (const s of SURFACES) manager?.discardView(keyOf(profiles[at]), s);
    profiles.splice(at, 1);
  }
  rereadFor.delete(email.toLowerCase());
  notifyLog(`[delegated] ${email} is niet meer gedelegeerd; rij en views weg`);
  pushProfiles();
  syncCalendarViews();
}

let delegatedApiScanStarted = false;
export function maybeStartDelegatedApiScan(): void {
  const ownAccountCount = profiles.filter((p) => p.kind === 'authuser').length;
  if (!canRunDelegatedApiScan(ownAccountCount, delegatedApiScanStarted)) return;
  delegatedApiScanStarted = true;
  void refreshDelegatedFromApi();
}
