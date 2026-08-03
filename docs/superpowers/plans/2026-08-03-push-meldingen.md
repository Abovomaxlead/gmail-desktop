# Push-meldingen via de Gmail API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meldingen en de ongelezen-teller komen uit de Gmail API, aangestuurd door Pub/Sub-push via de bestaande `gmail-push-relay`, in plaats van uit de webview.

**Architecture:** Per via OAuth gekoppeld account houdt het main-proces één WSS-verbinding naar de relay open. De relay stuurt `{type:'sync'}` zodra Gmail iets meldt; de app leest dan `users.history.list` vanaf een opgeslagen cursor, meldt de nieuwe INBOX-berichten en verwerkt de ongelezen-teller. Accounts die push niet kan dekken (gedelegeerde postvakken, niet-gekoppeld, push stuk) blijven de webview gebruiken, precies zoals nu.

**Tech Stack:** TypeScript, Electron 31 (Node 20), vitest, `ws`. Gmail API v1: `users.watch`, `users.history.list`, `users.messages.get`, `users.labels.get`, `users.getProfile`, `users.stop`.

**Spec:** `docs/superpowers/specs/2026-08-03-push-meldingen-design.md`

## Global Constraints

- Nederlands in commentaar en gebruikersteksten; Engelse identifiers. Volg de toon van de bestaande bestanden: leg *waarom* uit, niet *wat*.
- Pure logica in een eigen module met tests; `electron` alleen lui geladen (`require('electron')` binnen de functie) zodat de module onder vitest importeerbaar blijft. Zie `electron/gmail-api.ts` voor het patroon.
- `main.ts` is ~1900 regels. Er komt geen nieuwe logica in; alleen koppelcode.
- Tests draaien zonder DOM en zonder Electron. Geen jsdom.
- Vereiste scope voor alles hier: `https://www.googleapis.com/auth/gmail.readonly`. Extra scope die erbij komt: `https://www.googleapis.com/auth/userinfo.email`.
- Gmail laat een `watch` na 7 dagen vervallen; vernieuwen elke 24 uur.
- Relay-close-codes: `4401` = ongeldig token, `4403` = niet in `ALLOWED_EMAILS`, `4400` = kapot frame van ons.
- Terugvalgrens: push die langer dan **2 minuten** weg is geeft de dekking terug aan de webview.
- Hartslag: de relay klopt elke 30s aan; **90s** stilte betekent dode socket.
- Na elke taak: `npx tsc --noEmit` en `npm test` moeten schoon zijn.
- `npm run build` werkt niet zolang de dev-server draait (EPERM op `renderer/.next/trace`). Gebruik `npm run build:main`.

---

## File Structure

**Nieuw**

| Bestand | Verantwoordelijkheid |
|---|---|
| `electron/push-config.ts` | Relay-URL en topicnaam lezen en valideren. |
| `electron/push-coverage.ts` | Wie is door push gedekt, en sinds wanneer. |
| `electron/history-store.ts` | History-cursor per account op schijf. |
| `electron/history-sync.ts` | Pure kern: history-records naar nieuwe bericht-id's; meldingsregel. |
| `electron/push-sync.ts` | Eén sync van begin tot eind, met coalescing. |
| `electron/push-transport.ts` | `ws` achter een interface. De naad naar buiten. |
| `electron/push-manager.ts` | Verbinden, authenticeren, watch, backoff, herverbinden. |

**Aangepast**

| Bestand | Wijziging |
|---|---|
| `electron/gmail-api.ts` | watch/stop/profile/history/metadata/unread erbij. |
| `electron/google-oauth.ts` | `SCOPES` krijgt `userinfo.email`. |
| `electron/oauth-health.ts` | Derde reden om te herverbinden: scope mist. |
| `electron/notification-policy.ts` | `notificationsAllowed` krijgt `pushCovered`. |
| `electron/main.ts` | Koppelcode; `activateNotification` uit de callback getild. |
| `package.json` | `ws` + `@types/ws`. |

---

### Task 1: push-config

De relay-URL en topicnaam komen uit `google-oauth.json` in `userData`, met omgevingsvariabelen die voorgaan zodat je tegen een lokale relay kunt testen.

**Files:**
- Create: `electron/push-config.ts`
- Test: `tests/push-config.test.ts`

**Interfaces:**
- Consumes: niets.
- Produces: `interface PushConfig { relayUrl: string; pushTopic: string }` en `parsePushConfig(raw: unknown, env: NodeJS.ProcessEnv): PushConfig | null`.

- [ ] **Step 1: Write the failing test**

`tests/push-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parsePushConfig } from '../electron/push-config';

const file = { relayUrl: 'wss://push.example.com', pushTopic: 'projects/p/topics/gmail-push' };

describe('parsePushConfig', () => {
  it('reads both values from the config file', () => {
    expect(parsePushConfig(file, {})).toEqual(file);
  });

  it('returns null when either value is missing, so push simply stays off', () => {
    expect(parsePushConfig({ relayUrl: file.relayUrl }, {})).toBeNull();
    expect(parsePushConfig({ pushTopic: file.pushTopic }, {})).toBeNull();
    expect(parsePushConfig(null, {})).toBeNull();
  });

  it('refuses a url that is not a websocket url', () => {
    expect(parsePushConfig({ ...file, relayUrl: 'https://push.example.com' }, {})).toBeNull();
  });

  it('accepts ws:// for a local relay', () => {
    expect(parsePushConfig({ ...file, relayUrl: 'ws://localhost:8099' }, {})?.relayUrl).toBe(
      'ws://localhost:8099',
    );
  });

  it('lets the environment win, so you can test against a local relay', () => {
    const env = {
      GMAIL_PUSH_RELAY_URL: 'ws://localhost:8099',
      GMAIL_PUSH_TOPIC: 'projects/dev/topics/gmail-push',
    };
    expect(parsePushConfig(file, env)).toEqual({
      relayUrl: 'ws://localhost:8099',
      pushTopic: 'projects/dev/topics/gmail-push',
    });
  });

  it('takes one value from the environment and the other from the file', () => {
    expect(parsePushConfig(file, { GMAIL_PUSH_RELAY_URL: 'ws://localhost:8099' })).toEqual({
      relayUrl: 'ws://localhost:8099',
      pushTopic: file.pushTopic,
    });
  });

  it('trims surrounding whitespace instead of building a broken url', () => {
    expect(parsePushConfig(file, { GMAIL_PUSH_RELAY_URL: '  ws://localhost:8099  ' })?.relayUrl).toBe(
      'ws://localhost:8099',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/push-config.test.ts`
Expected: FAIL — `Failed to resolve import "../electron/push-config"`.

- [ ] **Step 3: Write minimal implementation**

`electron/push-config.ts`:

```ts
// Waar de relay staat en naar welk Pub/Sub-topic Gmail moet publiceren. Staat er
// niet allebei iets, dan blijft push uit en werkt de app precies zoals eerst —
// dat is de toestand op elke machine waar deze regels niet in de config staan.
//
// De config zelf staat bij de OAuth-gegevens in userData en niet in de repo: de
// repo is publiek en de topicnaam bevat het GCP-project. Omgevingsvariabelen
// gaan voor, zodat je tegen een lokale relay kunt testen zonder het bestand aan
// te raken.
export interface PushConfig {
  relayUrl: string;
  pushTopic: string;
}

const WS_SCHEME = /^wss?:\/\//i;

const pick = (fromEnv: string | undefined, fromFile: unknown): string => {
  const env = (fromEnv ?? '').trim();
  if (env) return env;
  return typeof fromFile === 'string' ? fromFile.trim() : '';
};

export function parsePushConfig(raw: unknown, env: NodeJS.ProcessEnv): PushConfig | null {
  const file = (raw ?? {}) as { relayUrl?: unknown; pushTopic?: unknown };
  const relayUrl = pick(env.GMAIL_PUSH_RELAY_URL, file.relayUrl);
  const pushTopic = pick(env.GMAIL_PUSH_TOPIC, file.pushTopic);
  if (!relayUrl || !pushTopic) return null;
  // Een http-url zou pas bij het verbinden stuk gaan, met een foutmelding die
  // niets over de oorzaak zegt. Hier weigeren is duidelijker.
  if (!WS_SCHEME.test(relayUrl)) return null;
  return { relayUrl, pushTopic };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/push-config.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/push-config.ts tests/push-config.test.ts
git commit -m "feat: relay-url en pushtopic uit de config lezen"
```

---

### Task 2: Gmail API — watch, history, metadata, teller

Alles wat de sync bij Google ophaalt. Url-bouwers en antwoordlezers apart, want die zijn te testen; het netwerk gaat via de bestaande `requestJson` in datzelfde bestand.

**Files:**
- Modify: `electron/gmail-api.ts` (toevoegen aan het eind, vóór `pickBoundary`)
- Test: `tests/gmail-api.test.ts` (toevoegen aan het eind)

**Interfaces:**
- Consumes: de bestaande private `requestJson(url, accessToken, init?)` en `GmailHttpError` uit `gmail-api.ts`.
- Produces:
  - `WATCH_URL`, `STOP_URL`, `PROFILE_URL`, `HISTORY_URL` (string-constanten)
  - `watchBody(topicName: string): string`
  - `parseWatch(json: unknown): { historyId: string; expiration: number } | null`
  - `parseProfileHistoryId(json: unknown): string | null`
  - `historyListUrl(startHistoryId: string, pageToken?: string): string`
  - `interface HistoryMessage { id: string; labelIds: string[] }`
  - `interface HistoryPage { added: HistoryMessage[]; historyId: string | null; nextPageToken?: string }`
  - `parseHistoryPage(json: unknown): HistoryPage`
  - `messageMetaUrl(messageId: string): string`
  - `interface MessageMeta { id: string; threadId: string; from: string; subject: string; internalDate: number }`
  - `parseMessageMeta(json: unknown): MessageMeta | null`
  - `labelGetUrl(labelId: string): string`
  - `parseUnreadThreads(json: unknown): number | null`
  - netwerk: `watchMailbox(accessToken, topicName)`, `stopWatch(accessToken)`, `fetchProfileHistoryId(accessToken)`, `fetchHistoryPage(accessToken, startHistoryId, pageToken?)`, `fetchMessageMeta(accessToken, messageId)`, `fetchInboxUnread(accessToken)`

- [ ] **Step 1: Write the failing test**

Toevoegen aan `tests/gmail-api.test.ts`. Vul de bestaande import bovenaan het bestand aan met de nieuwe namen:

```ts
// bij de bestaande import uit '../electron/gmail-api':
//   WATCH_URL, STOP_URL, PROFILE_URL, HISTORY_URL,
//   watchBody, parseWatch, parseProfileHistoryId,
//   historyListUrl, parseHistoryPage,
//   messageMetaUrl, parseMessageMeta,
//   labelGetUrl, parseUnreadThreads,
```

En onderaan:

