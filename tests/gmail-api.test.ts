// The Gmail API helpers: URLs, request bodies and response parsing.

import { describe, it, expect } from 'vitest';
import {
  parseLabels,
  parseAllLabels,
  findLabelId,
  multipartBody,
  pickBoundary,
  parseInsertedId,
  parseInsertedThreadId,
  apiHeaders,
  parseThreadList,
  parseThreadMessageIds,
  collectThreadMessages,
  parseMessageRaw,
  threadsListUrl,
  threadMessagesUrl,
  messageRawUrl,
  messageModifyUrl,
  archiveMessage,
  messageIdQuery,
  searchInLabelUrl,
  parseHasMessage,
  searchAnywhereUrl,
  messageLabelsUrl,
  parseMessageIds,
  parseMessageLabelIds,
  labelsHoldingMessage,
  WATCH_URL,
  STOP_URL,
  PROFILE_URL,
  HISTORY_URL,
  watchBody,
  parseWatch,
  parseProfileHistoryId,
  historyListUrl,
  parseHistoryPage,
  messageMetaUrl,
  parseMessageMeta,
  labelGetUrl,
  parseUnreadThreads,
  SEARCH_MATCH_LIMIT,
  batchedMessageIdQuery,
  messageIdChunks,
  BATCH_QUERY_LIMIT,
  searchManyUrl,
  parseMessageIdAndLabels,
  scanFromBatch,
  MESSAGE_META_HEADERS,
  MARKER_LABEL_PREFIX,
  BATCH_MODIFY_LIMIT,
  markerLabelName,
  isMarkerLabelName,
  labelCreateBody,
  parseCreatedLabel,
  createHiddenLabel,
  findLabelByExactName,
  looksLikeOwnMarker,
  resolveConflictedMarker,
  fetchLabel,
  deleteLabel,
  messagesUnderLabelUrl,
  parseMessageListPage,
  fetchMessageListPage,
  messagesBatchModifyUrl,
  batchModifyBody,
  batchModifyMessages,
  visibleLabelCreateBody,
  userLabelMap,
} from '../electron/gmail/gmail-api';

const label = (id: string, name: string, type = 'user') => ({ id, name, type });

describe('parseLabels', () => {
  it('keeps your own labels, sorted by name', () => {
    const out = parseLabels({
      labels: [label('L2', 'Offertes'), label('L1', 'Klanten'), label('L3', 'archief')],
    });
    expect(out.map((l) => l.name)).toEqual(['archief', 'Klanten', 'Offertes']);
  });

  it('puts the usable system labels first, in a fixed order', () => {
    const out = parseLabels({
      labels: [
        label('L1', 'Klanten'),
        label('IMPORTANT', 'IMPORTANT', 'system'),
        label('INBOX', 'INBOX', 'system'),
        label('STARRED', 'STARRED', 'system'),
      ],
    });
    expect(out.map((l) => l.id)).toEqual(['INBOX', 'STARRED', 'IMPORTANT', 'L1']);
  });

  it('gives the system labels a readable name', () => {
    expect(parseLabels({ labels: [label('INBOX', 'INBOX', 'system')] })[0].name).toBe('Postvak IN');
  });

  it('drops system labels that are not a place to put mail', () => {
    const out = parseLabels({
      labels: [
        label('CATEGORY_PROMOTIONS', 'CATEGORY_PROMOTIONS', 'system'),
        label('DRAFT', 'DRAFT', 'system'),
        label('SENT', 'SENT', 'system'),
        label('SPAM', 'SPAM', 'system'),
        label('TRASH', 'TRASH', 'system'),
        label('UNREAD', 'UNREAD', 'system'),
        label('CHAT', 'CHAT', 'system'),
        label('L1', 'Klanten'),
      ],
    });
    expect(out.map((l) => l.id)).toEqual(['L1']);
  });

  it('keeps a nested label with its full path', () => {
    expect(parseLabels({ labels: [label('L1', 'Werk/Grote klanten')] })[0].name).toBe(
      'Werk/Grote klanten',
    );
  });

  it('skips entries missing an id or a name', () => {
    const out = parseLabels({
      labels: [{ id: '', name: 'x', type: 'user' }, { id: 'L1', type: 'user' }, label('L2', 'Ok')],
    });
    expect(out.map((l) => l.id)).toEqual(['L2']);
  });

  it('returns nothing for an unexpected response', () => {
    expect(parseLabels({})).toEqual([]);
    expect(parseLabels(null)).toEqual([]);
    expect(parseLabels({ labels: 'geen lijst' })).toEqual([]);
  });

  it('sorts case- and accent-insensitively', () => {
    const out = parseLabels({ labels: [label('L1', 'Zaken'), label('L2', 'école'), label('L3', 'Ander')] });
    expect(out.map((l) => l.name)).toEqual(['Ander', 'école', 'Zaken']);
  });

  it('hides a marker label from a run, so it can never be offered to a later copy', () => {
    const out = parseLabels({
      labels: [label('M1', markerLabelName('run-1')), label('L1', 'Klanten')],
    });
    expect(out.map((l) => l.id)).toEqual(['L1']);
  });

  // The narrower of the two filters the review weighed: matched on the marker's own name,
  // never on labelListVisibility. A label a user hid for their own bookkeeping is not this
  // app's business, and stays exactly as offerable as it always was.
  it('does not hide an ordinary label a user made hidden, only this app\'s own marker', () => {
    const out = parseLabels({
      labels: [
        { id: 'H1', name: 'Persoonlijk archief', type: 'user', labelListVisibility: 'labelHide' },
        label('L1', 'Klanten'),
      ],
    });
    expect(out.map((l) => l.id).sort()).toEqual(['H1', 'L1']);
  });
});

