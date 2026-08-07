// Does domain-wide delegation actually work yet?
//
// Granting DWD in the Workspace admin console is not instant — it propagates, and until it
// has, Google answers `unauthorized_client`, which reads like a misconfiguration rather than
// "come back later". So this is built to be run repeatedly: it says which of the three
// states you are in, and the difference matters because two of them need you to change
// something and one needs you to wait.
//
// Usage:
//   node scripts/check-dwd.mjs <service-account-key.json> <mailbox@yourdomain>
//
// It mints a token for the target mailbox and asks Gmail whose mailbox `me` is. That is the
// sharpest possible check: a token that mints fine but comes back with YOUR address means
// the `sub` claim did not take effect, and anything writing through it would land silently
// in the wrong mailbox. Read-only — it calls users/me/profile and nothing else.
//
// Nothing is logged that would leak the key: no assertion, no access token, no private key.

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

// Must match SCOPES in electron/google-oauth.ts — these are the scopes that have to be
// authorised for the service account's client ID in the admin console. Authorising a
// different set is the other common reason for `unauthorized_client`.
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.insert',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
];

const [keyPath, target] = process.argv.slice(2);
if (!keyPath || !target) {
  console.error('Usage: node scripts/check-dwd.mjs <service-account-key.json> <mailbox@domain>');
  process.exit(2);
}

let key;
try {
  key = JSON.parse(readFileSync(keyPath, 'utf8'));
} catch (e) {
  console.error(`Cannot read the key at ${keyPath}: ${e.message}`);
  process.exit(2);
}
if (key.type !== 'service_account' || !key.client_email || !key.private_key) {
  console.error('That file is not a service account key (needs type, client_email, private_key).');
  console.error('Download it from Google Cloud → IAM & Admin → Service Accounts → Keys.');
  process.exit(2);
}

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const now = Math.floor(Date.now() / 1000);
const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
const claims = b64url(
  JSON.stringify({
    iss: key.client_email,
    sub: target, // the impersonation — this is the whole point of DWD
    scope: SCOPES.join(' '),
    aud: key.token_uri ?? 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }),
);
const signer = createSign('RSA-SHA256');
signer.update(`${header}.${claims}`);
const assertion = `${header}.${claims}.${b64url(signer.sign(key.private_key))}`;

console.log(`service account : ${key.client_email}`);
console.log(`client id       : ${key.client_id ?? '(not in key file)'}`);
console.log(`impersonating   : ${target}`);
console.log(`scopes          : ${SCOPES.length} requested\n`);

const tokenRes = await fetch(key.token_uri ?? 'https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  }),
});
const tokenJson = await tokenRes.json().catch(() => ({}));

if (!tokenRes.ok) {
  const err = tokenJson.error ?? `HTTP ${tokenRes.status}`;
  const desc = tokenJson.error_description ?? '';
  console.log(`RESULT: no token — ${err}${desc ? ` (${desc})` : ''}\n`);
  if (err === 'unauthorized_client') {
    console.log('This is the "not yet" answer, and it has two causes that look identical:');
    console.log('  1. The grant is still propagating. It can take a while; just run this again.');
    console.log('  2. The scopes authorised in the admin console do not match the ones above.');
    console.log('     Admin console → Security → API controls → Domain-wide delegation.');
    console.log(`     The client ID there must be the service account's: ${key.client_id ?? '(see the key file)'}`);
    console.log('     The scopes must be listed exactly, comma separated, no spaces.');
  } else if (err === 'invalid_grant') {
    console.log(`Google accepted the key but not the impersonation of ${target}.`);
    console.log('Usually: that mailbox does not exist, or it is not in the delegating domain.');
  }
  process.exit(1);
}

const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
  headers: { Authorization: `Bearer ${tokenJson.access_token}` },
});
const profile = await profileRes.json().catch(() => ({}));

if (!profileRes.ok) {
  console.log(`RESULT: token minted, but Gmail refused it — ${profile?.error?.message ?? profileRes.status}`);
  console.log('A token that mints but cannot call Gmail usually means the Gmail API is not');
  console.log('enabled on the project, or the scope set is narrower than it looks.');
  process.exit(1);
}

const got = profile.emailAddress;
if (got?.toLowerCase() !== target.toLowerCase()) {
  console.log(`RESULT: WRONG MAILBOX — asked for ${target}, got ${got}`);
  console.log('The sub claim did not take effect, so anything written through this token');
  console.log('would land in the wrong mailbox. Do not use it until this reads correctly.');
  process.exit(1);
}

console.log(`RESULT: domain-wide delegation works for ${got}`);
console.log(`        ${profile.messagesTotal} messages, historyId ${profile.historyId}`);