```ts
describe('watch', () => {
  it('asks Gmail to publish inbox changes to our topic', () => {
    const body = JSON.parse(watchBody('projects/p/topics/gmail-push'));
    expect(body).toEqual({
      topicName: 'projects/p/topics/gmail-push',
      labelIds: ['INBOX'],
      labelFilterBehavior: 'include',
    });
  });

  it('posts to the watch endpoint', () => {
    expect(WATCH_URL).toBe('https://gmail.googleapis.com/gmail/v1/users/me/watch');
    expect(STOP_URL).toBe('https://gmail.googleapis.com/gmail/v1/users/me/stop');
  });

  it('reads the starting point and the expiry out of the answer', () => {
    expect(parseWatch({ historyId: '9912', expiration: '1780000000000' })).toEqual({
      historyId: '9912',
      expiration: 1780000000000,
    });
  });

  it('returns null when the answer has no history id to start from', () => {
    expect(parseWatch({ expiration: '1780000000000' })).toBeNull();
    expect(parseWatch(null)).toBeNull();
  });
});

describe('profile', () => {
  it('reads the current history id, used to re-baseline', () => {
    expect(parseProfileHistoryId({ emailAddress: 'a@x.nl', historyId: '4242' })).toBe('4242');
    expect(parseProfileHistoryId({ emailAddress: 'a@x.nl' })).toBeNull();
    expect(PROFILE_URL).toBe('https://gmail.googleapis.com/gmail/v1/users/me/profile');
  });
});

describe('historyListUrl', () => {
  it('asks only for what we act on: messages added to the inbox', () => {
    const url = new URL(historyListUrl('9900'));
    expect(url.origin + url.pathname).toBe(HISTORY_URL);
    expect(url.searchParams.get('startHistoryId')).toBe('9900');
    expect(url.searchParams.get('labelId')).toBe('INBOX');
    expect(url.searchParams.getAll('historyTypes')).toEqual(['messageAdded']);
    expect(url.searchParams.get('maxResults')).toBe('500');
  });

  it('carries the page token', () => {
    expect(new URL(historyListUrl('9900', 'tok')).searchParams.get('pageToken')).toBe('tok');
  });
});

describe('parseHistoryPage', () => {
  it('flattens messagesAdded across records', () => {
    const page = parseHistoryPage({
      history: [
        { id: '1', messagesAdded: [{ message: { id: 'm1', labelIds: ['INBOX', 'UNREAD'] } }] },
        { id: '2', messagesAdded: [{ message: { id: 'm2', labelIds: ['INBOX'] } }] },
      ],
      historyId: '9950',
    });
    expect(page.added).toEqual([
      { id: 'm1', labelIds: ['INBOX', 'UNREAD'] },
      { id: 'm2', labelIds: ['INBOX'] },
    ]);
    expect(page.historyId).toBe('9950');
    expect(page.nextPageToken).toBeUndefined();
  });

  it('carries the next page token', () => {
    expect(parseHistoryPage({ history: [], nextPageToken: 'tok' }).nextPageToken).toBe('tok');
  });

  it('treats a message without labels as having none, rather than crashing', () => {
    const page = parseHistoryPage({ history: [{ messagesAdded: [{ message: { id: 'm1' } }] }] });
    expect(page.added).toEqual([{ id: 'm1', labelIds: [] }]);
  });

  it('survives a quiet answer with nothing in it', () => {
    expect(parseHistoryPage({ historyId: '9950' })).toEqual({ added: [], historyId: '9950' });
    expect(parseHistoryPage(null)).toEqual({ added: [], historyId: null });
  });
});

describe('message metadata', () => {
  it('asks for only the two headers a notification shows', () => {
    const url = new URL(messageMetaUrl('m1'));
    expect(url.pathname).toBe('/gmail/v1/users/me/messages/m1');
    expect(url.searchParams.get('format')).toBe('metadata');
    expect(url.searchParams.getAll('metadataHeaders')).toEqual(['From', 'Subject']);
  });

  it('escapes the id instead of building a broken url', () => {
    expect(messageMetaUrl('a/b')).toContain('/messages/a%2Fb?');
  });

  it('reads sender, subject and arrival time', () => {
    expect(
      parseMessageMeta({
        id: 'm1',
        threadId: 't1',
        internalDate: '1780000000000',
        payload: {
          headers: [
            { name: 'From', value: 'Jan <jan@x.nl>' },
            { name: 'Subject', value: 'Offerte' },
          ],
        },
      }),
    ).toEqual({
      id: 'm1',
      threadId: 't1',
      from: 'Jan <jan@x.nl>',
      subject: 'Offerte',
      internalDate: 1780000000000,
    });
  });

  it('matches header names case-insensitively, the way rfc822 allows', () => {
    const meta = parseMessageMeta({
      id: 'm1',
      threadId: 't1',
      internalDate: '1',
      payload: { headers: [{ name: 'from', value: 'a@x.nl' }, { name: 'SUBJECT', value: 'Hoi' }] },
    });
    expect(meta?.from).toBe('a@x.nl');
    expect(meta?.subject).toBe('Hoi');
  });

  it('falls back to an empty subject rather than dropping the message', () => {
    const meta = parseMessageMeta({
      id: 'm1',
      threadId: 't1',
      internalDate: '1',
      payload: { headers: [{ name: 'From', value: 'a@x.nl' }] },
    });
    expect(meta?.subject).toBe('');
  });

  it('returns null without an id or an arrival time, the two we cannot do without', () => {
    expect(parseMessageMeta({ threadId: 't1', internalDate: '1' })).toBeNull();
    expect(parseMessageMeta({ id: 'm1', threadId: 't1' })).toBeNull();
    expect(parseMessageMeta(null)).toBeNull();
  });
});

describe('inbox unread', () => {
  it('asks the inbox label for its counts', () => {
    expect(labelGetUrl('INBOX')).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX',
    );
  });

  // Threads, niet messages: de titel van de webview telt ook gesprekken, dus zo
  // verspringt het getal niet op het moment dat de dekking wisselt.
  it('reads the unread thread count', () => {
    expect(parseUnreadThreads({ id: 'INBOX', threadsUnread: 7, messagesUnread: 12 })).toBe(7);
  });

  it('reads a zero as zero and not as missing', () => {
    expect(parseUnreadThreads({ threadsUnread: 0 })).toBe(0);
  });

  it('returns null when the field is absent, so the caller leaves the count alone', () => {
    expect(parseUnreadThreads({ id: 'INBOX' })).toBeNull();
    expect(parseUnreadThreads(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/gmail-api.test.ts`
Expected: FAIL — de nieuwe namen bestaan niet.

- [ ] **Step 3: Write minimal implementation**

Toevoegen aan `electron/gmail-api.ts`, direct ná `messageExistsInLabel` en vóór `pickBoundary`:

```ts
// --- Push: watch, history, metadata, teller -------------------------------
//
// Gmail meldt zelf wanneer er iets verandert, via Pub/Sub. De melding bevat geen
// mail: alleen een historyId. Wat er veranderd is komt daarna uit history.list.

export const WATCH_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/watch';
export const STOP_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/stop';
export const PROFILE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';
export const HISTORY_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/history';

const LABELS_BASE = LABELS_URL;

// Alleen INBOX: wat daarbuiten gebeurt hoeft geen melding en geen teller. Staat
// het ooit toch nodig te zijn (zie het openstaande punt in de spec over gelezen
// markeren), dan is dit de enige plek die verandert.
export function watchBody(topicName: string): string {
  return JSON.stringify({
    topicName,
    labelIds: ['INBOX'],
    labelFilterBehavior: 'include',
  });
}

const numberFrom = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const stringFrom = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function parseWatch(json: unknown): { historyId: string; expiration: number } | null {
  const raw = json as { historyId?: unknown; expiration?: unknown };
  const historyId = stringFrom(raw?.historyId);
  if (!historyId) return null;
  return { historyId, expiration: numberFrom(raw?.expiration) ?? 0 };
}

export function parseProfileHistoryId(json: unknown): string | null {
  return stringFrom((json as { historyId?: unknown })?.historyId);
}

export function historyListUrl(startHistoryId: string, pageToken?: string): string {
  const q = new URLSearchParams({
    startHistoryId,
    labelId: 'INBOX',
    maxResults: '500',
  });
  // Alleen toegevoegde berichten: label-verschuivingen zijn voor de teller, en
  // die halen we los op bij het INBOX-label zelf.
  q.append('historyTypes', 'messageAdded');
  if (pageToken) q.set('pageToken', pageToken);
  return `${HISTORY_URL}?${q.toString()}`;
}

export interface HistoryMessage {
  id: string;
  labelIds: string[];
}

export interface HistoryPage {
  added: HistoryMessage[];
  historyId: string | null;
  nextPageToken?: string;
}

export function parseHistoryPage(json: unknown): HistoryPage {
  const raw = json as { history?: unknown; historyId?: unknown; nextPageToken?: unknown };
  const added: HistoryMessage[] = [];
  if (Array.isArray(raw?.history)) {
    for (const record of raw.history) {
      const list = (record as { messagesAdded?: unknown })?.messagesAdded;
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        const message = (entry as { message?: { id?: unknown; labelIds?: unknown } })?.message;
        const id = stringFrom(message?.id);
        if (!id) continue;
        const labelIds = Array.isArray(message?.labelIds)
          ? message!.labelIds.filter((l): l is string => typeof l === 'string')
          : [];
        added.push({ id, labelIds });
      }
    }
  }
  const page: HistoryPage = { added, historyId: stringFrom(raw?.historyId) };
  const next = stringFrom(raw?.nextPageToken);
  if (next) page.nextPageToken = next;
  return page;
}

export const MESSAGE_META_HEADERS = ['From', 'Subject'];

export function messageMetaUrl(messageId: string): string {
  const q = new URLSearchParams({ format: 'metadata' });
  for (const h of MESSAGE_META_HEADERS) q.append('metadataHeaders', h);
  return `${MESSAGES_URL}/${encodeURIComponent(messageId)}?${q.toString()}`;
}

export interface MessageMeta {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  internalDate: number; // epoch ms; bepaalt of dit bericht nog meldingswaardig is
}

export function parseMessageMeta(json: unknown): MessageMeta | null {
  const raw = json as {
    id?: unknown;
    threadId?: unknown;
    internalDate?: unknown;
    payload?: { headers?: unknown };
  };
  const id = stringFrom(raw?.id);
  const internalDate = numberFrom(raw?.internalDate);
  // Zonder id valt er niets te openen en zonder aankomsttijd kunnen we niet
  // beslissen of het een melding waard is. De rest mag ontbreken.
  if (!id || internalDate === null) return null;
  const headers = Array.isArray(raw?.payload?.headers) ? raw!.payload!.headers : [];
  const header = (name: string): string => {
    for (const h of headers as Array<{ name?: unknown; value?: unknown }>) {
      if (typeof h?.name === 'string' && h.name.toLowerCase() === name) {
        return stringFrom(h.value) ?? '';
      }
    }
    return '';
  };
  return {
    id,
    threadId: stringFrom(raw?.threadId) ?? '',
    from: header('from'),
    subject: header('subject'),
    internalDate,
  };
}

export function labelGetUrl(labelId: string): string {
  return `${LABELS_BASE}/${encodeURIComponent(labelId)}`;
}

// threadsUnread en niet messagesUnread: de paginatitel van de webview telt ook
// gesprekken, dus zo verspringt het getal niet zodra de dekking van bron wisselt.
export function parseUnreadThreads(json: unknown): number | null {
  return numberFrom((json as { threadsUnread?: unknown })?.threadsUnread);
}

export async function watchMailbox(
  accessToken: string,
  topicName: string,
): Promise<{ historyId: string; expiration: number } | null> {
  return parseWatch(
    await requestJson(WATCH_URL, accessToken, {
      method: 'POST',
      contentType: 'application/json',
      body: Buffer.from(watchBody(topicName), 'utf8'),
    }),
  );
}

// Netjes afmelden als een account weggaat, anders blijft Gmail nog tot een week
// naar het topic publiceren voor een client die er niet meer is.
export async function stopWatch(accessToken: string): Promise<void> {
  await requestJson(STOP_URL, accessToken, {
    method: 'POST',
    contentType: 'application/json',
    body: Buffer.from('{}', 'utf8'),
  });
}

export async function fetchProfileHistoryId(accessToken: string): Promise<string | null> {
  return parseProfileHistoryId(await requestJson(PROFILE_URL, accessToken));
}

export async function fetchHistoryPage(
  accessToken: string,
  startHistoryId: string,
  pageToken?: string,
): Promise<HistoryPage> {
  return parseHistoryPage(await requestJson(historyListUrl(startHistoryId, pageToken), accessToken));
}

export async function fetchMessageMeta(
  accessToken: string,
  messageId: string,
): Promise<MessageMeta | null> {
  return parseMessageMeta(await requestJson(messageMetaUrl(messageId), accessToken));
}

export async function fetchInboxUnread(accessToken: string): Promise<number | null> {
  return parseUnreadThreads(await requestJson(labelGetUrl('INBOX'), accessToken));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/gmail-api.test.ts`
Expected: PASS. Daarna `npx tsc --noEmit` — schoon.

- [ ] **Step 5: Commit**

```bash
git add electron/gmail-api.ts tests/gmail-api.test.ts
git commit -m "feat: gmail api voor watch, history, metadata en de ongelezen-teller"
```

---

### Task 3: history-store

De cursor per account, op schijf, zodat een herstart niet opnieuw hoeft te ijken.

**Files:**
- Create: `electron/history-store.ts`
- Test: `tests/history-store.test.ts`

**Interfaces:**
- Consumes: niets.
- Produces: `class HistoryStore { constructor(filePath: string); get(email: string): string | undefined; set(email: string, historyId: string): void; remove(email: string): void }`

- [ ] **Step 1: Write the failing test**