describe('marker labels', () => {
  it('names a marker deterministically from the run id', () => {
    expect(markerLabelName('run-1')).toBe(`${MARKER_LABEL_PREFIX}run-1`);
  });

  it('recognises its own marker names and nothing else', () => {
    expect(isMarkerLabelName(markerLabelName('run-1'))).toBe(true);
    expect(isMarkerLabelName('Klanten')).toBe(false);
    expect(isMarkerLabelName('_gmd-copy')).toBe(false); // the prefix alone is not a run's marker
  });

  it('creates a marker hidden from every Gmail client', () => {
    expect(JSON.parse(labelCreateBody('_gmd-copy-run-1'))).toEqual({
      name: '_gmd-copy-run-1',
      labelListVisibility: 'labelHide',
      messageListVisibility: 'hide',
    });
  });

  it('reads the label a create call answered with', () => {
    expect(parseCreatedLabel({ id: 'L9', name: '_gmd-copy-run-1' })).toEqual({
      id: 'L9',
      name: '_gmd-copy-run-1',
    });
  });

  it('answers null for a create response missing an id or a name', () => {
    expect(parseCreatedLabel({ name: '_gmd-copy-run-1' })).toBeNull();
    expect(parseCreatedLabel({ id: 'L9' })).toBeNull();
    expect(parseCreatedLabel(null)).toBeNull();
  });

  it('exists and takes a token and a name', () => {
    expect(typeof createHiddenLabel).toBe('function');
    expect(createHiddenLabel.length).toBe(2);
  });

  it('deletes by the label-get URL, and exists with a token and an id', () => {
    expect(labelGetUrl('L9')).toBe('https://gmail.googleapis.com/gmail/v1/users/me/labels/L9');
    expect(typeof deleteLabel).toBe('function');
    expect(deleteLabel.length).toBe(2);
  });

  it('exists and takes a token and a name', () => {
    expect(typeof fetchLabel).toBe('function');
    expect(fetchLabel.length).toBe(2);
  });
});

describe('findLabelByExactName', () => {
  const own = (name: string) => ({
    id: 'L9',
    name,
    type: 'user',
    labelListVisibility: 'labelHide',
  });

  it('finds the exact name', () => {
    expect(findLabelByExactName([own('_gmd-copy-run-1')], '_gmd-copy-run-1')).toEqual(
      own('_gmd-copy-run-1'),
    );
  });

  it('does not fall back to a case-insensitive match, unlike findLabelId', () => {
    expect(findLabelByExactName([own('_GMD-COPY-RUN-1')], '_gmd-copy-run-1')).toBeNull();
  });

  it('answers null when nothing matches', () => {
    expect(findLabelByExactName([own('_gmd-copy-run-2')], '_gmd-copy-run-1')).toBeNull();
  });
});

describe('looksLikeOwnMarker', () => {
  const own = (over: Partial<ReturnType<typeof label> & { labelListVisibility: string }> = {}) => ({
    id: 'L9',
    name: '_gmd-copy-run-1',
    type: 'user',
    labelListVisibility: 'labelHide',
    ...over,
  });

  it('accepts a label that looks exactly like one this app would have made', () => {
    expect(looksLikeOwnMarker(own())).toBe(true);
  });

  it('refuses a system label, even with the right name and visibility', () => {
    expect(looksLikeOwnMarker(own({ type: 'system' }))).toBe(false);
  });

  it('refuses a label that is not hidden from Gmail\'s own clients', () => {
    expect(looksLikeOwnMarker(own({ labelListVisibility: 'labelShow' }))).toBe(false);
    expect(looksLikeOwnMarker(own({ labelListVisibility: '' }))).toBe(false);
  });

  it('refuses a label that does not carry this app\'s own marker prefix', () => {
    expect(looksLikeOwnMarker(own({ name: 'Klanten' }))).toBe(false);
  });
});

