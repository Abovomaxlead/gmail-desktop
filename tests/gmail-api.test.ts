import { describe, it, expect } from 'vitest';
import {
  parseLabels,
  parseAllLabels,
  findLabelId,
  multipartBody,
  pickBoundary,
  parseInsertedId,
  parseThreadList,
  parseThreadMessageIds,
  parseMessageRaw,
  threadsListUrl,
  threadMessagesUrl,
  messageRawUrl,
  messageIdQuery,
  searchInLabelUrl,
  parseHasMessage,
} from '../electron/gmail-api';

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

  // threads.get kent geen format=raw — alleen full/metadata/minimal. Vragen we
  // daar toch "raw", dan antwoordt Google met een 400 en levert de labelsleep
  // niets op. De bron komt daarom van messages.get.
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
    // Bytes die in gewoon base64 een '+' en een '/' opleveren.
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
    // Bestaat-of-niet is genoeg; de rest van de treffers hoeven we niet.
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
    // Een zoekopdracht zonder treffers laat `messages` weg, hij komt niet leeg terug.
    expect(parseHasMessage({ resultSizeEstimate: 0 })).toBe(false);
    expect(parseHasMessage({ messages: [] })).toBe(false);
    expect(parseHasMessage(null)).toBe(false);
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