`tests/history-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HistoryStore } from '../electron/history-store';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gmd-history-'));
  file = join(dir, 'nested', 'gmail-history.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('HistoryStore', () => {
  it('remembers a cursor across instances', () => {
    new HistoryStore(file).set('a@x.nl', '9900');
    expect(new HistoryStore(file).get('a@x.nl')).toBe('9900');
  });

  it('creates the folder it needs', () => {
    new HistoryStore(file).set('a@x.nl', '1');
    expect(new HistoryStore(file).get('a@x.nl')).toBe('1');
  });

  it('keeps accounts apart and is case-insensitive on the address', () => {
    const store = new HistoryStore(file);
    store.set('A@x.nl', '1');
    store.set('b@x.nl', '2');
    expect(store.get('a@X.nl')).toBe('1');
    expect(store.get('b@x.nl')).toBe('2');
  });

  it('overwrites rather than appending', () => {
    const store = new HistoryStore(file);
    store.set('a@x.nl', '1');
    store.set('a@x.nl', '2');
    expect(store.get('a@x.nl')).toBe('2');
  });

  it('forgets an account, so a removed one re-baselines if it comes back', () => {
    const store = new HistoryStore(file);
    store.set('a@x.nl', '1');
    store.remove('a@x.nl');
    expect(store.get('a@x.nl')).toBeUndefined();
  });

  it('reports nothing for an unknown account', () => {
    expect(new HistoryStore(file).get('nobody@x.nl')).toBeUndefined();
  });

  // Een halfgeschreven bestand mag de app niet ophouden: opnieuw ijken kost één
  // verzoek, vastlopen kost alle meldingen.
  it('treats an unreadable file as empty', () => {
    const broken = join(dir, 'broken.json');
    writeFileSync(broken, '{ this is not json', 'utf8');
    expect(new HistoryStore(broken).get('a@x.nl')).toBeUndefined();
  });

  it('ignores a value that is not a history id', () => {
    const odd = join(dir, 'odd.json');
    writeFileSync(odd, JSON.stringify({ 'a@x.nl': { nope: 1 } }), 'utf8');
    expect(new HistoryStore(odd).get('a@x.nl')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/history-store.test.ts`
Expected: FAIL — module bestaat niet.

- [ ] **Step 3: Write minimal implementation**

`electron/history-store.ts`:

```ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Per account het laatste historyId dat we van Gmail zagen. Dat is de cursor voor
// history.list: alles ná dit punt is wat we nog niet verwerkt hebben.
//
// Apart van de tokens (google-tokens.json), want dit is geen geheim maar
// voortgang: je kunt dit bestand weggooien zonder je koppeling kwijt te raken.
// De app ijkt dan bij de eerstvolgende sync opnieuw en meldt niets.
export class HistoryStore {
  constructor(private readonly filePath: string) {}

  private all(): Record<string, string> {
    if (!existsSync(this.filePath)) return {};
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
      return raw as Record<string, string>;
    } catch {
      // Halfgeschreven of met de hand verpest: opnieuw ijken kost één verzoek,
      // hier blijven hangen kost alle meldingen.
      return {};
    }
  }

  private write(map: Record<string, string>): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(map, null, 2), 'utf8');
  }

  get(email: string): string | undefined {
    const value = this.all()[email.toLowerCase()];
    return typeof value === 'string' && value ? value : undefined;
  }

  set(email: string, historyId: string): void {
    const map = this.all();
    map[email.toLowerCase()] = historyId;
    this.write(map);
  }

  remove(email: string): void {
    const map = this.all();
    delete map[email.toLowerCase()];
    this.write(map);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/history-store.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/history-store.ts tests/history-store.test.ts
git commit -m "feat: history-cursor per account bewaren"
```

---

### Task 4: history-sync — de pure kern

Van history-records naar de bericht-id's die een melding verdienen, plus de regel die bepaalt of een bericht nog meldingswaardig is.

**Files:**
- Create: `electron/history-sync.ts`
- Test: `tests/history-sync.test.ts`

**Interfaces:**
- Consumes: `HistoryMessage` uit `electron/gmail-api.ts` (Task 2).
- Produces: `SKIP_LABELS: string[]`, `notifiableIds(added: HistoryMessage[]): string[]`, `shouldNotify(internalDate: number, coveredSince: number | null): boolean`

- [ ] **Step 1: Write the failing test**

`tests/history-sync.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { notifiableIds, shouldNotify, SKIP_LABELS } from '../electron/history-sync';

const msg = (id: string, ...labelIds: string[]) => ({ id, labelIds });

describe('notifiableIds', () => {
  it('keeps a plain new inbox message', () => {
    expect(notifiableIds([msg('m1', 'INBOX', 'UNREAD')])).toEqual(['m1']);
  });

  it('skips a message that is not in the inbox', () => {
    // history.list filtert al op INBOX, maar een record kan meer berichten
    // bevatten dan het label waarop gefilterd is.
    expect(notifiableIds([msg('m1', 'SENT')])).toEqual([]);
  });

  it('skips promotions and social, so newsletters stay quiet', () => {
    expect(notifiableIds([msg('m1', 'INBOX', 'CATEGORY_PROMOTIONS')])).toEqual([]);
    expect(notifiableIds([msg('m2', 'INBOX', 'CATEGORY_SOCIAL')])).toEqual([]);
  });

  it('keeps the other categories', () => {
    expect(notifiableIds([msg('m1', 'INBOX', 'CATEGORY_PERSONAL')])).toEqual(['m1']);
    expect(notifiableIds([msg('m2', 'INBOX', 'CATEGORY_UPDATES')])).toEqual(['m2']);
  });

  it('deduplicates: one message can appear in several history records', () => {
    expect(notifiableIds([msg('m1', 'INBOX'), msg('m1', 'INBOX')])).toEqual(['m1']);
  });

  it('keeps the order Gmail gave, so notifications arrive oldest first', () => {
    expect(notifiableIds([msg('m1', 'INBOX'), msg('m2', 'INBOX')])).toEqual(['m1', 'm2']);
  });

  it('returns nothing for an empty page', () => {
    expect(notifiableIds([])).toEqual([]);
  });

  it('names the labels it skips, so the reason is readable', () => {
    expect(SKIP_LABELS).toEqual(['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL']);
  });
});

describe('shouldNotify', () => {
  const covered = 1_000_000;

  it('notifies for mail that arrived while push covered the account', () => {
    expect(shouldNotify(covered + 1, covered)).toBe(true);
  });

  it('stays quiet for mail that was already there when coverage began', () => {
    // Anders krijg je bij elke start een melding voor alles wat je al zag.
    expect(shouldNotify(covered - 1, covered)).toBe(false);
  });

  it('counts mail that arrived exactly at the moment coverage began', () => {
    expect(shouldNotify(covered, covered)).toBe(true);
  });

  it('stays quiet when the account is not covered at all', () => {
    // Zonder dekking meldt de webview; een tweede melding van ons zou dubbel zijn.
    expect(shouldNotify(covered + 1, null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/history-sync.test.ts`
Expected: FAIL — module bestaat niet.

- [ ] **Step 3: Write minimal implementation**

`electron/history-sync.ts`:

```ts
import type { HistoryMessage } from './gmail-api';

// Gmail's tabbladen. Een nieuwsbrief onder Reclame of een melding van een sociaal
// netwerk is geen mail waarvoor je je werk onderbreekt. De andere categorieën
// (PERSONAL, UPDATES, FORUMS) melden wel: daar zit echte post tussen.
export const SKIP_LABELS = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL'];

// Welke van de toegevoegde berichten een melding verdienen. Ontdubbeld, want
// hetzelfde bericht kan in meerdere history-records opduiken, en in de volgorde
// die Gmail geeft, zodat de meldingen op tijd van aankomst binnenkomen.
export function notifiableIds(added: HistoryMessage[]): string[] {
  const out: string[] = [];
  for (const message of added) {
    if (!message.labelIds.includes('INBOX')) continue;
    if (message.labelIds.some((l) => SKIP_LABELS.includes(l))) continue;
    if (!out.includes(message.id)) out.push(message.id);
  }
  return out;
}

// De hele meldingsregel van het ontwerp, op één plek:
//
//   Meld alleen mail die binnenkwam terwijl dit account door push gedekt was.
//
// Dat dekt drie gevallen met één vergelijking. Bij het opstarten begint de
// dekking pas als de eerste watch lukt, dus de achterstand zwijgt. Na een korte
// breuk is de mail nieuwer dan dat moment en meldt hij gewoon — precies waar de
// catch-up voor is. En na een teruggave en overname schuift het moment mee, dus
// het storingsvenster zwijgt: de webview heeft die mail toen al gemeld.
export function shouldNotify(internalDate: number, coveredSince: number | null): boolean {
  if (coveredSince === null) return false;
  return internalDate >= coveredSince;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/history-sync.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/history-sync.ts tests/history-sync.test.ts
git commit -m "feat: bepalen welke nieuwe mail een melding verdient"
```

---

### Task 5: push-coverage

Wie is door push gedekt, en sinds wanneer. Drie plekken vragen dit: de meldingsgate, de eigenaar van de teller, en de meldingsregel.

**Files:**
- Create: `electron/push-coverage.ts`
- Test: `tests/push-coverage.test.ts`

**Interfaces:**
- Consumes: niets.
- Produces: `class PushCoverage { constructor(now?: () => number); cover(email: string): boolean; drop(email: string): boolean; has(email: string): boolean; since(email: string): number | null; forget(email: string): void }`

`cover` en `drop` geven `true` terug als de dekking daadwerkelijk veranderde, zodat de aanroeper alleen dan werk doet (de meldingsvlaggen opnieuw versturen).

- [ ] **Step 1: Write the failing test**

`tests/push-coverage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PushCoverage } from '../electron/push-coverage';

// Vaste klok: de tests gaan over welk moment onthouden wordt, niet over tijd.
const at = (t: { now: number }) => new PushCoverage(() => t.now);

describe('PushCoverage', () => {
  it('starts with nothing covered', () => {
    const c = new PushCoverage(() => 100);
    expect(c.has('a@x.nl')).toBe(false);
    expect(c.since('a@x.nl')).toBeNull();
  });

  it('remembers when coverage began', () => {
    const t = { now: 500 };
    const c = at(t);
    c.cover('a@x.nl');
    expect(c.has('a@x.nl')).toBe(true);
    expect(c.since('a@x.nl')).toBe(500);
  });

  it('reports whether the coverage actually changed', () => {
    const c = new PushCoverage(() => 500);
    expect(c.cover('a@x.nl')).toBe(true);
    expect(c.cover('a@x.nl')).toBe(false); // al gedekt: niets te doen
    expect(c.drop('a@x.nl')).toBe(true);
    expect(c.drop('a@x.nl')).toBe(false);
  });

  it('keeps the original moment while coverage holds', () => {
    // Anders zou een tweede geslaagde watch het venster verschuiven en zou mail
    // die er tussenin kwam alsnog stil blijven.
    const t = { now: 500 };
    const c = at(t);
    c.cover('a@x.nl');
    t.now = 900;
    c.cover('a@x.nl');
    expect(c.since('a@x.nl')).toBe(500);
  });

  it('moves the moment forward after coverage was lost and taken back', () => {
    // Tijdens de storing meldde de webview; die mail mag de catch-up niet
    // nog een keer melden.
    const t = { now: 500 };
    const c = at(t);
    c.cover('a@x.nl');
    c.drop('a@x.nl');
    t.now = 900;
    c.cover('a@x.nl');
    expect(c.since('a@x.nl')).toBe(900);
  });

  it('keeps accounts apart and is case-insensitive on the address', () => {
    const c = new PushCoverage(() => 500);
    c.cover('A@x.nl');
    expect(c.has('a@X.nl')).toBe(true);
    expect(c.has('b@x.nl')).toBe(false);
  });

  it('forgets a removed account entirely', () => {
    const c = new PushCoverage(() => 500);
    c.cover('a@x.nl');
    c.forget('a@x.nl');
    expect(c.has('a@x.nl')).toBe(false);
    expect(c.since('a@x.nl')).toBeNull();
  });

  it('has no memory of a dropped account, so it cannot notify for the gap', () => {
    const c = new PushCoverage(() => 500);
    c.cover('a@x.nl');
    c.drop('a@x.nl');
    expect(c.since('a@x.nl')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/push-coverage.test.ts`
Expected: FAIL — module bestaat niet.

- [ ] **Step 3: Write minimal implementation**

`electron/push-coverage.ts`:

```ts
// Welke accounts door push gedekt worden, en vanaf welk moment. Drie dingen
// hangen hieraan:
//
//   1. Of Gmail's eigen meldingen in die webview gedempt worden.
//   2. Wie de ongelezen-teller mag zetten — de API of de paginatitel.
//   3. Of een binnengekomen bericht nog een melding waard is (zie shouldNotify).
//
// Het moment is het punt: dat is wat voorkomt dat de catch-up na een storing mail
// nog eens meldt die de webview toen al gemeld heeft.
export class PushCoverage {
  private since_ = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  private key(email: string): string {
    return email.toLowerCase();
  }

  // True als er echt iets veranderde. Een tweede geslaagde watch laat het moment
  // staan: zou het meeschuiven, dan viel mail die er tussenin kwam buiten het
  // venster en zou die stil blijven.
  cover(email: string): boolean {
    const key = this.key(email);
    if (this.since_.has(key)) return false;
    this.since_.set(key, this.now());
    return true;
  }

  drop(email: string): boolean {
    return this.since_.delete(this.key(email));
  }

  has(email: string): boolean {
    return this.since_.has(this.key(email));
  }

  since(email: string): number | null {
    return this.since_.get(this.key(email)) ?? null;
  }

  forget(email: string): void {
    this.since_.delete(this.key(email));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/push-coverage.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/push-coverage.ts tests/push-coverage.test.ts
git commit -m "feat: bijhouden welke accounts door push gedekt worden"
```