describe('resolveConflictedMarker', () => {
  const ownMarker = {
    id: 'L9',
    name: '_gmd-copy-run-1',
    type: 'user',
    labelListVisibility: 'labelHide',
  };

  it('trusts a recovered label that looks exactly like this app\'s own marker', () => {
    expect(resolveConflictedMarker('_gmd-copy-run-1', ownMarker)).toEqual({ ok: true, id: 'L9' });
  });

  it('refuses when nothing was found under that name at all', () => {
    const result = resolveConflictedMarker('_gmd-copy-run-1', null);
    expect(result.ok).toBe(false);
  });

  it('refuses a label that is not hidden, without ever returning its id', () => {
    const result = resolveConflictedMarker('_gmd-copy-run-1', {
      ...ownMarker,
      labelListVisibility: 'labelShow',
    });
    expect(result).toEqual({
      ok: false,
      reason: "label '_gmd-copy-run-1' bestaat al, maar is niet van deze app",
    });
  });

  it('refuses a label that is not a user label, without ever returning its id', () => {
    const result = resolveConflictedMarker('_gmd-copy-run-1', { ...ownMarker, type: 'system' });
    expect(result.ok).toBe(false);
  });

  it('refuses a label without the marker prefix, without ever returning its id', () => {
    const result = resolveConflictedMarker('_gmd-copy-run-1', { ...ownMarker, name: 'Klanten' });
    expect(result.ok).toBe(false);
  });
});

describe('messages under a label', () => {
  it('asks for a page of a label, by id', () => {
    expect(messagesUnderLabelUrl('L9')).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=L9&maxResults=500',
    );
  });

  it('carries a page token when given one', () => {
    expect(messagesUnderLabelUrl('L9', 'tok')).toContain('pageToken=tok');
  });

  it('reads the ids and the next page token off a listing', () => {
    expect(parseMessageListPage({ messages: [{ id: 'm1' }, { id: 'm2' }], nextPageToken: 'tok' })).toEqual({
      ids: ['m1', 'm2'],
      nextPageToken: 'tok',
    });
  });

  it('leaves the page token out once there is no next page', () => {
    expect(parseMessageListPage({ messages: [{ id: 'm1' }] })).toEqual({ ids: ['m1'] });
  });

  it('reads an empty listing as no ids at all', () => {
    expect(parseMessageListPage({})).toEqual({ ids: [] });
  });

  it('exists and takes a token, a label id and an optional page token', () => {
    expect(typeof fetchMessageListPage).toBe('function');
    expect(fetchMessageListPage.length).toBe(3);
  });
});

describe('batchModify', () => {
  it('is the messages collection\'s own batchModify path', () => {
    expect(messagesBatchModifyUrl()).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify',
    );
  });

  it('carries the ids and the label change in one body', () => {
    expect(JSON.parse(batchModifyBody(['m1', 'm2'], { addLabelIds: ['TRASH'] }))).toEqual({
      ids: ['m1', 'm2'],
      addLabelIds: ['TRASH'],
    });
  });

  it('is at most BATCH_MODIFY_LIMIT ids per call, per Gmail\'s own ceiling', () => {
    expect(BATCH_MODIFY_LIMIT).toBe(1000);
  });

  it('exists and takes a token, ids and an action', () => {
    expect(typeof batchModifyMessages).toBe('function');
    expect(batchModifyMessages.length).toBe(3);
  });
});

describe('parseAllLabels', () => {
  it('keeps what parseLabels throws away, so a dragged label is findable', () => {
    const out = parseAllLabels({
      labels: [label('SENT', 'SENT', 'system'), label('L1', 'Klanten')],
    });
    expect(out.map((l) => l.id)).toEqual(['SENT', 'L1']);
  });
});

describe('findLabelId', () => {
  const labels = parseAllLabels({
    labels: [label('L1', 'Klanten'), label('L2', 'Klanten/2026'), label('L3', 'Offertes')],
  });

  it('finds a nested label by its full path, the way Gmail writes it in the url', () => {
    expect(findLabelId(labels, 'Klanten/2026')).toBe('L2');
  });

  it('prefers the exact name over a case-insensitive match', () => {
    const both = parseAllLabels({ labels: [label('L1', 'klanten'), label('L2', 'Klanten')] });
    expect(findLabelId(both, 'Klanten')).toBe('L2');
  });

  it('falls back to case-insensitive', () => {
    expect(findLabelId(labels, 'offertes')).toBe('L3');
  });

  it('returns null for a label this account does not have', () => {
    expect(findLabelId(labels, 'Bestaat niet')).toBeNull();
    expect(findLabelId(labels, '  ')).toBeNull();
  });
});

