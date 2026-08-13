// A colleague installed the app and nothing worked: no consent screen when an account was
// added, no status under the name, no banner. The OAuth config lives in userData and holds
// a client secret, so the installer cannot ship it — and every path that needs it gives up
// quietly when it is missing, so the app looked healthy and did nothing.
//
// The panel can now import one. These tests are about what it accepts. The one that matters
// most is the pass-through: relayUrl and pushTopic live in the same file and are what make
// push notifications work, so a validator that rebuilt the file from the two fields it
// checks would produce a machine that links accounts and then never notifies about them —
// a worse failure than the one being fixed, because it looks like success.

import { describe, expect, it } from 'vitest';
import { checkOAuthConfigFile } from '../electron/auth/oauth-config-file';

const full = JSON.stringify({
  clientId: '1234-abc.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-secret',
  relayUrl: 'wss://relay.example',
  pushTopic: 'projects/p/topics/t',
});

describe('checkOAuthConfigFile', () => {
  it('accepts a config with both required fields', () => {
    const r = checkOAuthConfigFile(full);
    expect(r.ok).toBe(true);
  });

  it('passes the file through verbatim, so push settings survive the import', () => {
    const r = checkOAuthConfigFile(full);
    expect(r.ok && r.text).toBe(full);
    // The point stated as the property it protects:
    const written = JSON.parse((r as { text: string }).text);
    expect(written.relayUrl).toBe('wss://relay.example');
    expect(written.pushTopic).toBe('projects/p/topics/t');
  });

  it('keeps keys it has no opinion about', () => {
    const withExtra = JSON.stringify({
      clientId: 'a',
      clientSecret: 'b',
      somethingAddedLater: { nested: true },
    });
    const r = checkOAuthConfigFile(withExtra);
    expect(r.ok).toBe(true);
    expect(JSON.parse((r as { text: string }).text).somethingAddedLater).toEqual({ nested: true });
  });

  it('rejects a file that is not JSON at all', () => {
    expect(checkOAuthConfigFile('not json').ok).toBe(false);
    expect(checkOAuthConfigFile('').ok).toBe(false);
  });

  it('rejects JSON that is not an object', () => {
    expect(checkOAuthConfigFile('[]').ok).toBe(false);
    expect(checkOAuthConfigFile('"a string"').ok).toBe(false);
    expect(checkOAuthConfigFile('null').ok).toBe(false);
    expect(checkOAuthConfigFile('42').ok).toBe(false);
  });

  it('rejects a config missing either required field', () => {
    expect(checkOAuthConfigFile(JSON.stringify({ clientId: 'a' })).ok).toBe(false);
    expect(checkOAuthConfigFile(JSON.stringify({ clientSecret: 'b' })).ok).toBe(false);
    expect(checkOAuthConfigFile(JSON.stringify({})).ok).toBe(false);
  });

  // An empty string passes a `typeof x === 'string'` check and then fails at Google with an
  // error nobody can act on, so it is rejected here where the message can be useful.
  it('rejects blank and whitespace-only credentials', () => {
    expect(checkOAuthConfigFile(JSON.stringify({ clientId: '', clientSecret: 'b' })).ok).toBe(false);
    expect(checkOAuthConfigFile(JSON.stringify({ clientId: 'a', clientSecret: '   ' })).ok).toBe(
      false,
    );
  });

  // The file a person actually has after creating a client in the Cloud console. Refusing
  // it would mean refusing the obvious thing and asking for a hand-written translation.
  it("accepts Google's own download for a desktop client", () => {
    const download = JSON.stringify({
      installed: {
        client_id: '551331329724-abc.apps.googleusercontent.com',
        project_id: 'app-gmail-desktop',
        client_secret: 'GOCSPX-downloaded',
        redirect_uris: ['http://localhost'],
      },
    });
    const r = checkOAuthConfigFile(download);
    expect(r.ok).toBe(true);
    const written = JSON.parse((r as { text: string }).text);
    expect(written.clientId).toBe('551331329724-abc.apps.googleusercontent.com');
    expect(written.clientSecret).toBe('GOCSPX-downloaded');
  });

  it("accepts the 'web' wrapper too, since that is the other shape Google emits", () => {
    const r = checkOAuthConfigFile(
      JSON.stringify({ web: { client_id: 'a.apps.googleusercontent.com', client_secret: 'b' } }),
    );
    expect(r.ok).toBe(true);
    expect(JSON.parse((r as { text: string }).text).clientId).toBe('a.apps.googleusercontent.com');
  });

  // Our own shape must still pass through untouched — converting it would drop relayUrl
  // and pushTopic, which is the whole reason the pass-through exists.
  it('prefers our own shape and leaves it verbatim when both could apply', () => {
    const ours = JSON.stringify({
      clientId: 'ours',
      clientSecret: 'ours-secret',
      relayUrl: 'ws://localhost:8099',
      installed: { client_id: 'theirs', client_secret: 'theirs-secret' },
    });
    const r = checkOAuthConfigFile(ours);
    expect(r.ok && r.text).toBe(ours);
    expect(JSON.parse((r as { text: string }).text).relayUrl).toBe('ws://localhost:8099');
  });

  it('rejects a Google download that is missing half of its credentials', () => {
    expect(checkOAuthConfigFile(JSON.stringify({ installed: { client_id: 'a' } })).ok).toBe(false);
    expect(checkOAuthConfigFile(JSON.stringify({ installed: {} })).ok).toBe(false);
  });

  it('rejects credentials of the wrong type', () => {
    expect(checkOAuthConfigFile(JSON.stringify({ clientId: 1, clientSecret: 'b' })).ok).toBe(false);
    expect(
      checkOAuthConfigFile(JSON.stringify({ clientId: 'a', clientSecret: ['b'] })).ok,
    ).toBe(false);
  });
});
