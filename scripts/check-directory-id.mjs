// Does the Directory API's immutable user id fit in Gmail's delegation URL?
//
// The Admin SDK does return a stable opaque id per user — `id` on a users.get, unchanged when
// the address or the name changes. That is real and it is what the documentation means. The
// question this script exists to settle is whether it is the SAME id as the one in
// `/mail/u/<n>/d/<token>/`, because the two are described with the same words and are not
// obviously different until you put them side by side.
//
// Prints both, and the delegation token this app has actually captured, so the comparison is
// on real values rather than on recollection.

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const SCOPE = 'https://www.googleapis.com/auth/admin.directory.user.readonly';

const [keyPath, subject, target] = process.argv.slice(2);
if (!keyPath || !subject || !target) {
  console.error('Usage: node scripts/check-directory-id.mjs <key.json> <admin@domain> <mailbox@domain>');
  process.exit(2);
}

const key = JSON.parse(readFileSync(keyPath, 'utf8'));
const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const TOKEN_URI = key.token_uri ?? 'https://oauth2.googleapis.com/token';

const now = Math.floor(Date.now() / 1000);
const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
const payload = b64url(
  JSON.stringify({ iss: key.client_email, sub: subject, scope: SCOPE, aud: TOKEN_URI, iat: now, exp: now + 3600 }),
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

const res = await fetch(
  `https://admin.googleapis.com/admin/directory/v1/users/${encodeURIComponent(target)}?projection=basic`,
  { headers: { Authorization: `Bearer ${tokenJson.access_token}` } },
);
const user = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`users.get failed: ${user?.error?.message ?? res.status}`);
  process.exit(1);
}

console.log(`mailbox            : ${user.primaryEmail}`);
console.log(`directory id       : ${user.id}`);
console.log(`  length           : ${String(user.id).length}, ${/^\d+$/.test(String(user.id)) ? 'digits only' : 'mixed'}`);
console.log('');
console.log('A delegation token this app has actually captured, for comparison:');
console.log('  AEoRXRTYOddZV924KXKu6a5zD9bNp1IJo1ctbL1EvLsatGZu6d_R');
console.log('  length           : 52, mixed case with - and _');
console.log('');
console.log('If those two do not look like the same kind of string, they are not, and the');
console.log('directory id will not work in the URL. Try it anyway — paste this in a tab where');
console.log('you are signed in, and watch for your OWN mailbox opening, which is how this');
console.log('fails rather than with an error:');
console.log('');
console.log(`  https://mail.google.com/mail/u/0/d/${user.id}/`);