describe('threads urls', () => {
  it('asks for a page of the label', () => {
    expect(threadsListUrl('L1')).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/threads?labelIds=L1&maxResults=100',
    );
  });

  it('carries the page token', () => {
    expect(threadsListUrl('L1', 'abc')).toContain('&pageToken=abc');
  });

  it('asks the thread only for its message ids', () => {
    expect(threadMessagesUrl('t1')).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/threads/t1?format=minimal',
    );
  });

  it('asks messages.get for the source, the only endpoint that has it', () => {
    expect(messageRawUrl('m1')).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1?format=raw',
    );
  });

  it('escapes an id instead of building a broken url', () => {
    expect(threadMessagesUrl('a/b')).toContain('/threads/a%2Fb?');
    expect(messageRawUrl('a/b')).toContain('/messages/a%2Fb?');
  });
});

describe('parseThreadList', () => {
  it('reads the ids and the next page', () => {
    expect(parseThreadList({ threads: [{ id: 't1' }, { id: 't2' }], nextPageToken: 'p2' })).toEqual({
      threadIds: ['t1', 't2'],
      nextPageToken: 'p2',
    });
  });

  it('reports no next page rather than an empty one', () => {
    expect(parseThreadList({ threads: [{ id: 't1' }] })).toEqual({ threadIds: ['t1'] });
    expect(parseThreadList({ threads: [{ id: 't1' }], nextPageToken: '' })).toEqual({
      threadIds: ['t1'],
    });
  });

  it('returns nothing for an empty label or an unexpected response', () => {
    expect(parseThreadList({}).threadIds).toEqual([]);
    expect(parseThreadList(null).threadIds).toEqual([]);
  });
});

describe('parseThreadMessageIds', () => {
  it('keeps the order Gmail gives, so the .eml numbering follows the thread', () => {
    expect(parseThreadMessageIds({ messages: [{ id: 'm1' }, { id: 'm2' }] })).toEqual(['m1', 'm2']);
  });

  it('returns nothing for an unexpected response', () => {
    expect(parseThreadMessageIds({})).toEqual([]);
    expect(parseThreadMessageIds(null)).toEqual([]);
    expect(parseThreadMessageIds({ messages: [{ id: '' }] })).toEqual([]);
  });
});

describe('parseMessageRaw', () => {
  it('decodes the message from base64url', () => {
    const eml = 'Subject: Hoi\r\n\r\nDag.';
    expect(parseMessageRaw({ raw: Buffer.from(eml).toString('base64url') })?.toString('utf8')).toBe(
      eml,
    );
  });

  it('survives the url-safe alphabet', () => {
    const bin = Buffer.from([0xfb, 0xff, 0xbf]);
    expect(parseMessageRaw({ raw: bin.toString('base64url') })).toEqual(bin);
  });

  it('returns null rather than writing an empty file', () => {
    expect(parseMessageRaw({ id: 'm1' })).toBeNull();
    expect(parseMessageRaw({ raw: '' })).toBeNull();
    expect(parseMessageRaw(null)).toBeNull();
  });
});

describe('messageIdQuery', () => {
  it('drops the angle brackets the header carries', () => {
    expect(messageIdQuery('<CAF123@mail.gmail.com>')).toBe('rfc822msgid:CAF123@mail.gmail.com');
  });

  it('copes with a header without brackets or with spacing', () => {
    expect(messageIdQuery(' CAF123@mail.gmail.com ')).toBe('rfc822msgid:CAF123@mail.gmail.com');
  });
});

describe('searchInLabelUrl', () => {
  it('looks for that one message inside that one label', () => {
    const url = new URL(searchInLabelUrl('<a@b.nl>', 'L1'));
    expect(url.pathname).toBe('/gmail/v1/users/me/messages');
    expect(url.searchParams.get('q')).toBe('rfc822msgid:a@b.nl');
    expect(url.searchParams.get('labelIds')).toBe('L1');
    expect(url.searchParams.get('maxResults')).toBe('1');
  });

  it('escapes a message id that would otherwise break the query', () => {
    const url = new URL(searchInLabelUrl('<a+b&c@x.nl>', 'L1'));
    expect(url.searchParams.get('q')).toBe('rfc822msgid:a+b&c@x.nl');
  });
});

describe('parseHasMessage', () => {
  it('is true only when Gmail actually found something', () => {
    expect(parseHasMessage({ messages: [{ id: 'm1' }] })).toBe(true);
    expect(parseHasMessage({ resultSizeEstimate: 0 })).toBe(false);
    expect(parseHasMessage({ messages: [] })).toBe(false);
    expect(parseHasMessage(null)).toBe(false);
  });
});