---

### Task 6: push-sync — één sync van begin tot eind

De orkestratie: cursor lezen, pagina's doorlopen, 404 opvangen, meldingen samenstellen, teller ophalen. Met een geïnjecteerde client, dus zonder Electron te testen.

**Files:**
- Create: `electron/push-sync.ts`
- Test: `tests/push-sync.test.ts`

**Interfaces:**
- Consumes: `HistoryPage` en `MessageMeta` uit `electron/gmail-api.ts` (Task 2); `notifiableIds` en `shouldNotify` uit `electron/history-sync.ts` (Task 4).
- Produces:
  - `interface SyncClient { profileHistoryId(): Promise<string | null>; historyPage(startHistoryId: string, pageToken?: string): Promise<HistoryPage>; messageMeta(id: string): Promise<MessageMeta | null>; inboxUnread(): Promise<number | null> }`
  - `interface SyncCursor { get(): string | undefined; set(historyId: string): void }`
  - `interface SyncOutcome { notify: MessageMeta[]; unread: number | null; rebaselined: boolean }`
  - `interface SyncDeps { client: SyncClient; cursor: SyncCursor; coveredSince: () => number | null; isExpiredCursor: (e: unknown) => boolean; onOutcome: (o: SyncOutcome) => void; onError?: (e: unknown) => void }`
  - `createSyncRunner(deps: SyncDeps): { run(): Promise<void> }`

- [ ] **Step 1: Write the failing test**

`tests/push-sync.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createSyncRunner, type SyncClient, type SyncOutcome } from '../electron/push-sync';
import type { HistoryPage, MessageMeta } from '../electron/gmail-api';

const meta = (id: string, internalDate: number): MessageMeta => ({
  id,
  threadId: `t-${id}`,
  from: 'Jan <jan@x.nl>',
  subject: `Onderwerp ${id}`,
  internalDate,
});

interface FakeOptions {
  pages?: Record<string, HistoryPage>;
  profileHistoryId?: string | null;
  metas?: Record<string, MessageMeta | null>;
  unread?: number | null;
  historyThrows?: unknown;
  metaThrows?: Set<string>;
}

function fake(options: FakeOptions = {}) {
  const calls = { history: [] as string[], profile: 0, meta: [] as string[], unread: 0 };
  const client: SyncClient = {
    async profileHistoryId() {
      calls.profile += 1;
      return options.profileHistoryId ?? '5000';
    },
    async historyPage(start, pageToken) {
      calls.history.push(pageToken ? `${start}:${pageToken}` : start);
      if (options.historyThrows) throw options.historyThrows;
      return options.pages?.[pageToken ?? start] ?? { added: [], historyId: start };
    },
    async messageMeta(id) {
      calls.meta.push(id);
      if (options.metaThrows?.has(id)) throw new Error('metadata weg');
      return options.metas?.[id] ?? meta(id, 2000);
    },
    async inboxUnread() {
      calls.unread += 1;
      return options.unread ?? 3;
    },
  };
  return { client, calls };
}

function runner(options: FakeOptions & { stored?: string; coveredSince?: number | null } = {}) {
  const { client, calls } = fake(options);
  let stored = options.stored;
  const outcomes: SyncOutcome[] = [];
  const errors: unknown[] = [];
  const r = createSyncRunner({
    client,
    cursor: { get: () => stored, set: (v) => (stored = v) },
    coveredSince: () => (options.coveredSince === undefined ? 1000 : options.coveredSince),
    isExpiredCursor: (e) => (e as { status?: number })?.status === 404,
    onOutcome: (o) => outcomes.push(o),
    onError: (e) => errors.push(e),
  });
  return { r, calls, outcomes, errors, cursor: () => stored };
}

describe('createSyncRunner — first run', () => {
  it('baselines on the profile history id and notifies nothing', async () => {
    const t = runner({ profileHistoryId: '5000' });
    await t.r.run();
    expect(t.cursor()).toBe('5000');
    expect(t.outcomes[0].notify).toEqual([]);
    expect(t.outcomes[0].rebaselined).toBe(true);
    expect(t.calls.history).toEqual([]); // niets om te vergelijken
  });

  it('still reports the unread count on a baseline', async () => {
    const t = runner({ profileHistoryId: '5000', unread: 9 });
    await t.r.run();
    expect(t.outcomes[0].unread).toBe(9);
  });

  it('leaves the cursor unset when the profile has no history id', async () => {
    const t = runner({ profileHistoryId: null });
    await t.r.run();
    expect(t.cursor()).toBeUndefined();
  });
});

describe('createSyncRunner — delta', () => {
  it('notifies for new inbox mail and advances the cursor', async () => {
    const t = runner({
      stored: '4900',
      pages: {
        '4900': { added: [{ id: 'm1', labelIds: ['INBOX', 'UNREAD'] }], historyId: '5000' },
      },
      metas: { m1: meta('m1', 2000) },
    });
    await t.r.run();
    expect(t.outcomes[0].notify.map((m) => m.id)).toEqual(['m1']);
    expect(t.cursor()).toBe('5000');
  });

  it('walks every page before advancing the cursor', async () => {
    const t = runner({
      stored: '4900',
      pages: {
        '4900': {
          added: [{ id: 'm1', labelIds: ['INBOX'] }],
          historyId: '4950',
          nextPageToken: 'p2',
        },
        p2: { added: [{ id: 'm2', labelIds: ['INBOX'] }], historyId: '5000' },
      },
    });
    await t.r.run();
    expect(t.calls.history).toEqual(['4900', '4900:p2']);
    expect(t.outcomes[0].notify.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(t.cursor()).toBe('5000');
  });

  it('skips promotions without fetching their metadata', async () => {
    const t = runner({
      stored: '4900',
      pages: {
        '4900': {
          added: [{ id: 'm1', labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'] }],
          historyId: '5000',
        },
      },
    });
    await t.r.run();
    expect(t.calls.meta).toEqual([]);
    expect(t.outcomes[0].notify).toEqual([]);
  });

  it('stays quiet for mail older than the moment coverage began', async () => {
    const t = runner({
      stored: '4900',
      coveredSince: 5000,
      pages: { '4900': { added: [{ id: 'm1', labelIds: ['INBOX'] }], historyId: '5000' } },
      metas: { m1: meta('m1', 1000) },
    });
    await t.r.run();
    expect(t.outcomes[0].notify).toEqual([]);
    // De teller moet wél kloppen: het bericht bestaat, het meldt alleen niet.
    expect(t.outcomes[0].unread).toBe(3);
  });

  it('keeps the count right when one message metadata fetch fails', async () => {
    const t = runner({
      stored: '4900',
      pages: {
        '4900': {
          added: [{ id: 'm1', labelIds: ['INBOX'] }, { id: 'm2', labelIds: ['INBOX'] }],
          historyId: '5000',
        },
      },
      metaThrows: new Set(['m1']),
    });
    await t.r.run();
    expect(t.outcomes[0].notify.map((m) => m.id)).toEqual(['m2']);
    expect(t.outcomes[0].unread).toBe(3);
    expect(t.cursor()).toBe('5000');
  });
});

describe('createSyncRunner — recovery', () => {
  it('re-baselines when the cursor is too old', async () => {
    const t = runner({
      stored: '1',
      historyThrows: { status: 404 },
      profileHistoryId: '5000',
    });
    await t.r.run();
    expect(t.cursor()).toBe('5000');
    expect(t.outcomes[0].rebaselined).toBe(true);
    expect(t.outcomes[0].notify).toEqual([]);
  });

  // De enige invariant waarvan het breken mail geruisloos laat verdwijnen.
  it('does not advance the cursor when a page fails', async () => {
    const t = runner({ stored: '4900', historyThrows: { status: 500 } });
    await t.r.run();
    expect(t.cursor()).toBe('4900');
    expect(t.outcomes).toEqual([]);
    expect(t.errors).toHaveLength(1);
  });

  it('does not advance the cursor when a later page fails', async () => {
    let call = 0;
    const outcomes: SyncOutcome[] = [];
    let stored: string | undefined = '4900';
    const r = createSyncRunner({
      client: {
        profileHistoryId: async () => '5000',
        historyPage: async (start) => {
          call += 1;
          if (call === 1) return { added: [], historyId: '4950', nextPageToken: 'p2' };
          throw { status: 500 };
        },
        messageMeta: async (id) => meta(id, 2000),
        inboxUnread: async () => 3,
      },
      cursor: { get: () => stored, set: (v) => (stored = v) },
      coveredSince: () => 1000,
      isExpiredCursor: (e) => (e as { status?: number })?.status === 404,
      onOutcome: (o) => outcomes.push(o),
    });
    await r.run();
    expect(stored).toBe('4900');
    expect(outcomes).toEqual([]);
  });
});

describe('createSyncRunner — coalescing', () => {
  it('runs once more instead of running twice at the same time', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const seen: string[] = [];
    let stored: string | undefined = '4900';
    let first = true;
    const r = createSyncRunner({
      client: {
        profileHistoryId: async () => '5000',
        historyPage: async (start) => {
          seen.push(start);
          if (first) {
            first = false;
            await gate;
          }
          return { added: [], historyId: '5000' };
        },
        messageMeta: async (id) => meta(id, 2000),
        inboxUnread: async () => 3,
      },
      cursor: { get: () => stored, set: (v) => (stored = v) },
      coveredSince: () => 1000,
      isExpiredCursor: () => false,
      onOutcome: () => {},
    });
    const a = r.run();
    const b = r.run(); // komt binnen terwijl de eerste nog loopt
    const c = r.run(); // en nog een: samen levert dat één extra doorloop op
    expect(seen).toEqual(['4900']); // de tweede is nog niet begonnen
    release();
    await Promise.all([a, b, c]);
    expect(seen).toEqual(['4900', '5000']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/push-sync.test.ts`
Expected: FAIL — module bestaat niet.

- [ ] **Step 3: Write minimal implementation**

`electron/push-sync.ts`:

