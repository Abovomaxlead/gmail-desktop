// Does domain-wide delegation actually work yet, and if not, which of the several very
// different causes is it?
//
// Google answers `unauthorized_client` to all of them, which is the whole problem: a grant
// that is still propagating, a client ID that was never registered, and a scope list that
// does not match are one word from the outside, and two of them need you to change
// something while the third needs you to wait.
//
// So this asks three questions instead of one:
//
//   1. Can the key mint a token with no `sub` at all? That involves no delegation, so a
//      failure here is the key, the account or the clock — not the Workspace.
//   2. Can it mint one *with* `sub` for the full scope set?
//   3. If not, can it for each scope on its own? A registered client ID with the wrong
//      scopes still works for the scopes it does have, so any single success means the
//      entry exists and the list is wrong. Every scope failing means the entry is not
//      being matched at all.
//
// Then, on success, it asks Gmail whose mailbox `me` is — a token that mints fine but comes
// back with the wrong address means the `sub` claim did not take effect, and anything
// written through it would land in the wrong mailbox.
//
// Read-only. Nothing is logged that would leak the key: no assertion, no token.

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

// Must match SCOPES in electron/google-oauth.ts.
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

const TOKEN_URI = key.token_uri ?? 'https://oauth2.googleapis.com/token';

/** Mints a token. `subject` null means no impersonation, which needs no delegation at all. */
async function mint(scopes, subject) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = {
    iss: key.client_email,
    scope: scopes.join(' '),
    aud: TOKEN_URI,
    iat: now,
    exp: now + 3600,
  };
  if (subject) claims.sub = subject;
  const payload = b64url(JSON.stringify(claims));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const assertion = `${header}.${payload}.${b64url(signer.sign(key.private_key))}`;

  let res;
  try {
    res = await fetch(TOKEN_URI, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
  } catch (e) {
    return { ok: false, error: `unreachable: ${e.message}` };
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: String(json.error ?? `HTTP ${res.status}`), description: json.error_description };
  return { ok: true, accessToken: json.access_token };
}

const CLIENT_ID = key.client_id ?? '(not in the key file)';

console.log(`service account : ${key.client_email}`);
console.log(`project         : ${key.project_id ?? '(none in key)'}`);
console.log(`client id       : ${CLIENT_ID}`);
console.log(`impersonating   : ${target}\n`);

// 1. No delegation involved.
const bare = await mint(['https://www.googleapis.com/auth/cloud-platform'], null);
console.log(`key alone, no sub          ${bare.ok ? 'OK' : `FAILED — ${bare.error}`}`);
if (!bare.ok) {
  console.log('\nRESULT: the key itself cannot mint a token, so this is not a delegation problem.');
  console.log('Check that the key has not been disabled or deleted, and that the clock is right —');
  console.log('an assertion is rejected if the machine is more than a few minutes off.');
  process.exit(1);
}

// 2. The real request.
const full = await mint(SCOPES, target);
console.log(`all ${SCOPES.length} scopes with sub      ${full.ok ? 'OK' : `FAILED — ${full.error}`}`);

if (!full.ok) {
  // 3. Which, if any, are actually granted.
  console.log('\nper scope, to tell a missing registration from a wrong scope list:');
  const granted = [];
  for (const scope of SCOPES) {
    const one = await mint([scope], target);
    if (one.ok) granted.push(scope);
    console.log(`  ${scope.replace('https://www.googleapis.com/auth/', '').padEnd(18)} ${one.ok ? 'OK' : one.error}`);
  }

  // Every required scope failing does NOT prove the entry is missing: if what is
  // registered has no overlap with what we ask for, the answer is identical. That mistake
  // sent someone hunting for a missing console entry that was there all along, holding one
  // unrelated scope. So before concluding anything, ask what this client ID *can* have.
  let alsoGranted = [];
  if (granted.length === 0) {
    const PROBES = [
      'https://mail.google.com/',
      'https://www.googleapis.com/auth/gmail.settings.basic',
      'https://www.googleapis.com/auth/gmail.settings.sharing',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.labels',
      'https://www.googleapis.com/auth/gmail.metadata',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/admin.directory.user.readonly',
    ];
    process.stdout.write('\nnone of the required scopes worked — probing for any other');
    for (const scope of PROBES) {
      const one = await mint([scope], target);
      process.stdout.write('.');
      if (one.ok) alsoGranted.push(scope);
    }
    console.log('');
    if (alsoGranted.length > 0) {
      console.log('found:');
      for (const s of alsoGranted) console.log(`  ${s}`);
    }
  }

  console.log('');
  if (granted.length === 0 && alsoGranted.length > 0) {
    console.log('RESULT: the client ID IS registered — with different scopes.');
    console.log('');
    console.log('The entry exists and has propagated; it simply grants none of the scopes this');
    console.log('app asks for. Edit that same entry and add these, keeping what is already there:');
    console.log('');
    for (const s of SCOPES) console.log(`  ${s}`);
    console.log('');
    console.log('All of them in one comma separated list, no spaces:');
    console.log(`  ${[...new Set([...alsoGranted, ...SCOPES])].join(',')}`);
  } else if (granted.length === 0) {
    console.log('RESULT: nothing at all is granted to this client ID.');
    console.log('');
    console.log('Not one scope works, not even outside the set this app needs, so the entry is');
    console.log('absent, holds a different value, or has not propagated yet.');
    console.log('');
    console.log('In the Google Workspace admin console, as a super administrator:');
    console.log('  Security → Access and data control → API controls → Manage Domain Wide Delegation');
    console.log('');
    console.log(`  Client ID must be exactly:  ${CLIENT_ID}`);
    console.log('  (not the service account address, and not an OAuth client ID)');
    console.log('');
    console.log('  Scopes, comma separated, no spaces:');
    console.log(`  ${SCOPES.join(',')}`);
    console.log('');
    console.log('Check too that this is the same Workspace the target mailbox lives in.');
    console.log('If all of that is already right, it is propagation — re-run this in a while.');
  } else {
    console.log('RESULT: the client ID is registered, but the scope list does not match.');
    console.log(`Working: ${granted.length}/${SCOPES.length}. Add the missing ones to the same entry:`);
    for (const s of SCOPES.filter((s) => !granted.includes(s))) console.log(`  ${s}`);
  }
  process.exit(1);
}

// 4. Whose mailbox did we actually get?
const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
  headers: { Authorization: `Bearer ${full.accessToken}` },
});
const profile = await profileRes.json().catch(() => ({}));

if (!profileRes.ok) {
  const message = profile?.error?.message ?? `HTTP ${profileRes.status}`;
  console.log(`\nRESULT: the token minted, but Gmail refused it — ${message}`);
  if (/has not been used in project|is disabled/.test(message)) {
    console.log('The Gmail API is not enabled in this project. Enable it and try again.');
  }
  process.exit(1);
}

const got = profile.emailAddress;
if (got?.toLowerCase() !== target.toLowerCase()) {
  console.log(`\nRESULT: WRONG MAILBOX — asked for ${target}, got ${got}`);
  console.log('The sub claim did not take effect, so anything written through this token would');
  console.log('land in the wrong mailbox. Do not use it until this reads correctly.');
  process.exit(1);
}

console.log(`\nRESULT: domain-wide delegation works for ${got}`);
console.log(`        ${profile.messagesTotal} messages, historyId ${profile.historyId}`);