describe('searchAnywhereUrl', () => {
  it('looks for that one message without narrowing to a label', () => {
    const url = new URL(searchAnywhereUrl('<a@b.nl>'));
    expect(url.pathname).toBe('/gmail/v1/users/me/messages');
    expect(url.searchParams.get('q')).toBe('rfc822msgid:a@b.nl');
    expect(url.searchParams.get('labelIds')).toBeNull();
    expect(url.searchParams.get('maxResults')).toBe(String(SEARCH_MATCH_LIMIT));
  });

  it('leaves spam and trash out, the way the per-label search does', () => {
    const url = new URL(searchAnywhereUrl('<a@b.nl>'));
    expect(url.searchParams.get('includeSpamTrash')).toBeNull();
  });
});

describe('messageLabelsUrl', () => {
  it('asks for the smallest form, since only the labels are wanted', () => {
    const url = new URL(messageLabelsUrl('18f2c'));
    expect(url.pathname).toBe('/gmail/v1/users/me/messages/18f2c');
    expect(url.searchParams.get('format')).toBe('minimal');
  });

  it('escapes a message id that needs it', () => {
    expect(new URL(messageLabelsUrl('a/b')).pathname).toBe('/gmail/v1/users/me/messages/a%2Fb');
  });
});

// Every match rather than the first: one Message-ID can sit in a mailbox twice, once as the
// mail that arrived and once as the copy that was inserted, and only one of the two carries
// the label the picker is asking about.
describe('parseMessageIds', () => {
  it('names every message Gmail found, in the order it named them', () => {
    expect(parseMessageIds({ messages: [{ id: 'm1' }, { id: 'm2' }] })).toEqual(['m1', 'm2']);
  });

  it('is empty when the search found nothing', () => {
    expect(parseMessageIds({ messages: [] })).toEqual([]);
    expect(parseMessageIds({ resultSizeEstimate: 0 })).toEqual([]);
    expect(parseMessageIds(null)).toEqual([]);
  });

  it('skips an entry without a usable id and does not repeat one', () => {
    expect(parseMessageIds({ messages: [{ id: 'm1' }, { id: '' }, {}, { id: 'm1' }] })).toEqual([
      'm1',
    ]);
  });
});

describe('parseMessageLabelIds', () => {
  it('reads the labels the mailbox has this message under', () => {
    expect(parseMessageLabelIds({ id: 'm1', labelIds: ['INBOX', 'L1'] })).toEqual(['INBOX', 'L1']);
  });

  it('returns nothing for a message without labels or an unexpected response', () => {
    expect(parseMessageLabelIds({ id: 'm1' })).toEqual([]);
    expect(parseMessageLabelIds({ labelIds: ['', 'L1'] })).toEqual(['L1']);
    expect(parseMessageLabelIds(null)).toEqual([]);
  });
});

describe('labelsHoldingMessage', () => {
  it('exists and takes a token and a message id', () => {
    expect(typeof labelsHoldingMessage).toBe('function');
    expect(labelsHoldingMessage.length).toBe(2);
  });

  it('answers nothing without a Message-ID, since nothing can be matched', async () => {
    expect(await labelsHoldingMessage('token', '  ')).toEqual([]);
  });
});

describe('pickBoundary', () => {
  it('avoids a boundary the message already contains', () => {
    const tries = ['aaa', 'bbb'];
    const raw = Buffer.from('...gmd-aaa staat in een bijlage...');
    expect(pickBoundary(raw, () => tries.shift() ?? 'ccc')).toBe('gmd-bbb');
  });

  it('gives up on a rand that keeps colliding rather than corrupting the body', () => {
    const raw = Buffer.from('gmd-same');
    expect(pickBoundary(raw, () => 'same')).not.toContain('gmd-same\r');
    expect(raw.includes(pickBoundary(raw, () => 'same'))).toBe(false);
  });
});

describe('multipartBody', () => {
  const raw = Buffer.from('Subject: Hoi\r\n\r\nDag.');
  const body = multipartBody(raw, ['L1', 'INBOX'], 'BOUND').toString('utf8');

  it('sends the labels as metadata, so one insert lands under all of them', () => {
    expect(body).toContain('Content-Type: application/json; charset=UTF-8');
    expect(body).toContain('{"labelIds":["L1","INBOX"]}');
  });

  it('sends the message as rfc822, byte for byte', () => {
    expect(body).toContain('Content-Type: message/rfc822\r\n\r\nSubject: Hoi\r\n\r\nDag.\r\n');
  });

  it('opens and closes the multipart', () => {
    expect(body.startsWith('--BOUND\r\n')).toBe(true);
    expect(body.endsWith('--BOUND--\r\n')).toBe(true);
  });

  it('leaves binary content untouched', () => {
    const bin = Buffer.from([0x00, 0xff, 0x0a, 0x80]);
    const out = multipartBody(bin, [], 'B');
    expect(out.includes(bin)).toBe(true);
  });
});