```ts
import type { HistoryPage, MessageMeta } from './gmail-api';
import { notifiableIds, shouldNotify } from './history-sync';

// Eén sync: van "er is iets veranderd" naar "dit moet gemeld worden en de teller
// staat op dit getal". Alles wat het netwerk raakt komt binnen als dependency,
// zodat dit bestand zonder Electron te testen is.

export interface SyncClient {
  profileHistoryId(): Promise<string | null>;
  historyPage(startHistoryId: string, pageToken?: string): Promise<HistoryPage>;
  messageMeta(id: string): Promise<MessageMeta | null>;
  inboxUnread(): Promise<number | null>;
}

export interface SyncCursor {
  get(): string | undefined;
  set(historyId: string): void;
}

export interface SyncOutcome {
  notify: MessageMeta[];
  unread: number | null;
  // Gezet als de cursor opnieuw geijkt is in plaats van doorgelopen. Dan is er
  // per definitie niets te melden: we weten niet wat we gemist hebben.
  rebaselined: boolean;
}

export interface SyncDeps {
  client: SyncClient;
  cursor: SyncCursor;
  coveredSince: () => number | null;
  // Of deze fout betekent dat de cursor te oud is. Gmail antwoordt dan met 404.
  // Als parameter, want het herkennen van een GmailHttpError hoort bij de
  // aanroeper en niet in deze module.
  isExpiredCursor: (e: unknown) => boolean;
  onOutcome: (outcome: SyncOutcome) => void;
  onError?: (e: unknown) => void;
}

export function createSyncRunner(deps: SyncDeps): { run(): Promise<void> } {
  let running: Promise<void> | null = null;
  let again = false;

  // De teller mag nooit een sync laten mislukken: het getal is bijzaak
  // vergeleken met de melding.
  const unread = async (): Promise<number | null> => {
    try {
      return await deps.client.inboxUnread();
    } catch {
      return null;
    }
  };

  // Opnieuw ijken: we weten wél waar we nu staan, maar niet wat we gemist
  // hebben. Dus cursor zetten en niets melden.
  const baseline = async (): Promise<void> => {
    const historyId = await deps.client.profileHistoryId();
    if (historyId) deps.cursor.set(historyId);
    deps.onOutcome({ notify: [], unread: await unread(), rebaselined: true });
  };

  const once = async (): Promise<void> => {
    const start = deps.cursor.get();
    if (!start) return baseline();

    // Alle pagina's eerst binnenhalen. De cursor gaat pas ná de laatste pagina
    // vooruit: zou hij halverwege opschuiven en dan een pagina mislukken, dan is
    // die mail voorgoed weg — geen melding, en niets dat het merkt.
    const added: HistoryPage['added'] = [];
    let latest = start;
    let pageToken: string | undefined;
    try {
      do {
        const page = await deps.client.historyPage(start, pageToken);
        added.push(...page.added);
        if (page.historyId) latest = page.historyId;
        pageToken = page.nextPageToken;
      } while (pageToken);
    } catch (e) {
      if (deps.isExpiredCursor(e)) return baseline();
      // Netwerk weg, quotum vol, Google hikt: deze sync overslaan. De cursor
      // staat nog waar hij stond, dus de volgende haalt hetzelfde opnieuw op.
      deps.onError?.(e);
      return;
    }

    const since = deps.coveredSince();
    const notify: MessageMeta[] = [];
    for (const id of notifiableIds(added)) {
      let meta: MessageMeta | null;
      try {
        meta = await deps.client.messageMeta(id);
      } catch (e) {
        // Eén onleesbaar bericht: geen melding, want er is niets om te tonen.
        // De teller hieronder blijft wel kloppen.
        deps.onError?.(e);
        continue;
      }
      if (meta && shouldNotify(meta.internalDate, since)) notify.push(meta);
    }

    deps.cursor.set(latest);
    deps.onOutcome({ notify, unread: await unread(), rebaselined: false });
  };

  // Komt er een sync binnen terwijl er één loopt, dan wordt die niet parallel
  // gestart maar onthouden: twee doorlopen op dezelfde cursor melden alles
  // dubbel. Meerdere die tegelijk aankloppen leveren samen één extra doorloop op.
  const pump = async (): Promise<void> => {
    do {
      again = false;
      await once();
    } while (again);
    running = null;
  };

  return {
    run(): Promise<void> {
      if (running) {
        again = true;
        return running;
      }
      running = pump();
      return running;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/push-sync.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/push-sync.ts tests/push-sync.test.ts
git commit -m "feat: een sync van cursor tot meldingen en teller"
```

---

### Task 7: push-transport en de ws-afhankelijkheid

De naad naar `ws`. Deze krijgt geen test: hij bestaat juist zodat de manager erboven wél te testen is.

**Files:**
- Create: `electron/push-transport.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: niets.
- Produces:
  - `interface PushSocket { send(data: string): void; close(): void; onOpen(cb: () => void): void; onMessage(cb: (data: string) => void): void; onClose(cb: (code: number) => void): void; onError(cb: (e: unknown) => void): void }`
  - `interface PushTransport { connect(url: string): PushSocket }`
  - `wsTransport: PushTransport`

- [ ] **Step 1: Install the dependency**

Run:

```bash
npm install --save ws && npm install --save-dev @types/ws
```

Electron 31 draait op Node 20 en heeft geen bruikbare globale `WebSocket`; `ws` is de standaardkeuze en heeft zelf geen afhankelijkheden.

- [ ] **Step 2: Write the implementation**

`electron/push-transport.ts`:

```ts
import WebSocket from 'ws';

// De enige plek die `ws` kent. De manager erboven praat alleen met deze
// interface, en krijgt in tests een nep-transport — daarom staat hier niets meer
// dan het doorgeven van gebeurtenissen, en daarom heeft dit bestand geen test.
export interface PushSocket {
  send(data: string): void;
  close(): void;
  onOpen(cb: () => void): void;
  onMessage(cb: (data: string) => void): void;
  // De sluitcode is het verschil tussen "probeer opnieuw" en "dit gaat nooit
  // lukken": de relay gebruikt 4401/4403/4400 om te zeggen wat er mis was.
  onClose(cb: (code: number) => void): void;
  onError(cb: (e: unknown) => void): void;
}

export interface PushTransport {
  connect(url: string): PushSocket;
}

export const wsTransport: PushTransport = {
  connect(url) {
    const ws = new WebSocket(url);
    return {
      send: (data) => ws.send(data),
      close: () => ws.close(),
      onOpen: (cb) => ws.on('open', cb),
      onMessage: (cb) => ws.on('message', (d: WebSocket.RawData) => cb(d.toString())),
      onClose: (cb) => ws.on('close', (code: number) => cb(code)),
      onError: (cb) => ws.on('error', cb),
    };
  },
};
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: schoon. Daarna `npm run build:main` — moet doorlopen (esbuild bundelt `ws` mee).

- [ ] **Step 4: Commit**

```bash
git add electron/push-transport.ts package.json package-lock.json
git commit -m "feat: ws achter een interface voor de push-verbinding"
```

---

### Task 8: push-manager

De toestandsmachine per account. Overgezet uit `gmail-native` (`src/main/push/manager.ts`), met drie toevoegingen: dekkingsmeldingen, het herkennen van definitieve sluitcodes, en een hartslagtimer.

**Files:**
- Create: `electron/push-manager.ts`
- Test: `tests/push-manager.test.ts`

**Interfaces:**
- Consumes: `PushSocket`, `PushTransport`, `wsTransport` uit `electron/push-transport.ts` (Task 7); `PushConfig` uit `electron/push-config.ts` (Task 1).
- Produces:
  - `FATAL_CLOSE_CODES: number[]`
  - `interface Timer { clear(): void }`
  - `interface PushManagerDeps { config: PushConfig; accounts(): string[]; accessToken(email: string): Promise<string | null>; armWatch(email: string): Promise<boolean>; onSync(email: string): void; onCoverage(email: string, covered: boolean): void; onFatal?(email: string, code: number): void; transport?: PushTransport; backoffMs?(attempt: number): number; setTimer?(fn: () => void, ms: number): Timer; renewMs?: number; staleMs?: number; graceMs?: number }`
  - `startPushManager(deps: PushManagerDeps): { stop(): void; refresh(): void }`

`armWatch` geeft `true` als de watch lukte. `refresh()` past de verbindingen aan op een gewijzigde accountlijst.

- [ ] **Step 1: Write the failing test**

`tests/push-manager.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { startPushManager, FATAL_CLOSE_CODES, type PushSocket } from '../electron/push-manager';

// Nep-socket: we sturen de gebeurtenissen zelf, zodat de test over de
// toestandsmachine gaat en niet over ws.
class FakeSocket implements PushSocket {
  sent: string[] = [];
  closed = false;
  private open?: () => void;
  private message?: (d: string) => void;
  private close_?: (code: number) => void;
  private error?: (e: unknown) => void;

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  onOpen(cb: () => void): void {
    this.open = cb;
  }
  onMessage(cb: (d: string) => void): void {
    this.message = cb;
  }
  onClose(cb: (code: number) => void): void {
    this.close_ = cb;
  }
  onError(cb: (e: unknown) => void): void {
    this.error = cb;
  }

  fireOpen(): void {
    this.open?.();
  }
  fireMessage(d: string): void {
    this.message?.(d);
  }
  fireClose(code = 1006): void {
    this.close_?.(code);
  }
  fireError(e: unknown): void {
    this.error?.(e);
  }
}

// Nep-klok: we onthouden de geplande callbacks en vuren ze met de hand.
function fakeTimers() {
  const pending: Array<{ ms: number; fn: () => void; cleared: boolean }> = [];
  const setTimer = (fn: () => void, ms: number) => {
    const entry = { ms, fn, cleared: false };
    pending.push(entry);
    return { clear: () => (entry.cleared = true) };
  };
  // Vuurt de eerste nog niet afgezegde timer met deze wachttijd.
  const fire = (ms: number): boolean => {
    const entry = pending.find((p) => p.ms === ms && !p.cleared);
    if (!entry) return false;
    entry.cleared = true;
    entry.fn();
    return true;
  };
  const live = () => pending.filter((p) => !p.cleared).map((p) => p.ms);
  return { setTimer, fire, live };
}

function harness(over: Partial<Parameters<typeof startPushManager>[0]> = {}) {
  const sockets: FakeSocket[] = [];
  const timers = fakeTimers();
  const events: string[] = [];
  let watchOk = true;
  const manager = startPushManager({
    config: { relayUrl: 'ws://localhost:8099', pushTopic: 'projects/p/topics/gmail-push' },
    accounts: () => ['a@x.nl'],
    accessToken: async () => 'token-1',
    armWatch: async (email) => {
      events.push(`watch:${email}`);
      return watchOk;
    },
    onSync: (email) => events.push(`sync:${email}`),
    onCoverage: (email, covered) => events.push(`cover:${email}:${covered}`),
    onFatal: (email, code) => events.push(`fatal:${email}:${code}`),
    transport: {
      connect: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    },
    setTimer: timers.setTimer,
    ...over,
  });
  return { manager, sockets, timers, events, setWatchOk: (v: boolean) => (watchOk = v) };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('startPushManager', () => {
  it('authenticates, arms the watch, then catches up', async () => {
    const h = harness();
    h.sockets[0].fireOpen();
    await settle();
    expect(JSON.parse(h.sockets[0].sent[0])).toEqual({ type: 'auth', accessToken: 'token-1' });
    // Volgorde telt: pas als de watch staat is het account gedekt, en pas dan
    // mag de catch-up melden.
    expect(h.events).toEqual(['watch:a@x.nl', 'cover:a@x.nl:true', 'sync:a@x.nl']);
    h.manager.stop();
  });

  it('syncs on every sync frame', async () => {
    const h = harness();
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireMessage(JSON.stringify({ type: 'sync', historyId: '5000' }));
    expect(h.events.filter((e) => e === 'sync:a@x.nl')).toHaveLength(2);
    h.manager.stop();
  });

  it('ignores a frame it does not understand instead of throwing', async () => {
    const h = harness();
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireMessage('dit is geen json');
    h.sockets[0].fireMessage(JSON.stringify({ type: 'ready' }));
    expect(h.events.filter((e) => e === 'sync:a@x.nl')).toHaveLength(1);
    h.manager.stop();
  });

  it('does not cover the account when the watch fails', async () => {
    const h = harness();
    h.setWatchOk(false);
    h.sockets[0].fireOpen();
    await settle();
    expect(h.events).toEqual(['watch:a@x.nl']);
    expect(h.events).not.toContain('cover:a@x.nl:true');
    h.manager.stop();
  });

  it('does not send an auth frame without a token', async () => {
    const h = harness({ accessToken: async () => null });
    h.sockets[0].fireOpen();
    await settle();
    expect(h.sockets[0].sent).toEqual([]);
    expect(h.events).toEqual([]);
    h.manager.stop();
  });

  it('reconnects with a growing wait after an unexpected close', async () => {
    const h = harness({ backoffMs: (attempt) => 100 * 2 ** attempt });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(1006);
    expect(h.timers.live()).toContain(100);
    h.timers.fire(100);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1].fireClose(1006);
    expect(h.timers.live()).toContain(200);
    h.manager.stop();
  });

  it('resets the wait once a connection sticks', async () => {
    const h = harness({ backoffMs: (attempt) => 100 * 2 ** attempt });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(1006);
    h.timers.fire(100);
    h.sockets[1].fireOpen();
    await settle();
    h.sockets[1].fireClose(1006);
    expect(h.timers.live()).toContain(100); // weer vanaf het begin
    h.manager.stop();
  });

  it('hands coverage back once push has been away too long', async () => {
    const h = harness({ graceMs: 120_000 });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(1006);
    // Nog niet: een blip mag niets omschakelen.
    expect(h.events).not.toContain('cover:a@x.nl:false');
    h.timers.fire(120_000);
    expect(h.events).toContain('cover:a@x.nl:false');
    h.manager.stop();
  });

  it('keeps coverage when it reconnects inside the grace window', async () => {
    const h = harness({ graceMs: 120_000, backoffMs: () => 100 });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(1006);
    h.timers.fire(100);
    h.sockets[1].fireOpen();
    await settle();
    expect(h.events).not.toContain('cover:a@x.nl:false');
    h.manager.stop();
  });

  it('gives up and hands coverage back on a refusal it cannot fix', async () => {
    const h = harness();
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(4403); // adres niet in ALLOWED_EMAILS van de relay
    expect(h.events).toContain('cover:a@x.nl:false');
    expect(h.events).toContain('fatal:a@x.nl:4403');
    expect(h.timers.live()).toEqual([]); // geen herverbinding meer
    h.manager.stop();
  });

  it('names the codes that are not worth retrying', () => {
    expect(FATAL_CLOSE_CODES).toEqual([4400, 4401, 4403]);
  });

  it('renews the watch on its own clock', async () => {
    const h = harness({ renewMs: 86_400_000 });
    h.sockets[0].fireOpen();
    await settle();
    expect(h.timers.fire(86_400_000)).toBe(true);
    await settle();
    expect(h.events.filter((e) => e === 'watch:a@x.nl')).toHaveLength(2);
    // En hij plant zichzelf opnieuw in.
    expect(h.timers.live()).toContain(86_400_000);
    h.manager.stop();
  });

  it('reconnects when the socket goes silent', async () => {
    const h = harness({ staleMs: 90_000 });
    h.sockets[0].fireOpen();
    await settle();
    h.timers.fire(90_000);
    expect(h.sockets[0].closed).toBe(true);
    h.manager.stop();
  });

  it('pushes the silence deadline back on every frame', async () => {
    const h = harness({ staleMs: 90_000 });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireMessage(JSON.stringify({ type: 'ready' }));
    // De oude timer is afgezegd en er staat een nieuwe.
    expect(h.timers.live().filter((ms) => ms === 90_000)).toHaveLength(1);
    h.manager.stop();
  });

  it('cleans everything up on stop', async () => {
    const h = harness();
    h.sockets[0].fireOpen();
    await settle();
    h.manager.stop();
    expect(h.sockets[0].closed).toBe(true);
    expect(h.timers.live()).toEqual([]);
    h.sockets[0].fireClose(1006);
    expect(h.sockets).toHaveLength(1); // geen herverbinding na stop
  });

  it('connects an account that appears later and drops one that goes away', async () => {
    let list = ['a@x.nl'];
    const h = harness({ accounts: () => list });
    h.sockets[0].fireOpen();
    await settle();
    list = ['a@x.nl', 'b@x.nl'];
    h.manager.refresh();
    expect(h.sockets).toHaveLength(2);
    list = ['b@x.nl'];
    h.manager.refresh();
    expect(h.sockets[0].closed).toBe(true);
    expect(h.events).toContain('cover:a@x.nl:false');
    h.manager.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/push-manager.test.ts`
