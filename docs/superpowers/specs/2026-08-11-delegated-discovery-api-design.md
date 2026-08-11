# Discovering delegated mailboxes through the API

Which mailboxes a person may reach, answered by Google instead of by parsing the account
switcher's DOM.

This continues [`2026-08-06-delegated-mailboxes-api-design.md`](2026-08-06-delegated-mailboxes-api-design.md),
whose §11 asked this question and answered "no". That answer was correct at the time and
is not any more: it rested on needing domain-wide delegation, and phase 1 has since landed
it (`electron/delegated-token.ts`, `POST /delegated/token`). What was two missing
capabilities is now one.

## Problem

The list of delegated mailboxes comes from one place: JavaScript injected into the
`ogs.google.com` account-switcher frame, reading anchors whose path matches
`/mail/u/<n>/d/<id>/` (`SWITCHER_SCRAPE_JS`, `electron/delegation.ts:48`). Nothing else
ever adds an entry — `addDelegatedMailbox` (`electron/main.ts:406`) is only called from a
scrape suggestion (`electron/main.ts:2727`).

That has three costs, and only the first is the obvious one.

1. **It parses someone else's DOM.** The code is careful about it — it matches href
   structure, never the translated "Gemachtigd" badge — but a widget rewrite still ends it,
   and `mergeScan` exists precisely to survive the day a scan silently returns less than it
   should (`electron/delegated-store.ts:19`).
2. **It only sees what the switcher renders.** A mailbox whose owner delegated it while the
   app was closed appears when the widget is next scraped, and never if the frame fails to
   load.
3. **It conflates discovery with access.** A mailbox is in the list because a URL for it was
   found. But the API features built since — copying into it, and phases 2 and 3 — need only
   the address; they do not need that URL at all.

## What Google will and will not answer

There is still no reverse lookup. `users.settings.delegates.list` answers "who may reach
mailbox X", never "which mailboxes may I reach", and no other endpoint answers the second
question either.

The way to it is to ask the first question about every mailbox and invert the answers:

```
  for each mailbox in the domain:          ← Admin SDK Directory, users.list
      mint a token with sub = mailbox      ← DWD, already built
      GET users/me/settings/delegates      ← already built, it is the authorization check
  keep the pairs where status is accepted  ← the reverse index
```

Two of those three lines already run in production on every drag onto a delegated mailbox.
Only the enumeration is new.

## Constraints

1. **The sweep is domain-wide, the answer is not.** Building the index reads every mailbox's
   delegate list. What goes back over the wire is one requester's own delegations and
   nothing else. The endpoint must never become a way to ask who else may read what.
2. **Cost is O(domain), so it cannot be per user.** One sweep serves everybody; a sweep per
   app start, per account, would multiply the same reads by the number of people running the
   app.
3. **Off unless configured**, like every optional path in this app (`push-config.ts`,
   `delegatedTokenUrl`). No URL, no discovery, and the switcher scrape carries on alone.
4. **The switcher scrape does not go away.** See "What this does not solve".

## Relay: `GET /delegated/mailboxes`

```
GET /delegated/mailboxes
Authorization: Bearer <a connected account's Google access token>
```

| Status | Meaning |
| --- | --- |
| `200` | `{ "mailboxes": ["bart@…", "support@…"], "refreshedAt": 1754… }` — epoch ms of the sweep the answer came from |
| `401` | Token rejected by tokeninfo, wrong `aud`, or no verified email claim |
| `403` | Requester not in `ALLOWED_EMAILS` |
| `404` | Endpoint not configured on this deployment |
| `502` | Google refused the enumeration |

**Identity.** `verifyToken` with `allowedEmails` and `expectedAud: OAUTH_CLIENT_ID`, exactly
as `/delegated/token` does. The address tokeninfo returns *is* the filter; there is no
mailbox parameter to get wrong.

**The sweep.** `src/delegated-index.ts`:

1. Directory `users.list` over the domain, paging through `nextPageToken`, impersonating
   `DELEGATED_ADMIN_SUBJECT` — a super-administrator, because listing users is an
   administrator's capability and no ordinary mailbox has it. Primary addresses only:
   an alias answers `Delegation denied` when impersonated (§4 of `delegated-api-setup.md`).
2. Per mailbox, a minted token and `users/me/settings/delegates`, at the concurrency the
   copy path already uses. The existing per-mailbox token cache serves this for free.
3. Invert into `Map<requester, mailbox[]>`, keeping only `verificationStatus: 'accepted'` —
   a pending delegate has no access in Gmail either, so offering it here would promise
   something a click cannot deliver.

A mailbox that fails mid-sweep is logged and skipped, and the previous index is kept rather
than replaced by a shorter one. This is `mergeScan`'s rule (`electron/delegated-store.ts:19`)
one layer down, and for the same reason: a partial answer must not read as a removal.

**Caching.** The index is the cache. Rebuilt at most once per `DELEGATED_INDEX_TTL_MS`
(default one hour), on demand, and served stale while a rebuild runs so a request never
waits on the whole domain. A delegation granted in Gmail therefore takes up to an hour to
appear here — acceptable, because the mailbox appears in Gmail's own switcher immediately
and the scrape still picks it up.