describe('parseInsertedId', () => {
  it('reads the id the copy got in the other mailbox', () => {
    expect(parseInsertedId({ id: '18f0' })).toBe('18f0');
  });

  it('returns null when the answer has none', () => {
    expect(parseInsertedId({})).toBeNull();
    expect(parseInsertedId({ id: '' })).toBeNull();
    expect(parseInsertedId(null)).toBeNull();
  });
});

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
  // Named headers rather than the whole message: this call is made for every new inbox mail,
  // and the two a notification shows plus the one the duplicate index is keyed on are all of
  // it. A third header on a call already being made is what makes that index free.
  it('asks for the named headers and never for the whole message', () => {
    const url = new URL(messageMetaUrl('m1'));
    expect(url.pathname).toBe('/gmail/v1/users/me/messages/m1');
    expect(url.searchParams.get('format')).toBe('metadata');
    expect(url.searchParams.getAll('metadataHeaders')).toEqual(['From', 'Subject', 'Message-ID']);
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
      messageId: '',
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

describe('archiveMessage', () => {
  it('is the modify endpoint for that message', () => {
    expect(messageModifyUrl('18f2c')).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/18f2c/modify',
    );
  });

  it('escapes a message id that needs it', () => {
    expect(messageModifyUrl('a/b')).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/a%2Fb/modify',
    );
  });

  it('exists and takes a token and a message id', () => {
    expect(typeof archiveMessage).toBe('function');
    expect(archiveMessage.length).toBe(2);
  });
});

describe('inbox unread', () => {
  it('asks the inbox label for its counts', () => {
    expect(labelGetUrl('INBOX')).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX',
    );
  });

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

// Dragging one conversation used to read Gmail's own "show original" page, which renders a
// long thread with its older messages collapsed and their download links gone. The copy was
// then short and said so nowhere: it counted what it had found rather than what the thread
// held, so three of twelve reported itself as three of three. threads.get lists every
// message, and this is what keeps that list intact on the way through.
describe('collectThreadMessages', () => {
  const raw = (s: string) => Buffer.from(s, 'utf8');

  it('returns one entry per message, in the thread order', async () => {
    const out = await collectThreadMessages(['m1', 'm2', 'm3'], async (id) => raw(id));
    expect(out.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(out.every((m) => m.raw !== undefined)).toBe(true);
  });

  it('keeps a message whose source never arrived, rather than dropping it', async () => {
    const out = await collectThreadMessages(['m1', 'm2'], async (id) =>
      id === 'm2' ? null : raw(id),
    );
    expect(out).toHaveLength(2);
    expect(out[1].raw).toBeUndefined();
    expect(out[1].error).toBeTruthy();
  });

  it('keeps going after one message fails, and records why', async () => {
    const out = await collectThreadMessages(['m1', 'm2', 'm3'], async (id) => {
      if (id === 'm2') throw new Error('HTTP 500');
      return raw(id);
    });
    expect(out).toHaveLength(3);
    expect(out[1].error).toContain('HTTP 500');
    expect(out[2].raw?.toString()).toBe('m3');
  });

  it('is empty only when the thread is', async () => {
    expect(await collectThreadMessages([], async () => raw('x'))).toEqual([]);
  });

  it('reads several messages at once, up to the limit it is given', async () => {
    let running = 0;
    let peak = 0;
    await collectThreadMessages(
      ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'],
      async (id) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 1));
        running -= 1;
        return raw(id);
      },
      3,
    );
    expect(peak).toBe(3);
  });

  it('keeps the thread order even when the later messages answer first', async () => {
    const out = await collectThreadMessages(
      ['slow', 'fast'],
      async (id) => {
        await new Promise((r) => setTimeout(r, id === 'slow' ? 20 : 1));
        return raw(id);
      },
      2,
    );
    expect(out.map((m) => m.id)).toEqual(['slow', 'fast']);
  });
});

// Copying a conversation to another mailbox used to arrive there in pieces: Gmail does not
// thread an inserted message on its headers alone, so six replies became six mails. The
// thread the first one landed in is what the rest have to be filed under.
describe('multipartBody — keeping a copied conversation together', () => {
  const raw = Buffer.from('Subject: Hoi\r\n\r\nDag.');

  it('names the thread when one is given', () => {
    const body = multipartBody(raw, ['INBOX'], 'B', 'thread-1').toString('utf8');
    expect(body).toContain('{"labelIds":["INBOX"],"threadId":"thread-1"}');
  });

  it('leaves it out entirely for the first message, which has no thread yet', () => {
    const body = multipartBody(raw, ['INBOX'], 'B').toString('utf8');
    expect(body).toContain('{"labelIds":["INBOX"]}');
    expect(body).not.toContain('threadId');
  });

  it('still carries the message itself unchanged', () => {
    const body = multipartBody(raw, ['INBOX'], 'B', 'thread-1').toString('utf8');
    expect(body).toContain('Content-Type: message/rfc822');
    expect(body).toContain('Subject: Hoi');
  });
});