Expected: FAIL — module bestaat niet.

- [ ] **Step 3: Write minimal implementation**

`electron/push-manager.ts`:

```ts
import { wsTransport, type PushSocket, type PushTransport } from './push-transport';
import type { PushConfig } from './push-config';

// Eén verbinding per account naar de relay. Dat moet per account, want de relay
// authenticeert met één token per verbinding en routeert op het adres daaruit.
//
// Overgezet uit gmail-native (src/main/push/manager.ts). Wat er hier bij komt:
// dekkingsmeldingen (zodat de webview weet of hij moet zwijgen), het herkennen
// van sluitcodes waar opnieuw proberen zinloos is, en een hartslagtimer voor een
// socket die doodgaat zonder afscheid.

// Codes waar de relay mee zegt dat er iets structureel mis is: 4400 een kapot
// frame van ons, 4401 een token dat Google afkeurt, 4403 een adres dat niet in
// ALLOWED_EMAILS staat. Blijven proberen lost geen van de drie op.
export const FATAL_CLOSE_CODES = [4400, 4401, 4403];

export interface Timer {
  clear(): void;
}

export interface PushManagerDeps {
  config: PushConfig;
  accounts(): string[];
  accessToken(email: string): Promise<string | null>;
  // True als de watch staat. Zonder watch stuurt Gmail niets en is het account
  // dus niet gedekt, hoe goed de socket het ook doet.
  armWatch(email: string): Promise<boolean>;
  onSync(email: string): void;
  onCoverage(email: string, covered: boolean): void;
  onFatal?(email: string, code: number): void;
  transport?: PushTransport;
  backoffMs?(attempt: number): number;
  setTimer?(fn: () => void, ms: number): Timer;
  renewMs?: number;
  staleMs?: number;
  graceMs?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_MS = 90_000; // de relay klopt elke 30s aan; drie keer niets is dood
const GRACE_MS = 120_000; // zie de spec: kort genoeg om niet blind te zitten

interface ConnState {
  sock?: PushSocket;
  attempt: number;
  covered: boolean;
  reconnect?: Timer;
  renew?: Timer;
  stale?: Timer;
  grace?: Timer;
  dead: boolean; // definitief geweigerd: niet meer proberen
}

export function startPushManager(deps: PushManagerDeps): { stop(): void; refresh(): void } {
  const transport = deps.transport ?? wsTransport;
  const backoffMs = deps.backoffMs ?? ((attempt) => Math.min(30_000, 1000 * 2 ** attempt));
  const renewMs = deps.renewMs ?? DAY_MS;
  const staleMs = deps.staleMs ?? STALE_MS;
  const graceMs = deps.graceMs ?? GRACE_MS;
  const setTimer =
    deps.setTimer ??
    ((fn, ms) => {
      const t = setTimeout(fn, ms);
      return { clear: () => clearTimeout(t) };
    });

  let stopped = false;
  const conns = new Map<string, ConnState>();

  const setCovered = (email: string, state: ConnState, covered: boolean): void => {
    if (state.covered === covered) return;
    state.covered = covered;
    deps.onCoverage(email, covered);
  };

  const clearTimers = (state: ConnState): void => {
    state.reconnect?.clear();
    state.renew?.clear();
    state.stale?.clear();
    state.grace?.clear();
    state.reconnect = undefined;
    state.renew = undefined;
    state.stale = undefined;
    state.grace = undefined;
  };

  // Elke vernieuwing plant de volgende zelf in, en hangt aan het account en niet
  // aan één socket: de watch is een gewone HTTPS-aanroep en kan dus ook slagen
  // terwijl de verbinding even weg is.
  const scheduleRenew = (email: string, state: ConnState): void => {
    state.renew?.clear();
    state.renew = setTimer(() => {
      if (stopped) return;
      void deps
        .armWatch(email)
        .then((ok) => {
          if (!ok) setCovered(email, state, false);
        })
        .catch(() => setCovered(email, state, false))
        .finally(() => {
          if (!stopped) scheduleRenew(email, state);
        });
    }, renewMs);
  };

  // Een socket die stilvalt zonder close-event zou de manager voor altijd laten
  // denken dat hij verbonden is. Elke frame — ook een ping — schuift dit op.
  const armStale = (email: string, state: ConnState): void => {
    state.stale?.clear();
    state.stale = setTimer(() => {
      if (stopped) return;
      state.sock?.close(); // het close-event hierna regelt de herverbinding
    }, staleMs);
  };

  const connect = (email: string): void => {
    if (stopped) return;
    const state = conns.get(email) ?? { attempt: 0, covered: false, dead: false };
    conns.set(email, state);
    if (state.dead) return;

    let sock: PushSocket;
    try {
      sock = transport.connect(deps.config.relayUrl);
    } catch (e) {
      console.warn(`[push] verbinden mislukte meteen voor ${email}:`, e);
      state.reconnect = setTimer(() => connect(email), backoffMs(state.attempt++));
      return;
    }
    state.sock = sock;

    sock.onOpen(() => {
      void (async () => {
        try {
          const token = await deps.accessToken(email);
          if (!token) {
            // Geen token: de relay zou ons toch weigeren. Wachten tot een
            // volgende poging; misschien is het account dan wel gekoppeld.
            console.warn(`[push] geen token voor ${email}`);
            return;
          }
          sock.send(JSON.stringify({ type: 'auth', accessToken: token }));
          const armed = await deps.armWatch(email);
          if (!armed) {
            console.warn(`[push] watch mislukte voor ${email}; webview blijft melden`);
            return;
          }
          state.attempt = 0;
          state.grace?.clear();
          state.grace = undefined;
          armStale(email, state);
          scheduleRenew(email, state);
          // Dekking vóór de catch-up: de meldingsregel meet vanaf dit moment, en
          // mail die daarvoor kwam heeft de webview al gemeld.
          setCovered(email, state, true);
          deps.onSync(email);
        } catch (e) {
          console.warn(`[push] handdruk mislukte voor ${email}:`, e);
        }
      })();
    });

    sock.onMessage((data) => {
      armStale(email, state);
      let msg: { type?: string };
      try {
        msg = JSON.parse(data) as { type?: string };
      } catch {
        return; // onleesbaar frame: negeren, niet omvallen
      }
      if (msg.type === 'sync') deps.onSync(email);
    });

    sock.onError((e) => console.warn(`[push] socketfout voor ${email}:`, e));

    sock.onClose((code) => {
      state.stale?.clear();
      state.stale = undefined;
      state.renew?.clear();
      state.renew = undefined;
      if (stopped) return;

      if (FATAL_CLOSE_CODES.includes(code)) {
        // Hier lost opnieuw proberen niets op. Dekking terug naar de webview en
        // de aanroeper laten weten waarom, zodat die om hertoestemming kan vragen.
        state.dead = true;
        setCovered(email, state, false);
        deps.onFatal?.(email, code);
        return;
      }

      // Een blip mag niets omschakelen; een storing van minuten wel, anders zit
      // je zonder meldingen te wachten op iets dat te laat komt.
      if (state.covered && !state.grace) {
        state.grace = setTimer(() => setCovered(email, state, false), graceMs);
      }
      state.reconnect = setTimer(() => connect(email), backoffMs(state.attempt++));
    });
  };

  const refresh = (): void => {
    if (stopped) return;
    const wanted = new Set(deps.accounts());
    for (const [email, state] of conns) {
      if (wanted.has(email)) continue;
      clearTimers(state);
      setCovered(email, state, false);
      state.sock?.close();
      conns.delete(email);
    }
    for (const email of wanted) if (!conns.has(email)) connect(email);
  };

  refresh();

  return {
    stop(): void {
      stopped = true;
      for (const state of conns.values()) {
        clearTimers(state);
        state.sock?.close();
      }
      conns.clear();
    },
    refresh,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/push-manager.test.ts`
