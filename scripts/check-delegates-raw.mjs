// What users.settings.delegates.list actually returns, verbatim.
//
// Here to settle one question with the response rather than with an argument: the opaque id
// in `/mail/u/<n>/d/<id>/` is not in it, and no field of it is a URL. The endpoint answers
// "who may act on this mailbox" — addresses and a verification status — which is exactly what
// the relay needs to decide access, and exactly not what a web view needs to open one.
//
// Prints the raw JSON, unfiltered. Also prints whose mailbox the token turned out to be,
// because a delegates list read against the wrong mailbox would look just as convincing.

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

const [keyPath, mailbox] = process.argv.slice(2);
if (!keyPath || !mailbox) {
  console.error('Usage: node scripts/check-delegates-raw.mjs <key.json> <mailbox@domain>');
  process.exit(2);
}

const key = JSON.parse(readFileSync(keyPath, 'utf8'));
const b64url = (b) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const TOKEN_URI = key.token_uri ?? 'https://oauth2.googleapis.com/token';

const now = Math.floor(Date.now() / 1000);
const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
const payload = b64url(
  JSON.stringify({
    iss: key.client_email,
    sub: mailbox,
    scope: SCOPES.join(' '),
    aud: TOKEN_URI,
    iat: now,
    exp: now + 3600,
  }),
);
const signer = createSign('RSA-SHA256');
signer.update(`${header}.${payload}`);
const assertion = `${header}.${payload}.${b64url(signer.sign(key.private_key))}`;

const tokenRes = await fetch(TOKEN_URI, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
});
const tokenJson = await tokenRes.json().catch(() => ({}));
if (!tokenRes.ok) {
  console.error(`mint failed: ${tokenJson.error ?? tokenRes.status}`);
  process.exit(1);
}
const auth = { Authorization: `Bearer ${tokenJson.access_token}` };

const profRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: auth });
const prof = await profRes.json().catch(() => ({}));
console.log(`asked for  : ${mailbox}`);
console.log(`me really is: ${prof.emailAddress ?? '(unknown)'}`);
if ((prof.emailAddress ?? '').toLowerCase() !== mailbox.toLowerCase()) {
  console.log('\nSTOP: the sub claim did not take effect, so everything below is the wrong mailbox.');
  process.exit(1);
}

const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/settings/delegates', {
  headers: auth,
});
const body = await res.json().catch(() => ({}));
console.log(`\nGET users/me/settings/delegates -> ${res.status}\n`);
console.log(JSON.stringify(body, null, 2));
console.log('\nEvery field the endpoint has is above. No id, no url, nothing to open a view with.');