describe('parseInsertedThreadId', () => {
  it('reads the thread the message landed in', () => {
    expect(parseInsertedThreadId({ id: 'm1', threadId: 't1' })).toBe('t1');
  });

  it('is null when Gmail did not say, so the next message starts its own', () => {
    expect(parseInsertedThreadId({ id: 'm1' })).toBeNull();
    expect(parseInsertedThreadId({ id: 'm1', threadId: '' })).toBeNull();
    expect(parseInsertedThreadId(null)).toBeNull();
  });
});

// Every call in gmail-api.ts goes out through one place, and what that place puts on the wire
// is worth an assertion of its own: an unauthenticated call does not fail loudly, it comes
// back as Google's "Request is missing required authentication credential", which reads like a
// withdrawn client id and sends you auditing your keys instead of your headers.
describe('apiHeaders', () => {
  it('carries the access token as a bearer', () => {
    expect(apiHeaders('ya29.abc')).toEqual({ Authorization: 'Bearer ya29.abc' });
  });

  it('adds the content type only for a call that has a body', () => {
    expect(apiHeaders('ya29.abc', 'multipart/related; boundary=B')).toEqual({
      Authorization: 'Bearer ya29.abc',
      'Content-Type': 'multipart/related; boundary=B',
    });
  });

  it('always names the header, so a call can never go out unauthenticated', () => {
    expect(Object.keys(apiHeaders(''))).toContain('Authorization');
  });
});


describe('batchedMessageIdQuery', () => {
  it('asks for several Message-IDs at once', () => {
    expect(batchedMessageIdQuery(['<a@x>', '<b@x>'])).toBe(
      'rfc822msgid:a@x OR rfc822msgid:b@x',
    );
  });

  it('strips the angle brackets Gmail does not want, as the single query does', () => {
    expect(batchedMessageIdQuery(['<a@x>'])).toBe('rfc822msgid:a@x');
  });

  it('leaves out what is not a Message-ID rather than asking a broken question', () => {
    expect(batchedMessageIdQuery(['<a@x>', '   ', ''])).toBe('rfc822msgid:a@x');
  });
});

describe('messageIdChunks', () => {
  // Gmail stops answering an OR query somewhere around sixteen terms, and answers it with
  // nothing rather than with an error, so the chunk stays well below that
  it('never makes a chunk Gmail would silently drop', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `<${i}@x>`);
    const chunks = messageIdChunks(ids);
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(BATCH_QUERY_LIMIT);
    expect(BATCH_QUERY_LIMIT).toBeLessThan(16);
  });

  it('keeps every id exactly once, in order', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `<${i}@x>`);
    expect(messageIdChunks(ids).flat()).toEqual(ids);
  });

  it('has no chunks for nothing to ask', () => {
    expect(messageIdChunks([])).toEqual([]);
  });
});

describe('searchManyUrl', () => {
  it('asks after the whole chunk plus the canary in one search', () => {
    const url = searchManyUrl(['<a@x>', '<b@x>'], '<canary@x>');
    const q = new URL(url).searchParams.get('q');
    expect(q).toBe('rfc822msgid:a@x OR rfc822msgid:b@x OR rfc822msgid:canary@x');
  });

  // Every asked id may turn up more than once, and the canary takes a slot of its own
  it('leaves room for every mail the chunk could match', () => {
    const url = searchManyUrl(['<a@x>', '<b@x>'], '<canary@x>');
    expect(Number(new URL(url).searchParams.get('maxResults'))).toBeGreaterThanOrEqual(3);
  });
});

describe('parseMessageIdAndLabels', () => {
  const json = (headers: Array<[string, string]>, labelIds: string[]) => ({
    id: 'm1',
    labelIds,
    payload: { headers: headers.map(([name, value]) => ({ name, value })) },
  });

  it('reads the Message-ID and the labels out of one metadata answer', () => {
    expect(parseMessageIdAndLabels(json([['Message-ID', '<a@x>']], ['INBOX', 'L1']))).toEqual({
      messageId: '<a@x>',
      labelIds: ['INBOX', 'L1'],
    });
  });

  // Gmail is inconsistent about the case of this header name
  it('finds the header whatever case it arrives in', () => {
    expect(parseMessageIdAndLabels(json([['Message-Id', '<a@x>']], []))?.messageId).toBe('<a@x>');
  });

  it('is null without a Message-ID, since there is nothing to match on', () => {
    expect(parseMessageIdAndLabels(json([['Subject', 'hoi']], ['INBOX']))).toBeNull();
  });

  it('is null for junk', () => {
    expect(parseMessageIdAndLabels(null)).toBeNull();
  });
});

