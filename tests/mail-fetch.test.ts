// Fetching original messages: the om URL and the message ids parsed out of it.

import { describe, it, expect } from 'vitest';
import {
  omUrl,
  parseOriginalLinks,
  parsePermMsgIds,
  permMsgIdFromLink,
} from '../electron/mail/mail-fetch';

describe('omUrl', () => {
  it('builds the show-original url for a thread', () => {
    expect(omUrl({ authuser: '2', ik: 'abc123', threadId: '18f2a' })).toBe(
      'https://mail.google.com/mail/u/2/?ik=abc123&view=om&th=18f2a',
    );
  });
  it('adds permmsgid when given, url-encoded', () => {
    expect(omUrl({ authuser: '0', ik: 'abc', threadId: 't', permMsgId: 'msg-f:123' })).toBe(
      'https://mail.google.com/mail/u/0/?ik=abc&view=om&th=t&permmsgid=msg-f%3A123',
    );
  });
});

describe('parseOriginalLinks', () => {
  it('finds download-original links and makes them absolute', () => {
    const html = `<a href="?view=att&amp;th=18f2a&amp;attid=0&amp;disp=comp&amp;safe=1&amp;zw">Download</a>`;
    expect(parseOriginalLinks(html, '2')).toEqual([
      'https://mail.google.com/mail/u/2/?view=att&th=18f2a&attid=0&disp=comp&safe=1&zw',
    ]);
  });

  it('keeps an already absolute link as is', () => {
    const html = `<a href="https://mail.google.com/mail/u/0/?view=att&amp;th=x&amp;disp=comp">Download</a>`;
    expect(parseOriginalLinks(html, '0')).toEqual([
      'https://mail.google.com/mail/u/0/?view=att&th=x&disp=comp',
    ]);
  });

  it('returns every link in page order without duplicates', () => {
    const html = `
      <a href="?view=att&amp;th=a&amp;disp=comp">1</a>
      <a href="?view=att&amp;th=b&amp;disp=comp">2</a>
      <a href="?view=att&amp;th=a&amp;disp=comp">1 nogmaals</a>`;
    expect(parseOriginalLinks(html, '0')).toEqual([
      'https://mail.google.com/mail/u/0/?view=att&th=a&disp=comp',
      'https://mail.google.com/mail/u/0/?view=att&th=b&disp=comp',
    ]);
  });

  it('ignores attachment links that are not the original message', () => {
    const html = `<a href="?view=att&amp;th=a&amp;attid=0.1&amp;disp=inline">plaatje</a>`;
    expect(parseOriginalLinks(html, '0')).toEqual([]);
  });

  it('returns an empty list for html without links', () => {
    expect(parseOriginalLinks('<html><body>niets</body></html>', '0')).toEqual([]);
  });
});

describe('parsePermMsgIds', () => {
  it('collects message ids in page order without duplicates', () => {
    const html = `permmsgid=msg-f%3A111 ... permmsgid=msg-f:222 ... permmsgid=msg-f:111`;
    expect(parsePermMsgIds(html)).toEqual(['msg-f:111', 'msg-f:222']);
  });
  it('returns an empty list when there are none', () => {
    expect(parsePermMsgIds('<html></html>')).toEqual([]);
  });
});

// Which message a downloaded original is, so a drag that started on one message can tell
// it apart from the replies that came after it.
describe('permMsgIdFromLink', () => {
  it('reads the message id out of a download link', () => {
    expect(permMsgIdFromLink('https://mail.google.com/mail/u/0/?view=att&th=a&permmsgid=msg-f:111&disp=comp')).toBe(
      'msg-f:111',
    );
  });
  it('decodes an encoded colon', () => {
    expect(permMsgIdFromLink('?view=att&permmsgid=msg-f%3A111&disp=comp')).toBe('msg-f:111');
  });
  it('is null for a link that names no message', () => {
    expect(permMsgIdFromLink('?view=att&th=a&disp=comp')).toBeNull();
  });
});
