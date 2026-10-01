// Mailboxes reached by delegation: which ones this person may open, where each one lives,
// and keeping both current.
//
// The two halves come from different places, and neither is allowed to answer for the other.
// Membership comes from Google's delegation administration through the relay, and is folded on
// in both directions by delegated-reconcile.ts. The URL comes from Gmail's account switcher, the
// only place the opaque id in /mail/u/<n>/d/<id>/ exists at all -- no API returns it, it cannot
// be built from the address, and it rotates per session. That is why the switcher is still read.
// It is read in a window nobody sees (switcher-reader.ts), so adding a mailbox no longer opens
// the account menu in front of the person using the app.
//
// Both halves used to be add-only, and that was one bug with two faces. A rotated id was never
// re-read, so the URL kept answering with the signed-in account's own mailbox behind it; and a
// revoked delegation was never dropped, so the sidebar kept a row that could not open. What
// notices the first is delegated-health.ts, off the page title of the view itself; what decides
// the second is the relay, asked as every own account before anything is removed.
//
// Removal is asked for twice, because the membership lists cannot always answer. A mailbox no
// list named is put to the token endpoint on its own (delegated-access.ts), where a refusal
// names that mailbox and that requester -- so an own account that has no OAuth token to be
// asked with no longer keeps a revoked row on screen for ever.

import { requestDelegatedMailboxes } from './delegated-mailboxes';
import { requestDelegatedToken } from './delegated-token';
import { accessVerdict, type AccessAttempt } from './delegated-access';
import { SWITCHER_SCRAPE_JS, parseDelegatedEntries } from './delegation';
import { canRunDelegatedApiScan } from './delegated-discovery-gate';
import { deadDelegatedUrls, delegatedRepairFor } from './delegated-health';
import { reconcileDelegations, type RequesterAnswer } from './delegated-reconcile';
import { readSwitcher } from '../windows/switcher-reader';
import { pickableMailboxes } from './delegated-candidates';
import { pushHidden, pushProfiles } from '../core/broadcast';
import { startMailSync, stopMailboxSync } from '../push/mail-sync-controller';
import { notifyLog } from '../notify/notify-log';
import {
  colorForEmail,
  colors,
  delegated,
  hidden,
  keyOf,
  manager,
  oauthTokens,
  profiles,
} from '../core/runtime';
import { delegatedMailboxesUrl, delegatedTokenUrl, oauthConfig } from '../auth/oauth-config';
import { requestersInOrder } from '../auth/mailbox-token';
import { accessTokenFor } from '../auth/oauth-flow';
import { syncCalendarViews, warmAccount } from '../windows/view-surfaces';
import { SURFACES, surfacesForRef } from '../../renderer/lib/surfaces';
import type { AccountRef } from '../accounts/account-ref';
import type { StoredDelegate } from './delegated-store';
import type { Profile } from '../windows/profile-view-manager';
import type { OAuthConfig } from '../auth/google-oauth';
import type { OAuthStore } from '../auth/oauth-store';


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

// How often the relay is asked whether the stored mailboxes are still delegated. A revocation
// is administrative -- somebody takes a delegate off a mailbox in the admin console -- so it
// happens in office hours and not in seconds, and an hour is soon enough to matter while
// costing one membership call per own account and nothing else.
//
// This sweep never adds. Discovery is what the "add a delegated mailbox" button does, with a
// list to pick from; a background job that quietly drew in every mailbox the domain had ever
// delegated is exactly what this replaced.
const RELAY_SWEEP_MS = 60 * 60_000;


//===========================
// Exported functions
//===========================

function delegatedProfileFor(d: StoredDelegate): Profile {
  const ref: AccountRef = {
    kind: 'delegated',
    email: d.email,
    mailUrl: d.mailUrl,
    // renderer/lib/surfaces.ts still gates the delegated calendar surface on this field; the
    // store never captures a calendar url, so it is always null here.
    calendarUrl: null,
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
    // Gmail raises nothing in a delegated view, so the API sweep is the only thing that can
    // notify for these mailboxes; a row that appears has to be picked up by it.
    startMailSync();
    for (const profile of fresh) {
      if (surfacesForRef(profile.ref).length > 0) warmAccount(profile);
    }
  }
}