describe('scanFromBatch', () => {
  const hit = (messageId: string, labelIds: string[]) => ({ messageId, labelIds });
  const canary = '<canary@x>';

  it('trusts the answer once the canary came back with it', () => {
    const out = scanFromBatch(['<a@x>', '<b@x>'], [hit(canary, ['INBOX']), hit('<a@x>', ['L1'])], canary);
    expect(out.trusted).toBe(true);
    expect(out.found).toEqual([
      { messageId: '<a@x>', labelIds: ['L1'] },
      { messageId: '<b@x>', labelIds: [] },
    ]);
  });

  // The whole reason the canary is in the query: Gmail answers a query it did not understand
  // with nothing, which reads exactly like "this mailbox has none of them"
  it('refuses to read an answer the canary is missing from', () => {
    const out = scanFromBatch(['<a@x>', '<b@x>'], [], canary);
    expect(out.trusted).toBe(false);
    expect(out.found).toEqual([]);
  });

  it('does not let a hit stand in for the canary', () => {
    const out = scanFromBatch(['<a@x>'], [hit('<a@x>', ['L1'])], canary);
    expect(out.trusted).toBe(false);
  });

  // Headers arrive with and without the brackets, and both name the same mail
  it('matches a Message-ID whether or not it wears its brackets', () => {
    const out = scanFromBatch(['<a@x>'], [hit('canary@x', []), hit('a@x', ['L1'])], canary);
    expect(out.trusted).toBe(true);
    expect(out.found).toEqual([{ messageId: '<a@x>', labelIds: ['L1'] }]);
  });

  it('unions the labels when a mailbox holds the same mail twice', () => {
    const out = scanFromBatch(
      ['<a@x>'],
      [hit(canary, []), hit('<a@x>', ['L1']), hit('<a@x>', ['L2', 'L1'])],
      canary,
    );
    expect(out.found).toEqual([{ messageId: '<a@x>', labelIds: ['L1', 'L2'] }]);
  });

  // Without a canary there is nothing to prove the query with, so nothing may be believed
  it('trusts nothing when there is no canary to ask about', () => {
    expect(scanFromBatch(['<a@x>'], [hit('<a@x>', ['L1'])], '').trusted).toBe(false);
  });
});

describe('parseMessageMeta, the Message-ID it now also carries', () => {
  // The sync already fetches headers for every new inbox mail, so this one rides along free
  // and is what the duplicate index is keyed on
  it('reads the Message-ID off the same answer', () => {
    const meta = parseMessageMeta({
      id: 'm1',
      threadId: 't1',
      internalDate: '1700000000000',
      payload: {
        headers: [
          { name: 'From', value: 'a@x.nl' },
          { name: 'Subject', value: 'hoi' },
          { name: 'Message-ID', value: '<a@x>' },
        ],
      },
    });
    expect(meta?.messageId).toBe('<a@x>');
  });

  it('is an empty Message-ID when the header did not come along', () => {
    const meta = parseMessageMeta({
      id: 'm1',
      threadId: 't1',
      internalDate: '1700000000000',
      payload: { headers: [{ name: 'From', value: 'a@x.nl' }] },
    });
    expect(meta?.messageId).toBe('');
  });

  it('asks Gmail for the header, or it would never arrive', () => {
    expect(MESSAGE_META_HEADERS).toContain('Message-ID');
  });
});

describe('visibleLabelCreateBody', () => {
  it('asks for a label the user can actually see', () => {
    expect(JSON.parse(visibleLabelCreateBody('Klanten/Acme'))).toEqual({
      name: 'Klanten/Acme',
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    });
  });

  it('differs from the hidden marker body', () => {
    expect(visibleLabelCreateBody('X')).not.toBe(labelCreateBody('X'));
  });
});

describe('userLabelMap', () => {
  it('keeps only the user own labels, not the system ones', () => {
    const map = userLabelMap([
      { id: 'Label_1', name: 'Klanten', type: 'user', labelListVisibility: '' },
      { id: 'INBOX', name: 'INBOX', type: 'system', labelListVisibility: '' },
    ]);
    expect([...map]).toEqual([['Klanten', 'Label_1']]);
  });

  it('drops this app own run markers', () => {
    const marker = {
      id: 'Label_9',
      name: markerLabelName('run-1'),
      type: 'user',
      labelListVisibility: '',
    };
    expect(userLabelMap([marker]).size).toBe(0);
  });
});