Expected: PASS (16 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/push-manager.ts tests/push-manager.test.ts
git commit -m "feat: verbinding, watch en herverbinden per account"
```

---

### Task 9: Scope erbij, en de herverbind-melding die erom vraagt

De relay leest het adres uit `tokeninfo`. Zonder `userinfo.email` staat daar niets en sluit hij met `4401`. Na deze uitbreiding mist elk bestaand token die scope, dus de app moet er zelf om vragen — anders werkt push bij niemand en zegt niets waarom.

**Files:**
- Modify: `electron/google-oauth.ts` (`SCOPES`)
- Modify: `electron/oauth-health.ts` (`HealthInput`, `accountsNeedingReconnect`)
- Test: `tests/google-oauth.test.ts`, `tests/oauth-health.test.ts`

**Interfaces:**
- Consumes: `hasScopes(token, wanted?)` uit `electron/google-oauth.ts` (bestaat al, wordt nu pas gebruikt).
- Produces: `HealthInput` krijgt `missingScopes: (email: string) => boolean`.

- [ ] **Step 1: Write the failing test**

In `tests/oauth-health.test.ts` staat bovenaan al een `input()`-fabriek. Omdat
`missingScopes` een verplicht veld wordt, moet die fabriek het meekrijgen —
anders faalt de typecheck op de bestaande tests. Vul hem aan:

```ts
const input = (over: Partial<Parameters<typeof accountsNeedingReconnect>[0]> = {}) => ({
  ownEmails: ['a@x.nl', 'b@x.nl'],
  hasToken: () => true,
  refreshFailed: () => false,
  missingScopes: () => false,
  ...over,
```

En onderaan hetzelfde bestand erbij:

```ts
describe('accountsNeedingReconnect — scopes', () => {
  const base = {
    ownEmails: ['a@x.nl'],
    hasToken: () => true,
    refreshFailed: () => false,
    missingScopes: () => false,
  };

  it('leaves a healthy account alone', () => {
    expect(accountsNeedingReconnect(base)).toEqual([]);
  });

  // Zonder dit werkt push na de scope-uitbreiding bij niemand: de relay sluit
  // elke verbinding met 4401 en er is niets dat het vertelt.
  it('asks to reconnect an account whose token predates a new scope', () => {
    expect(accountsNeedingReconnect({ ...base, missingScopes: () => true })).toEqual(['a@x.nl']);
  });

  it('reports an account once even when more than one reason applies', () => {
    expect(
      accountsNeedingReconnect({ ...base, hasToken: () => false, missingScopes: () => true }),
    ).toEqual(['a@x.nl']);
  });
});
```

Toevoegen aan `tests/google-oauth.test.ts`:

```ts
// Vul de bestaande import aan met SCOPES en hasScopes als die er nog niet staan.
describe('SCOPES', () => {
  // De relay koppelt een verbinding aan een account via het e-mailadres uit
  // tokeninfo. Met alleen Gmail-scopes geeft tokeninfo dat adres niet.
  it('includes the email scope the relay needs to identify the account', () => {
    expect(SCOPES).toContain('https://www.googleapis.com/auth/userinfo.email');
  });

  it('still includes what the app itself needs', () => {
    expect(SCOPES).toContain('https://www.googleapis.com/auth/gmail.readonly');
    expect(SCOPES).toContain('https://www.googleapis.com/auth/gmail.insert');
  });

  it('sees a token minted before the email scope as incomplete', () => {
    const old = {
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresAt: 0,
      scopes: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.insert',
      ],
    };
    expect(hasScopes(old)).toBe(false);
  });

  it('sees a token with everything as complete', () => {
    expect(hasScopes({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 0, scopes: SCOPES })).toBe(
      true,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/oauth-health.test.ts tests/google-oauth.test.ts`
Expected: FAIL — `missingScopes` bestaat niet in `HealthInput`, en `SCOPES` mist de e-mailscope.

- [ ] **Step 3: Write minimal implementation**

In `electron/google-oauth.ts`, `SCOPES` vervangen door:

```ts
// Lezen om de originele berichten op te halen (format=raw), labels te kunnen
// opsommen en de history te volgen; insert om een bericht in een ánder postvak te
// zetten. Allebei "restricted" scopes: zonder Google-verificatie werkt dit alleen
// voor accounts die als testgebruiker staan aangemerkt.
//
// userinfo.email hoort niet bij Gmail maar bij de push-relay: die koppelt een
// verbinding aan een account via het e-mailadres uit tokeninfo, en met alleen
// Gmail-scopes geeft tokeninfo dat adres niet terug. Zonder deze scope sluit de
// relay elke verbinding met 4401.
export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.insert',
  'https://www.googleapis.com/auth/userinfo.email',
];
```

In `electron/oauth-health.ts`:

```ts
export interface HealthInput {
  // Alleen eigen accounts: een delegated mailbox is iemand anders' postvak en
  // heeft geen eigen koppeling nodig.
  ownEmails: string[];
  hasToken: (email: string) => boolean;
  refreshFailed: (email: string) => boolean;
  // Het token bestaat en werkt, maar is gemaakt voordat er een scope bijkwam.
  // Een verversing levert die scope niet op — daarvoor moet de gebruiker
  // opnieuw toestemming geven.
  missingScopes: (email: string) => boolean;
}

// Een account moet opnieuw verbonden worden als het geen token heeft, als het
// verversen ervan is mislukt (in testmodus vervalt een refresh token na zeven
// dagen), of als het token een scope mist die we sindsdien nodig hebben.
export function accountsNeedingReconnect(input: HealthInput): string[] {
  return input.ownEmails.filter(
    (e) => !input.hasToken(e) || input.refreshFailed(e) || input.missingScopes(e),
  );
}
```

In `electron/main.ts`, in `checkOAuthHealth()`, de aanroep van `accountsNeedingReconnect` aanvullen:

```ts
  const needing = accountsNeedingReconnect({
    ownEmails,
    hasToken: (e) => oauthTokens!.get(e) !== undefined,
    refreshFailed: (e) => refreshFailures.has(e),
    missingScopes: (e) => {
      const token = oauthTokens!.get(e);
      return token !== undefined && !hasScopes(token);
    },
  });
```

En de import in `main.ts` aanvullen:

```ts
import { hasScopes, type OAuthConfig } from './google-oauth';
```

(de bestaande regel is `import type { OAuthConfig } from './google-oauth';` — die vervangen, want `hasScopes` is een waarde en geen type)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/oauth-health.test.ts tests/google-oauth.test.ts`
Expected: PASS. Daarna `npm test` — alles groen — en `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add electron/google-oauth.ts electron/oauth-health.ts electron/main.ts tests/oauth-health.test.ts tests/google-oauth.test.ts
git commit -m "feat: e-mailscope erbij en om hertoestemming vragen als hij mist"
```

---

### Task 10: Meldingen dempen voor gedekte accounts

**Files:**
- Modify: `electron/notification-policy.ts` (`notificationsAllowed`)
- Test: `tests/notification-policy.test.ts`

**Interfaces:**
- Consumes: niets nieuw.
- Produces: `notificationsAllowed(prefs, email, now, surface?, pushCovered?)` — vijfde parameter, standaard `false`.

- [ ] **Step 1: Write the failing test**

Toevoegen aan `tests/notification-policy.test.ts`. Hergebruik de `prefs`-fabriek die daar al staat; heet die anders, pas de naam aan.

```ts
describe('notificationsAllowed — push', () => {
  // Een gedekt account krijgt zijn meldingen van de API. Zou de webview ook nog
  // melden, dan kwam alles dubbel.
  it('mutes the webview for an account push covers', () => {
    const p = prefs({ accounts: { 'a@x.nl': { notify: true } } });
    expect(notificationsAllowed(p, 'a@x.nl', new Date(), 'mail', true)).toBe(false);
  });

  it('leaves the webview alone for an account push does not cover', () => {
    const p = prefs({ accounts: { 'a@x.nl': { notify: true } } });
    expect(notificationsAllowed(p, 'a@x.nl', new Date(), 'mail', false)).toBe(true);
  });

  it('defaults to not covered, so nothing changes for callers that do not pass it', () => {
    const p = prefs({ accounts: { 'a@x.nl': { notify: true } } });
    expect(notificationsAllowed(p, 'a@x.nl', new Date(), 'mail')).toBe(true);
  });

  // Dempen gaat over de webview, niet over de gebruiker: staat de melding uit,
  // dan blijft hij uit, ook als push hem zou kunnen sturen.
  it('does not turn a switched-off account back on', () => {
    const p = prefs({ accounts: { 'a@x.nl': { notify: false } } });
    expect(notificationsAllowed(p, 'a@x.nl', new Date(), 'mail', false)).toBe(false);
  });

  // De agenda meldt via zijn eigen view en heeft niets met de mail-push te maken.
  it('does not let mail coverage touch the calendar surface', () => {
    const p = prefs({ accounts: { 'a@x.nl': { calendarNotify: true } } });
    expect(notificationsAllowed(p, 'a@x.nl', new Date(), 'calendar', true)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/notification-policy.test.ts`
Expected: FAIL — de vijfde parameter wordt genegeerd, dus de eerste test geeft `true`.

- [ ] **Step 3: Write minimal implementation**

In `electron/notification-policy.ts`, `notificationsAllowed` vervangen door:

```ts
export function notificationsAllowed(
  prefs: Prefs,
  email: string,
  now: Date,
  surface: Surface = 'mail',
  // Krijgt dit account zijn meldingen al van de Gmail API? Dan moet Gmail's
  // eigen melding in de webview zwijgen, anders komt alles dubbel. Alleen voor
  // mail: de agenda meldt via zijn eigen view en staat hier buiten.
  pushCovered = false,
): boolean {
  const { dnd, dndUntil, quietHours } = prefs.notifications;
  if (dnd) return false;
  if (dndUntil && now.getTime() < dndUntil) return false;
  if (
    quietHours.enabled &&
    inQuietHours(quietHours.start, quietHours.end, now.getHours() * 60 + now.getMinutes())
  ) {
    return false;
  }
  const account = prefs.accounts[email];
  if (surface === 'calendar') return account?.calendarNotify === true;
  if (surface !== 'mail') return false; // v1: the other Google apps never notify
  if (pushCovered) return false;
  return account?.notify !== false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/notification-policy.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/notification-policy.ts tests/notification-policy.test.ts
git commit -m "feat: gmail's eigen meldingen dempen voor accounts die push dekt"
```

---

### Task 11: main.ts koppelen

Alles aan elkaar. Alleen koppelcode: de logica staat in de modules hierboven.

**Files:**
- Modify: `electron/main.ts`

**Interfaces:**
- Consumes: alles uit Task 1 t/m 10.
- Produces: niets voor latere taken; dit is de laatste.

- [ ] **Step 1: Extract the notification-click handler**

Onze eigen meldingen moeten bij een klik hetzelfde doen als die van de webview: het gesprek openen, in het venster of als pop-out, afhankelijk van de voorkeur. Die logica zit nu ingebakken in de callback die aan `ProfileViewManager` wordt doorgegeven (`main.ts` rond regel 1398).

Til de body van die callback uit naar een benoemde functie op modulehoogte, direct boven `createWindow`:

```ts
// Wat er moet gebeuren als een melding wordt aangeklikt. Getild uit de callback
// die aan ProfileViewManager gaat, zodat de meldingen die de app zelf maakt
// (push) er precies hetzelfde in kunnen: één gedrag, één plek.
function activateNotification(accountKey: string, surface: Surface, threadId?: string): void {
  // ... exact de bestaande body, ongewijzigd ...
}
```

En de constructor-aanroep terugbrengen tot:

```ts
  manager = new ProfileViewManager(
    mainWindow,
    PRELOAD_PATH,
    (accountKey, count) => { /* stap 2 vervangt dit */ },
    (accountKey, surface, threadId) => activateNotification(accountKey, surface, threadId),
```

Run: `npx tsc --noEmit` en `npm test` — schoon en groen. Dit is een verplaatsing zonder gedragsverandering.

```bash
git add electron/main.ts
git commit -m "refactor: meldingsklik naar een eigen functie zodat push hem kan hergebruiken"
```

- [ ] **Step 2: Wire the stores, coverage and config**

Bij de andere imports in `main.ts`:

```ts
import { parsePushConfig, type PushConfig } from './push-config';
import { PushCoverage } from './push-coverage';
import { HistoryStore } from './history-store';
import { startPushManager } from './push-manager';
import { createSyncRunner } from './push-sync';
import {
  watchMailbox,
  stopWatch,
  fetchProfileHistoryId,
  fetchHistoryPage,
  fetchMessageMeta,
  fetchInboxUnread,
} from './gmail-api';
```

Bij de andere module-variabelen (rond `let oauthTokens`):

```ts
let history: HistoryStore | null = null;
const coverage = new PushCoverage();
let pushManager: { stop(): void; refresh(): void } | null = null;
// Eén runner per account: die coalesceert samenvallende syncs voor dat account.
const syncRunners = new Map<string, { run(): Promise<void> }>();
```

In `createWindow`, naast de andere stores:

```ts
  history = new HistoryStore(join(app.getPath('userData'), 'gmail-history.json'));
```

De config komt uit hetzelfde bestand als de OAuth-gegevens. Naast `oauthConfig()`:

```ts
// Uit hetzelfde bestand als de client-id, en net als daar bij elke aanroep
// opnieuw gelezen: zo kun je de relay-regels neerzetten zonder te herstarten.
function pushConfig(): PushConfig | null {
  try {
    return parsePushConfig(JSON.parse(readFileSync(OAUTH_CONFIG_PATH, 'utf8')), process.env);
  } catch {
    // Bestand ontbreekt of is onleesbaar: dan is push simpelweg niet ingesteld.
    return parsePushConfig(null, process.env);
  }
}
```

Run: `npx tsc --noEmit`
Expected: schoon (de nieuwe variabelen zijn nog ongebruikt; dat mag, `noUnusedLocals` staat niet aan).

- [ ] **Step 3: Give the unread count one owner**

De callback uit stap 1 vervangen door:

```ts
    (accountKey, count) => {
      // Eén bron per account. Is het account door push gedekt, dan komt de
      // teller uit labels.get en zou de paginatitel hem alleen overschrijven —
      // twee bronnen die om hetzelfde getal vechten laten het heen en weer
      // springen. Bij een teruggave van de dekking neemt de titel het weer over.
      const email = profiles.find((p) => keyOf(p) === accountKey)?.email;
      if (email && coverage.has(email)) return;
      unread.report(accountKey, count);
      pushUnread();
      refreshBadge();
    },
```

En een tegenhanger voor de API-kant, naast `refreshNotifyAllowed`:

```ts
// De teller zoals de API hem geeft. Null betekent: onbekend gebleven, dan blijft
// staan wat er stond.
function reportApiUnread(email: string, count: number | null): void {
  if (count === null) return;
  const profile = profiles.find((p) => p.email === email);
  if (!profile) return;
  unread.report(keyOf(profile), count);
  pushUnread();
  refreshBadge();
}
```

Run: `npx tsc --noEmit` en `npm test`.

- [ ] **Step 4: Pass coverage into the notify gate**

In `refreshNotifyAllowed()` de `show`-regel vervangen:

```ts
        show: notificationsAllowed(p, profile.email, now, surface, coverage.has(profile.email)),
```

Run: `npx tsc --noEmit`

- [ ] **Step 5: Show a notification for new mail**

Naast `activateNotification`:

```ts
// Een melding voor één nieuw bericht, langs dezelfde weg als die van de webview:
// zelfde geluid- en blijven-staan-voorkeuren, en dezelfde klikbehandeling. De
// gate zelf is hierboven al gedaan — notificationsAllowed geldt ook voor push,
// alleen dan zonder de pushCovered-vlag, want die dooft juist de webview.
function notifyNewMail(email: string, meta: MessageMeta): void {
  if (!prefs || !Notification.isSupported()) return;
  const profile = profiles.find((p) => p.email === email);
  if (!profile) return;
  const p = prefs.getAll();
  const now = new Date();
  if (!notificationsAllowed(p, email, now, 'mail')) return;
  const n = new Notification({
    title: displayName(meta.from) || email,
    body: meta.subject || NO_SUBJECT,
    silent: notificationSilent(p, email, 'mail'),
    // Blijven staan tot de gebruiker hem wegklikt, als dat aanstaat.
    timeoutType: notificationPersist(p, email) ? 'never' : 'default',
  });
  n.on('click', () => activateNotification(keyOf(profile), 'mail', meta.threadId));
  n.show();
}
```

Drie imports om na te lopen:

- `NO_SUBJECT` staat al in `main.ts` (uit `./dropzone`).
- `displayName` staat er **niet**: voeg hem toe aan de bestaande import uit
  `./mail-archive`, die nu `{ writeThread, writeLabel, appendLog, type LogRecord, type SavedMessage }` is.
- `type MessageMeta` toevoegen aan de import uit `./gmail-api`.

Run: `npx tsc --noEmit`

- [ ] **Step 6: Build the sync runner per account**

Naast `notifyNewMail`:

```ts
// Eén runner per account, zodat samenvallende syncs voor hetzelfde account
// gecoalesceerd worden en die van verschillende accounts elkaar niet ophouden.
function syncRunnerFor(email: string): { run(): Promise<void> } | null {
  const existing = syncRunners.get(email);
  if (existing) return existing;
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens || !history) return null;

  // Elke aanroep vraagt opnieuw een token: tussen twee syncs kan er een uur
  // zitten en dan is het oude verlopen.
  const withToken = async <T>(fn: (token: string) => Promise<T>): Promise<T> => {
    const token = await accessTokenFor(cfg, oauthTokens!, email);
    if (!token) throw new Error('geen token');
    try {
      return await fn(token);
    } catch (e) {
      if (!(e instanceof GmailHttpError) || e.status !== 401) throw e;
      const fresh = await forceRefresh(cfg, oauthTokens!, email);
      if (!fresh) {
        refreshFailures.add(email);
        scheduleOAuthHealthCheck();
        throw e;
      }
      refreshFailures.delete(email);
      return await fn(fresh);
    }
  };

  const runner = createSyncRunner({
    client: {
      profileHistoryId: () => withToken((t) => fetchProfileHistoryId(t)),
      historyPage: (start, pageToken) => withToken((t) => fetchHistoryPage(t, start, pageToken)),
      messageMeta: (id) => withToken((t) => fetchMessageMeta(t, id)),
      inboxUnread: () => withToken((t) => fetchInboxUnread(t)),
    },
    cursor: {
      get: () => history!.get(email),
      set: (id) => history!.set(email, id),
    },
    coveredSince: () => coverage.since(email),
    isExpiredCursor: (e) => e instanceof GmailHttpError && e.status === 404,
    onOutcome: (outcome) => {
      reportApiUnread(email, outcome.unread);
      for (const meta of outcome.notify) notifyNewMail(email, meta);
    },
    onError: (e) => console.warn(`[push] sync mislukte voor ${email}:`, e),
  });
  syncRunners.set(email, runner);
  return runner;
}
```

Run: `npx tsc --noEmit`

- [ ] **Step 7: Start and refresh the manager**

Naast de sync-code:

```ts
// Welke accounts push kán dekken: eigen accounts met een token dat de vereiste
// scopes heeft. Een gedelegeerd postvak heeft geen eigen token en blijft dus de
// webview gebruiken.
function pushableEmails(): string[] {
  if (!oauthTokens) return [];
  return profiles
    .filter((p) => p.kind === 'authuser')
    .map((p) => p.email)
    .filter((email) => {
      const token = oauthTokens!.get(email);
      return token !== undefined && hasScopes(token);
    });
}

function startPush(): void {
  if (pushManager) {
    pushManager.refresh();
    return;
  }
  const config = pushConfig();
  if (!config) return; // niet ingesteld: alles blijft zoals het was
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return;

  pushManager = startPushManager({
    config,
    accounts: pushableEmails,
    accessToken: (email) => accessTokenFor(cfg, oauthTokens!, email),
    armWatch: async (email) => {
      const token = await accessTokenFor(cfg, oauthTokens!, email);
      if (!token) return false;
      try {
        return (await watchMailbox(token, config.pushTopic)) !== null;
      } catch (e) {
        console.warn(`[push] watch mislukte voor ${email}:`, e);
        return false;
      }
    },
    onSync: (email) => void syncRunnerFor(email)?.run(),
    onCoverage: (email, covered) => {
      if (covered) coverage.cover(email);
      else coverage.drop(email);
      // De webview moet meteen weten of hij mag melden, en de teller wisselt
      // van eigenaar.
      refreshNotifyAllowed();
    },
    onFatal: (email, code) => {
      console.warn(`[push] push definitief uit voor ${email} (code ${code})`);
      // 4401 betekent bijna altijd een token zonder de e-mailscope. De
      // herverbind-melding vraagt daar zelf om.
      if (code === 4401) void checkOAuthHealth();
    },
  });
}
```

Aanroepen waar de accountlijst verandert. Zoek de plek waar `refreshNotifyAllowed()` na een wijziging van `profiles` wordt aangeroepen (rond regel 465, 532 en 2013) en zet `startPush();` erachter. Bij het verwijderen van een account, in de bestaande `REMOVE_ACCOUNT`-behandeling naast `oauthTokens?.remove(email)`:

```ts
  // Netjes afmelden, anders blijft Gmail nog tot een week publiceren voor een
  // client die er niet meer is. Best-effort: het token is hierna weg.
  void (async () => {
    const cfg = oauthConfig();
    if (!cfg || !oauthTokens) return;
    const token = await accessTokenFor(cfg, oauthTokens, email);
    if (token) await stopWatch(token).catch(() => undefined);
  })();
  history?.remove(email);
  coverage.forget(email);
  syncRunners.delete(email);
```

Let op de volgorde: `stopWatch` heeft het token nog nodig, dus dit moet vóór `oauthTokens?.remove(email)`.

En bij het afsluiten van de app, in de bestaande `before-quit`- of `will-quit`-behandeling:

```ts
  pushManager?.stop();
```

Run: `npx tsc --noEmit`, `npm test`, `npm run build:main` — alles schoon.

- [ ] **Step 8: Commit**

```bash
git add electron/main.ts
git commit -m "feat: push-meldingen en api-teller aan de app koppelen"
```

- [ ] **Step 9: Verify the handshake against a local relay**

Nog zonder GCP. In WSL, in `~/projects/gmail-push-relay`:

```bash
npm install
npm run dev:local
```

Dan de app met:

```bash
GMAIL_PUSH_RELAY_URL=ws://localhost:8099 GMAIL_PUSH_TOPIC=projects/dev/topics/gmail-push npm run dev
```

Verwacht in de app-console: geen `[push]`-waarschuwingen over verbinden of authenticeren. Eén `[pubsub] stream error` aan de relay-kant is normaal (er is geen echte subscription). De watch mislukt hier wel — het topic bestaat niet — dus verwacht `[push] watch mislukte`, en verwacht dat Gmail's eigen meldingen blijven werken. Dat is precies de terugval die het moet doen.

Zet de relay stil en let op: na twee minuten hoort er één omschakeling te komen en geen geflikker.

- [ ] **Step 10: Verify end to end against the real subscription**

Eenmalig, als dat nog niet gedaan is: `PROJECT_ID=<project> bash scripts/gcp-setup.sh` in de relay-map. Gebruik hetzelfde GCP-project als de OAuth-client van de app (zie `project_id` in de client-config).

Relay: `.env` vullen (`PUBSUB_SUBSCRIPTION`, `ALLOWED_EMAILS` met jouw adressen, `GOOGLE_APPLICATION_CREDENTIALS=secrets/sa.json`, `PORT=8099`), dan `npm run live`.

App: eerst per account op de herverbind-melding klikken zodat het token de e-mailscope krijgt. Dan starten met `GMAIL_PUSH_RELAY_URL=ws://localhost:8099` en `GMAIL_PUSH_TOPIC=projects/<project>/topics/gmail-push`.

Controleer, in deze volgorde:

1. Mail jezelf van buiten. Binnen een paar seconden een melding met de juiste afzender en het juiste onderwerp.
2. Klik erop: het juiste gesprek opent, in het venster of als pop-out volgens de voorkeur.
3. Er komt géén tweede melding van Gmail zelf.
4. De ongelezen-teller in de zijbalk klopt.
5. Herstart de app terwijl er ongelezen mail ligt: de teller klopt en er komt **geen** melding voor die oude mail.
6. **Het openstaande punt uit de spec:** open een ongelezen bericht en kijk of er een sync komt en de teller daalt. Zo niet, dan vuurt de watch niet op alleen een gelezen-markering. De uitwijk staat in `gmail-api.ts` in `watchBody`: `labelIds` en `labelFilterBehavior` weglaten, zodat Gmail bij elke wijziging meldt. `historyListUrl` filtert al op `labelId=INBOX`, dus de rest verandert niet. Voer die wijziging door met een test die vastlegt dat de body geen labelfilter meer heeft, en noteer in het commitbericht waarom.

- [ ] **Step 11: Put the config in place and commit the outcome**

`google-oauth.json` in `userData` (`%APPDATA%/gmail-desktop/google-oauth.json` op Windows) krijgt er twee regels bij naast `clientId` en `clientSecret`:

```json
  "relayUrl": "wss://<relay-domein>",
  "pushTopic": "projects/<project>/topics/gmail-push"
```

Daarna de app zonder omgevingsvariabelen starten en stap 10 punt 1 nog eens doen.

```bash
git add -A
git commit -m "test: push van begin tot eind nagelopen tegen de echte relay"
```

---

## Self-Review

**Spec coverage** — elke sectie van de spec heeft een taak:

| Spec | Taak |
|---|---|
| Config bij de OAuth-config, env gaat voor | 1, 11 stap 2 |
| `watch`, `history.list`, metadata, teller | 2 |
| Cursor op schijf | 3 |
| Filter reclame/sociaal; meldingsregel | 4 |
| Dekking en het moment ervan | 5 |
| Sync met 404-herstel, coalescing, cursor-invariant | 6 |
| `ws` achter een naad | 7 |
| Verbinden, watch vernieuwen, backoff, hartslag, terugvalgrens van 2 minuten, definitieve codes | 8 |
| `userinfo.email` en de herverbind-melding | 9 |
| Gmail's meldingen dempen | 10 |
| Teller heeft één eigenaar; meldingen via de bestaande weg; `users.stop()` bij verwijderen; koppelen | 11 |
| Drie stappen echt uitproberen | 11 stap 9–11 |
| Openstaand punt over gelezen markeren, met uitwijk | 11 stap 10 punt 6 |

**Type consistency** — nagelopen: `notifiableIds`/`shouldNotify` (Task 4) worden zo gebruikt in Task 6; `HistoryPage.added` heet in beide `added`; `PushCoverage.since()` geeft `number | null` en `shouldNotify` neemt `number | null`; `armWatch` geeft `Promise<boolean>` in Task 8 en wordt in Task 11 zo geleverd; `fetchInboxUnread` geeft `number | null` en `SyncOutcome.unread` is `number | null`; `reportApiUnread` slikt `null`.

**Gecontroleerd tegen de code, niet aangenomen:** `tests/notification-policy.test.ts` heeft een `prefs(overrides)`-fabriek (regel 12) die de tests van taak 10 gebruiken; `tests/google-oauth.test.ts` importeert `hasScopes` al; `NO_SUBJECT` is al geïmporteerd in `main.ts` maar `displayName` niet; `app.on('before-quit')` bestaat (regel 2103); en `tests/oauth-health.test.ts` heeft een `input()`-fabriek die `missingScopes` mee moet krijgen omdat het veld verplicht wordt.

**Eén ding om te weten bij het uitvoeren:** taak 9 verandert `SCOPES`, en daarmee mislukt push bij elk bestaand account tot de gebruiker per account één keer op de herverbind-melding klikt. Dat is bedoeld en getest, maar het betekent dat taak 11 stap 10 niet slaagt zonder die klikken.
