// Which Google Cloud project each moving part is actually in.
//
// This exists because three of them had drifted apart without anything saying so: the
// desktop app's OAuth client, the service account behind domain-wide delegation, and the
// push relay's own service account each belonged to a different project. Nothing fails
// loudly when that happens — the app links accounts fine against one project while
// `users.watch()` publishes to a topic in another, and notifications simply never arrive.
//
// Read-only. It reports what it can determine and says plainly what it could not, rather
// than guessing from names: a project *id* like "app-gmail-desktop" and a project *number*
// like 910925363385 name the same thing and never look alike.
//
// Usage:
//   node scripts/check-google-setup.mjs <service-account-key.json> [another-key.json ...]

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { join } from 'node:path';

const keyPaths = process.argv.slice(2);
if (keyPaths.length === 0) {
  console.error('Usage: node scripts/check-google-setup.mjs <service-account-key.json> [more...]');
  process.exit(2);
}

const b64 = (b) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function serviceAccountToken(key, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64(
    JSON.stringify({
      iss: key.client_email,
      scope,
      aud: key.token_uri ?? 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${b64(signer.sign(key.private_key))}`;
  const res = await fetch(key.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.access_token;
}

// The project number is the prefix of every OAuth client id Google issues. It is the only
// place the app's own project shows up without asking an API, and it is a *number*, so it
// never matches a project id by eye.
function clientProjectNumber(clientId) {
  const m = /^(\d+)-/.exec(clientId ?? '');
  return m ? m[1] : null;
}

console.log('=== the desktop app ===');
let appNumber = null;
for (const where of ['assets/oauth-defaults.json', null]) {
  const path =
    where ?? join(process.env.APPDATA ?? '', 'gmail-desktop', 'google-oauth.json');
  const label = where ? 'bundled with the build' : 'this machine (userData)';
  try {
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    const num = clientProjectNumber(cfg.clientId);
    appNumber ??= num;
    console.log(`  ${label.padEnd(24)} client project number ${num ?? '(unreadable)'}`);
    console.log(`  ${''.padEnd(24)} pushTopic ${cfg.pushTopic ?? '(not set — push is off)'}`);
  } catch {
    console.log(`  ${label.padEnd(24)} (no config)`);
  }
}

for (const path of keyPaths) {
  console.log(`\n=== ${path} ===`);
  let key;
  try {
    key = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.log('  unreadable:', e.message);
    continue;
  }
  console.log('  project id     :', key.project_id ?? '(none in key)');
  console.log('  service account:', key.client_email);
  console.log('  client id      :', key.client_id, '  <- this is what the DWD screen wants');

  let token;
  try {
    token = await serviceAccountToken(key, 'https://www.googleapis.com/auth/cloud-platform');
  } catch (e) {
    console.log('  cannot mint a token:', e.message);
    continue;
  }

  // The project number, if this account may read its own project. Frequently it may not,
  // and that is not a fault — it is reported rather than worked around.
  const res = await fetch(
    `https://cloudresourcemanager.googleapis.com/v1/projects/${key.project_id}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const body = await res.json().catch(() => ({}));
  if (res.ok && body.projectNumber) {
    console.log('  project number :', body.projectNumber);
    if (appNumber) {
      console.log(
        body.projectNumber === appNumber
          ? '  -> SAME project as the desktop app'
          : `  -> DIFFERENT project from the desktop app (${appNumber})`,
      );
    }
  } else {
    console.log(
      `  project number : could not read (${body?.error?.message?.slice(0, 90) ?? res.status})`,
    );
    console.log('                   read it off the Cloud console home page instead');
  }

  for (const kind of ['topics', 'subscriptions']) {
    const r = await fetch(
      `https://pubsub.googleapis.com/v1/projects/${key.project_id}/${kind}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.log(`  ${kind.padEnd(14)} : cannot list (${j?.error?.message?.slice(0, 60) ?? r.status})`);
      continue;
    }
    const items = j[kind] ?? [];
    console.log(
      `  ${kind.padEnd(14)} :`,
      items.length ? items.map((x) => x.name.split('/').pop()).join(', ') : '(none)',
    );
    for (const s of kind === 'subscriptions' ? items : []) {
      console.log(`                   ${s.name.split('/').pop()} <- ${s.topic}`);
    }
  }
}

console.log(
  '\nEverything above should name one project. Where two numbers differ, the parts are' +
    '\ntalking to different Google projects and push will stay silent without erroring.',
);
