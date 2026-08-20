// Packing many small Gmail reads into one HTTP request, and taking the answers apart again.
// All of it is string work, so none of it needs a network.

import { describe, it, expect } from 'vitest';
import {
  BATCH_URL,
  BATCH_LIMIT,
  RAW_BATCH_LIMIT,
  batchPath,
  batchBody,
  boundaryFrom,
  parseBatchBody,
  batchLooksBroken,
} from '../electron/gmail/batch';

describe('batchPath', () => {
  // Documented: an inner request carries the path only, never the whole URL
  it('keeps the path and the query and drops the host', () => {
    expect(batchPath('https://gmail.googleapis.com/gmail/v1/users/me/messages/m1?format=raw')).toBe(
      '/gmail/v1/users/me/messages/m1?format=raw',
    );
  });

  it('leaves a path that is already a path alone', () => {
    expect(batchPath('/gmail/v1/users/me/labels')).toBe('/gmail/v1/users/me/labels');
  });
});

describe('batchBody', () => {
  const body = batchBody(['/gmail/v1/users/me/messages/m1', '/gmail/v1/users/me/messages/m2'], 'B');

  it('opens every part with the boundary and closes with the end marker', () => {
    expect(body.startsWith('--B\r\n')).toBe(true);
    expect(body.endsWith('--B--\r\n')).toBe(true);
  });

  it('declares each part as an http request', () => {
    expect(body.split('Content-Type: application/http').length - 1).toBe(2);
  });

  // The answers come back in any order, so each part is named and matched on that name
  it('names each part so its answer can be found again', () => {
    expect(body).toContain('Content-ID: <0>');
    expect(body).toContain('Content-ID: <1>');
  });

  it('writes each part as a GET of the path', () => {
    expect(body).toContain('GET /gmail/v1/users/me/messages/m1 HTTP/1.1');
    expect(body).toContain('GET /gmail/v1/users/me/messages/m2 HTTP/1.1');
  });

  it('carries no Authorization of its own, since the outer request has it', () => {
    expect(body).not.toContain('Authorization');
  });
});

describe('boundaryFrom', () => {
  it('reads the boundary Google answered with', () => {
    expect(boundaryFrom('multipart/mixed; boundary=batch_abc123')).toBe('batch_abc123');
  });

  it('copes with the quoted form', () => {
    expect(boundaryFrom('multipart/mixed; boundary="batch_abc123"')).toBe('batch_abc123');
  });

  it('is empty for a content type that is not a multipart answer', () => {
    expect(boundaryFrom('application/json')).toBe('');
    expect(boundaryFrom(undefined)).toBe('');
  });
});

describe('parseBatchBody', () => {
  const reply = [
    '--BND',
    'Content-Type: application/http',
    'Content-ID: response-0',
    '',
    'HTTP/1.1 200 OK',
    'Content-Type: application/json',
    '',
    '{"id":"m1","labelIds":["INBOX"]}',
    '--BND',
    'Content-Type: application/http',
    'Content-ID: response-1',
    '',
    'HTTP/1.1 404 Not Found',
    'Content-Type: application/json',
    '',
    '{"error":{"message":"Not Found"}}',
    '--BND--',
    '',
  ].join('\r\n');

  it('gives one answer per part, by the name the request gave it', () => {
    const parts = parseBatchBody(reply, 'BND');
    expect(parts.map((p) => p.id)).toEqual(['0', '1']);
  });

  it('reads the status of each answer apart from the others', () => {
    const parts = parseBatchBody(reply, 'BND');
    expect(parts[0].status).toBe(200);
    expect(parts[1].status).toBe(404);
  });

  it('parses the body of an answer that came back whole', () => {
    expect(parseBatchBody(reply, 'BND')[0].json).toEqual({ id: 'm1', labelIds: ['INBOX'] });
  });

  // One part failing says nothing about the others, which is the point of reading them apart
  it('keeps a failed answer as a failure rather than as data', () => {
    const failed = parseBatchBody(reply, 'BND')[1];
    expect(failed.status).toBe(404);
    expect(failed.json).toBeNull();
  });

  it('answers with the parts it could read when the reply is truncated', () => {
    expect(parseBatchBody('--BND\r\ngarbage\r\n--BND--\r\n', 'BND')).toEqual([]);
  });

  it('has nothing to give for an empty reply', () => {
    expect(parseBatchBody('', 'BND')).toEqual([]);
  });

  // Blank lines are legal between JSON tokens, and Google pretty-prints. Splitting on every
  // blank line instead of on the first would cut the body in half.
  it('does not stop reading a body at a blank line inside it', () => {
    const withBlank = [
      '--BND',
      'Content-Type: application/http',
      'Content-ID: response-0',
      '',
      'HTTP/1.1 200 OK',
      'Content-Type: application/json',
      '',
      '{',
      '  "a": 1,',
      '',
      '  "b": 2',
      '}',
      '--BND--',
      '',
    ].join('\r\n');
    expect(parseBatchBody(withBlank, 'BND')[0].json).toEqual({ a: 1, b: 2 });
  });
});

describe('the batch endpoint and its sizes', () => {
  it('posts to the Gmail-only batch path, not the retired global one', () => {
    expect(BATCH_URL).toBe('https://gmail.googleapis.com/batch/gmail/v1');
  });

  // Google allows a hundred and advises against more than fifty
  it('never packs more than Google advises', () => {
    expect(BATCH_LIMIT).toBeLessThanOrEqual(50);
  });

  // A batch of whole messages is megabytes per part, so those go in far smaller groups
  it('keeps groups of whole messages much smaller than groups of metadata', () => {
    expect(RAW_BATCH_LIMIT).toBeLessThan(BATCH_LIMIT);
  });
});

describe('batchLooksBroken', () => {
  // This code has never run against Gmail. If the multipart answer turns out not to parse, the
  // symptom is every part coming back empty, and the cure is the one-by-one path that worked
  // before -- slower, but right.
  it('calls a batch broken when it asked for answers and got none', () => {
    expect(batchLooksBroken([null, null])).toBe(true);
  });

  it('trusts a batch that answered anything at all', () => {
    expect(batchLooksBroken([null, { id: 'm1' }])).toBe(false);
  });

  it('does not call an empty batch broken', () => {
    expect(batchLooksBroken([])).toBe(false);
  });
});