**Without the Admin SDK.** If the directory scope is refused, `DELEGATED_CANDIDATES` (a
comma-separated list) replaces step 1 and the rest is unchanged. Delegation still decides
who gets what; the list only bounds where the relay looks. Worth having: it is the whole
feature minus "a mailbox created tomorrow is found automatically", at zero administrator
cost.

## App: a second source, not a replacement

**Config.** `delegatedMailboxesUrl` in `google-oauth.json`, beside `delegatedTokenUrl`,
with `GMAIL_DELEGATED_MAILBOXES_URL` taking precedence, https except on loopback. Not
derived from the token URL by string surgery: a deployment that has one and not the other
is a normal state, and inferring an endpoint that 404s would report a broken relay instead
of an unconfigured one.

**A mailbox with no URL.** This is the design point the rest follows from. `StoredDelegate`
holds `{ email, mailUrl, calendarUrl }` and everything in the sidebar assumes `mailUrl` is
real. The API knows the address and cannot know the URL — so `mailUrl` becomes nullable, and
an entry that has none is a mailbox the app can *use* but not *open*:

| | scraped entry | API entry |
| --- | --- | --- |
| Copy target, drag source, unread count | yes | yes |
| Opens in the mail view | yes | no, until a URL is captured |

The sidebar shows such an entry with an affordance rather than an error — click it once in
Gmail's own account menu and the URL is captured — because "we know you may reach this and
cannot show it to you" is a true statement the interface should be able to make. Silently
omitting it would be worse for the reason `LABELS_GET` already documents
(`electron/main.ts:2875`): a mailbox that is not offered reads as "I cannot find it" rather
than as a missing feature.

**Merging.** The API list flows into the same `mergeScan`. Fields from either source
overwrite the stored ones; neither source ever removes. A mailbox found by both keeps the
scraped URL — the scrape is authoritative about URLs, the API about membership.

**When it runs.** Once at startup beside the existing scrape (`main.ts:383`), and on
demand from the accounts panel. Not per notification, not per drag: the token path already
answers per-mailbox authorization on its own and does not consult this list.

## What this does not solve

§11 named three walls. This spec removes the first and leaves the other two standing:

| Wall | Status |
| --- | --- |
| No reverse lookup | Removed — that is this document |
| The `/d/<id>/` URL cannot be constructed | Stands. No API returns that id; it exists only in Google's UI |
| The id rotates | Stands. The scrape is what keeps stored URLs valid (`main.ts:383-395`) |

So this makes discovery robust and leaves *opening the web view* exactly where it was. The
honest fix for that half is click-through capture, which `isDelegatedMailUrl` is already
written for — and which this spec makes more valuable, because after it the app knows which
mailboxes are missing a URL and can ask for precisely those.

One coverage gap runs the other way. Impersonation only works inside your own Workspace
domain, so a delegation on an `@gmail.com` address or in another organisation is invisible
here and visible in the switcher. The two sources are complementary. Removing the scrape
would lose those mailboxes, which is why constraint 4 says it stays.

## Phases

**Phase A — the endpoint.** `delegated-index.ts`, the route, the candidate-list fallback,
tests against a fake Google. Verifiable before any administrator has done anything.

**Phase B — the app reads it.** Config, the fetch, the merge, `mailUrl` nullable, and the
sidebar treatment of a URL-less entry. After this, a delegated mailbox nobody has ever
clicked in the switcher is a copy target.

**Phase C — click-through capture.** The other half of the URL problem, and the point at
which the scrape becomes a fallback rather than the only source.

## Security

- The Directory scope is domain-wide read of the user list. It is not needed to *reach* any
  mailbox — impersonation already grants that — so it widens what the relay can enumerate,
  not what it can open. Still a new grant, and it belongs in the same rotation and revocation
  story as the key.
- The response is filtered by the requester's verified identity, never by a parameter. There
  is no code path that returns another person's delegations, and any future one is the thing
  to review hardest.
- One log line per sweep (mailboxes read, failures) and one per request (requester, count).
  Never the index itself: it is a map of who can read whose mail.

## Testing

- **Relay** — the inversion, including a mailbox with several delegates and a delegate of
  several mailboxes; `accepted` versus `pending`; a mid-sweep failure keeping the previous
  index; the TTL and stale-while-revalidate behaviour; every status in the table; the
  candidate-list fallback producing the same shape as a directory sweep; and that a
  requester never sees a mailbox they are not an accepted delegate of.
- **App** — config parsing including the https/loopback rule; the merge of an API entry with
  no `mailUrl` onto a scraped one that has one, in both arrival orders; that an entry
  without a URL is offered as a copy target and not as something to open.
- **Live**, once the scope is granted: the returned list must equal what Gmail's own account
  menu shows for that person, minus any out-of-domain mailbox. A shorter list means the
  filter is wrong; a longer one means it is not filtering.

## Out of scope

- Writing delegations (`delegates.create`). Administration stays in Google's console.
- Delegated calendars.
- Removing the switcher scrape.