/**
 * The delegated entries one own account's switcher holds
 *
 * @param authuser the account's multi-login index; account 0 unless a caller walks them all
 * @returns the mailboxes with the URL each one opens at
 * @private
 */
async function scanSwitcherEntries(authuser = 0): Promise<Array<{ email: string; mailUrl: string }>> {
  const raw = await readSwitcher(authuser, SWITCHER_SCRAPE_JS).catch(() => []);
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
      `[delegated] switcher returned ${entries.length} mailbox(es) for ${withUrl} that have a url; ignored`,
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
    notifyLog(`[delegated] ${d.email}: new url from the switcher${d.mailUrl === null ? ' (had none)' : ''}`);
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
 * Asked account by account and stopped the moment nothing is left, because every read loads a
 * Gmail page of its own and then waits on Google's widget frame. Account 0 first, since a
 * delegation nearly always appears there.
 *
 * @param outstanding which mailboxes still need a url from the switcher; asked again after each
 *   account, so the loop stops as soon as one of them answered for all of them
 * @param why what the log line should call this round
 * @private
 */
async function scrapeSwitchersUntil(outstanding: () => string[], why: string): Promise<void> {
  if (!delegated) return;
  if (outstanding().length === 0) return;
  for (const own of profiles.filter((p) => p.kind === 'authuser')) {
    if (own.ref.kind !== 'authuser') continue;
    applySwitcherUrls(await scanSwitcherEntries(own.ref.index));
    const left = outstanding();
    if (left.length === 0) {
      notifyLog(`[delegated] ${why}: every mailbox has a url again`);
      return;
    }
    notifyLog(`[delegated] ${why}: still unresolved after ${own.email}: ${left.join(', ')}`);
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
  await scrapeSwitchersUntil(delegatedWithoutUrl, 'newly discovered');
}

// Which url each mailbox had when the switcher was last re-read for it, so one dead url costs
// one scrape and not one per sample. A url that is replaced and later dies again is a different
// value here, so it earns its own scrape.
const rereadFor = new Map<string, string | null>();

// The same gate for the other repair: which url each mailbox was last sent back to. Going home
// is tried once per url, so a title that is still wrong afterwards falls through to the scrape
// instead of sending the view home for ever.
const sentHomeFor = new Map<string, string | null>();

// A scrape waits on Google's widget frame, which takes seconds, and the sampler keeps ticking
// while it does. One at a time: two scrapes in flight would ask the same switchers twice.
let healthCheckInFlight = false;

/**
 * The delegated mail views that are open, with the title and the url each one now has
 *
 * Both, because a title naming the wrong mailbox does not say which of the two faults it is:
 * the url is what says whether the view is still where the app put it. Only mailboxes that
 * hold a url -- one without a url is not broken, it is undiscovered, and it keeps the row
 * that asks the user to open it once in Gmail.
 *
 * @returns one entry per open delegated mail view
 * @private
 */
function delegatedViewStates(): Array<{ email: string; title: string | null; url: string | null }> {
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
    .map((p) => ({
      email: p.email,
      title: live.titleOf(keyOf(p), 'mail'),
      url: live.urlOf(keyOf(p), 'mail'),
    }));
}

/**
 * Notices a delegated view showing the wrong mail, and puts it right
 *
 * The signal is the view's own page title: Gmail titles the mailbox on screen, so a delegated
 * view titled after another address is a view looking at the wrong mail. Two different faults
 * leave that behind, and delegated-health.ts is where they are told apart -- a rotated id, for
 * which only the switcher knows the new url, and a view carried off a url that still works,
 * which is what being signed out does and which costs one navigation to undo.
 *
 * What the scrape then does is unchanged: applySwitcherUrls replaces the url, throws the views
 * away and pushes the profiles, which it already did correctly before any of this.
 *
 * @private
 */
async function checkDelegatedUrlHealth(): Promise<void> {
  if (!delegated || !manager || healthCheckInFlight) return;
  const views = delegatedViewStates();
  const dead = deadDelegatedUrls(views);
  if (dead.length === 0) return;

  // Going home first, because it is the cheap fault and it is free to rule out: only what
  // going home cannot explain is worth a switcher scrape.
  const held = new Map(delegated.list().map((d) => [d.email.toLowerCase(), d.mailUrl]));
  const worth: string[] = [];
  for (const email of dead) {
    const key = email.toLowerCase();
    if (!held.has(key)) continue;
    const mailUrl = held.get(key) ?? null;
    const repair = delegatedRepairFor({
      mailUrl,
      currentUrl: views.find((v) => v.email.toLowerCase() === key)?.url ?? null,
      sentHomeFor: sentHomeFor.get(key) ?? null,
    });
    if (repair === 'send-home' && sendDelegatedViewHome(email)) {
      sentHomeFor.set(key, mailUrl);
      continue;
    }
    if (rereadFor.get(key) !== mailUrl) worth.push(email);
  }
  if (worth.length === 0) return;

  for (const email of worth) {
    const key = email.toLowerCase();
    rereadFor.set(key, held.get(key) ?? null);
    notifyLog(`[delegated] ${email}: the stored url opens another mailbox, re-reading the switcher`);
  }

  // Outstanding for as long as the url is still the one that was found dead: applySwitcherUrls
  // upserting a different one is what takes a mailbox out of this list.
  const stillDead = (): string[] => {
    const now = new Map(delegated!.list().map((d) => [d.email.toLowerCase(), d.mailUrl]));
    return worth.filter((email) => now.get(email.toLowerCase()) === rereadFor.get(email.toLowerCase()));
  };
  healthCheckInFlight = true;
  try {
    await scrapeSwitchersUntil(stillDead, 'url dead');
  } finally {
    healthCheckInFlight = false;
  }
  // Said as what was seen, not as a diagnosis: the same url coming back also happens when the
  // user simply navigated a delegated view somewhere else, and that mailbox is not broken at all.
  const left = stillDead();
  if (left.length > 0) {
    notifyLog(`[delegated] switcher gives the same url for ${left.join(', ')}; nothing replaced`);
  }
}

/**
 * Sends one delegated mail view back to the url it was opened with
 *
 * @param email the mailbox
 * @returns true when the view was actually moved; false when there is no view, or when it
 *   never left after all, in which case the caller falls through to the switcher
 * @private
 */
function sendDelegatedViewHome(email: string): boolean {
  const key = email.toLowerCase();
  const profile = profiles.find((p) => p.kind === 'delegated' && p.email.toLowerCase() === key);
  if (!profile || !manager?.sendHome(keyOf(profile), 'mail')) return false;
  notifyLog(`[delegated] ${email}: the view had left the mailbox, sent back to the stored url`);
  return true;
}

let healthWatchStarted = false;

/**
 * Starts sampling the delegated views' titles
 *
 * Sampling costs a synchronous getTitle() per open delegated view and touches no page, so it is
 * the cheap half; the switcher is only read when a title says a url is dead. A view opened for
 * the first time an hour into the session is judged on the first sample after it loads, which is
 * why this samples rather than checking once at startup.
 *
 * @private
 */
function startDelegatedHealthWatch(): void {
  if (healthWatchStarted) return;
  healthWatchStarted = true;
  setInterval(() => void checkDelegatedUrlHealth(), HEALTH_SAMPLE_MS).unref?.();
}

/**
 * Folds the relay's answer onto the store, and only ever takes away
 *
 * Runs by itself: once detection has settled and every hour after that. Adding is not its
 * business -- a mailbox appears in the sidebar because somebody picked it out of the list the
 * button shows, never because a background sweep found it.
 *
 * @private
 */
async function syncDelegatedFromRelay(): Promise<void> {
  if (!delegated) return;
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return;

  const requesters = requestersInOrder();
  const url = delegatedMailboxesUrl();
  // No membership endpoint is the same as no answer: every stored mailbox comes back
  // unconfirmed for the per-mailbox ask below to settle.
  const answers = url === null ? [] : await askEveryRequester(url, cfg, oauthTokens, requesters);

  // Mailboxes the user waved away are folded in as stored, so a hidden mailbox whose
  // delegation was revoked at Google leaves the hidden list too rather than hiding a mailbox
  // that is not there any more.
  const hiddenHere = hidden?.emailsOfKind('delegated') ?? [];
  const at = reconcileDelegations({
    stored: [...delegated.list().map((d) => d.email), ...hiddenHere],
    answers,
    requesters: requesters.length,
  });

  const hiddenSet = new Set(hiddenHere);
  for (const email of at.remove) forgetDelegated(email, hiddenSet);

  // What the set answers could not settle is asked again mailbox by mailbox. This is what
  // removes anything at all in the setup most people have: one own account without an OAuth
  // token is never asked, which pins every set answer on 'incomplete' for good, while the
  // token endpoint still answers for the mailbox itself. See delegated-access.ts.
  const gone: string[] = [];
  for (const email of at.complete ? [] : at.unconfirmed) {
    if (await mailboxRevoked(email, cfg, oauthTokens, requesters)) gone.push(email);
  }
  for (const email of gone) forgetDelegated(email, hiddenSet);
}

/**
 * Asks the relay which mailboxes could be added, without adding any of them
 *
 * @returns the addresses to offer, and whether anything answered at all -- an empty list
 *   because nobody could be asked is a different thing to say than "there is nothing left to
 *   add", and only the caller has a person to say it to
 */
export async function discoverDelegatedMailboxes(): Promise<{
  candidates: string[];
  answered: boolean;
}> {
  const cfg = oauthConfig();
  const url = delegatedMailboxesUrl();
  if (!cfg || !oauthTokens || url === null) return { candidates: [], answered: false };

  const answers = await askEveryRequester(url, cfg, oauthTokens, requestersInOrder());
  return {
    candidates: pickableMailboxes({
      answers,
      // Hidden mailboxes are offered again on purpose: asking for the list is asking to add
      // something, and a mailbox removed months ago is a fair thing to want back.
      stored: delegated?.list().map((d) => d.email) ?? [],
      own: profiles.filter((p) => p.kind === 'authuser').map((p) => p.email),
    }),
    answered: answers.some((a) => a.ok),
  };
}

/**
 * Puts the mailboxes somebody picked into the sidebar
 *
 * The only way anything is ever added. A picked mailbox stops being hidden as well, or the
 * row would appear and the hidden list would go on claiming it was removed.
 *
 * @param emails as the picker offered them; anything already held or owned is dropped here
 *   rather than trusted
 */
export function addDelegatedMailboxes(emails: string[]): void {
  if (!delegated) return;
  const held = new Set(delegated.list().map((d) => d.email.toLowerCase()));
  const own = new Set(profiles.filter((p) => p.kind === 'authuser').map((p) => p.email.toLowerCase()));
  const fresh = [...new Set(emails.map((e) => e.trim().toLowerCase()))].filter(
    (e) => e !== '' && !held.has(e) && !own.has(e),
  );
  if (fresh.length === 0) return;

  for (const email of fresh) {
    delegated.upsert({ email, mailUrl: null });
    if (hidden?.has(email)) hidden.remove(email);
  }
  pushHidden();
  loadDelegatedProfiles();
  notifyLog(`[delegated] ${fresh.length} mailbox(es) added: ${fresh.join(', ')}`);
  void resolveDelegatedUrls();
}

/**
 * Asks every own account which mailboxes it may reach
 *
 * @param url the relay's membership endpoint
 * @param cfg the OAuth config the requester tokens come from
 * @param tokens the store the requester tokens live in
 * @param requesters every own account, the active one first
 * @returns one answer per account that could be asked, in the order they were asked
 * @private
 */
async function askEveryRequester(
  url: string,
  cfg: OAuthConfig,
  tokens: OAuthStore,
  requesters: Profile[],
): Promise<RequesterAnswer[]> {
  const answers: RequesterAnswer[] = [];
  for (const requester of requesters) {
    const token = await accessTokenFor(cfg, tokens, requester.email);
    // No entry at all, deliberately: an account that could not be asked has to read as doubt
    // rather than as an answer naming nothing.
    if (!token) continue;
    const res = await requestDelegatedMailboxes({ url, requesterToken: token });
    if (!res.ok) {
      notifyLog(`[delegated] relay refused the list via ${requester.email}: ${res.error}`);
      answers.push({ ok: false, email: requester.email, error: res.error });
      continue;
    }
    answers.push({ ok: true, email: requester.email, mailboxes: res.mailboxes });
  }
  return answers;
}

/**
 * Whether the relay says this one mailbox is nobody's to reach any more
 *
 * Asked as every own account that has a token, because the delegation may be held by any of
 * them; the first grant ends it. A token that comes back is thrown away -- this asks a
 * question, and mail-sync mints its own when it has something to fetch.
 *
 * @param email the mailbox, as the store spells it
 * @param cfg the OAuth config the requester tokens come from
 * @param tokens the store the requester tokens live in
 * @param requesters every own account, the active one first
 * @returns true only on a proven revocation, never on doubt
 * @private
 */
async function mailboxRevoked(
  email: string,
  cfg: OAuthConfig,
  tokens: OAuthStore,
  requesters: Profile[],
): Promise<boolean> {
  const url = delegatedTokenUrl();
  if (url === null) return false;
  const attempts: AccessAttempt[] = [];
  for (const requester of requesters) {
    const token = await accessTokenFor(cfg, tokens, requester.email);
    if (!token) continue;
    const res = await requestDelegatedToken({ url, requesterToken: token, target: email });
    attempts.push(res.ok ? { ok: true } : { ok: false, status: res.status });
    if (res.ok) return false;
  }
  const verdict = accessVerdict(attempts);
  if (verdict === 'unknown') {
    notifyLog(`[delegated] ${email}: no verdict on the access; kept`);
  }
  return verdict === 'revoked';
}

/**
 * Takes one mailbox out of wherever it is remembered
 *
 * A hidden mailbox has no row and no stored entry, so there is nothing to take off the screen:
 * it only stops being hidden, or the hidden list keeps hiding a mailbox that is not there.
 *
 * @param email as the store or the hidden list spells it
 * @param hiddenHere the delegated addresses that are hidden rather than shown
 * @private
 */
function forgetDelegated(email: string, hiddenHere: Set<string>): void {
  if (hiddenHere.has(email.toLowerCase())) {
    hidden?.remove(email);
    pushHidden();
    notifyLog(`[delegated] ${email} is no longer delegated; was hidden, now forgotten`);
    return;
  }
  dropDelegated(email);
}

/**
 * Takes one mailbox out of the store and off the screen
 *
 * Only ever called on a verdict: every own account's list agreed the mailbox was gone
 * (reconcileDelegations), or every requester that could be asked was refused a token for it
 * (accessVerdict). Both refuse on doubt. The views go first, the same order registerAccount
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
  stopMailboxSync(email);
  notifyLog(`[delegated] ${email} is no longer delegated; row and views gone`);
  pushProfiles();
  syncCalendarViews();
}

let delegatedApiScanStarted = false;

/**
 * Starts the relay sweep, once there is an own account to ask as
 *
 * Called every time detection settles; the gate lets exactly the first call with an account
 * through. One sweep now, and one an hour from then on -- a delegation revoked while the app
 * is running leaves the sidebar within the hour rather than at the next start.
 */
export function maybeStartDelegatedApiScan(): void {
  const ownAccountCount = profiles.filter((p) => p.kind === 'authuser').length;
  if (!canRunDelegatedApiScan(ownAccountCount, delegatedApiScanStarted)) return;
  delegatedApiScanStarted = true;
  void syncDelegatedFromRelay();
  setInterval(() => void syncDelegatedFromRelay(), RELAY_SWEEP_MS).unref?.();
}
