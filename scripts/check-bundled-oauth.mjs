// Refuses to build an installer that would cost people their linked accounts.
//
// assets/oauth-defaults.json is git-ignored, and no build step produces it: a local build
// ships whatever happens to be lying in the working tree, and CI writes it from a repository
// secret with `printf` and does not look at what came out. Both ways fail quietly, and both
// failures land on the colleagues rather than on whoever built it -- a machine with its own
// google-oauth.json in userData never reads the bundled one at all.
//
// Two things go wrong. An empty or missing config ships an app that cannot link anything.
// A config naming a *different* OAuth client ships an app whose refresh tokens are all
// addressed to the retired client, so every account asks to be linked again the moment the
// update lands. Neither says anything at build time, which is why this runs before packaging.
//
// Usage:
//   node scripts/check-bundled-oauth.mjs            # before packaging, exits non-zero
//   node scripts/check-bundled-oauth.mjs --allow-missing   # a fork, which ships without one

import { readFileSync } from 'node:fs';
import { join } from 'node:path';


//===========================
// Constants
//===========================

const CONFIG_PATH = join(process.cwd(), 'assets', 'oauth-defaults.json');

// The project every released build has linked accounts against. It is the prefix of the
// OAuth client id and is not a secret -- the client *secret* is, and that stays out of the
// repository. Pinned here so that changing the OAuth client takes a commit somebody reads,
// instead of being whatever the machine that ran the build had lying around.
const EXPECTED_PROJECT_NUMBER = '910925363385';

const ALLOW_MISSING = process.argv.includes('--allow-missing');


//===========================
// Helper functions
//===========================

/**
 * The project number carried in an OAuth client id
 *
 * @param clientId
 * @returns the leading number, or null when the id carries none
 */
function projectNumberOf(clientId) {
  const m = /^(\d+)-/.exec(typeof clientId === 'string' ? clientId : '');
  return m ? m[1] : null;
}

/**
 * Reports the problem and stops the build
 *
 * @param problem one line saying what is wrong
 * @param detail the lines explaining what to do about it
 */
function fail(problem, detail) {
  console.error(`\nThe bundled OAuth config is not fit to ship: ${problem}\n`);
  for (const line of detail) console.error(`  ${line}`);
  console.error('');
  process.exit(1);
}


//===========================
// The check
//===========================

let text;
try {
  text = readFileSync(CONFIG_PATH, 'utf8');
} catch {
  if (ALLOW_MISSING) {
    console.log('No bundled OAuth config, and --allow-missing was given. Nothing to check.');
    process.exit(0);
  }
  fail('there is none', [
    `expected: ${CONFIG_PATH}`,
    '',
    'For a local build, copy this machine\'s config into the build:',
    '  npm run bundle:oauth-config',
    '',
    'In CI it comes from the GOOGLE_OAUTH_JSON repository secret. An empty secret writes',
    'an empty file, so check the secret is still set on the repository.',
    '',
    'A fork that means to ship without one: pass --allow-missing.',
  ]);
}

if (text.trim() === '') {
  fail('it is empty', [
    `at: ${CONFIG_PATH}`,
    '',
    'In CI this is what a missing or empty GOOGLE_OAUTH_JSON secret writes: printf runs,',
    'the file appears, and nothing complains. Check the secret on the repository.',
  ]);
}

let parsed;
try {
  parsed = JSON.parse(text);
} catch (e) {
  fail('it is not valid JSON', [`at: ${CONFIG_PATH}`, `${e.message}`]);
}

const missing = ['clientId', 'clientSecret'].filter(
  (k) => typeof parsed?.[k] !== 'string' || parsed[k].trim() === '',
);
if (missing.length > 0) {
  fail(`it is missing ${missing.join(' and ')}`, [
    `at: ${CONFIG_PATH}`,
    '',
    'A build without both cannot link a single account.',
  ]);
}

const found = projectNumberOf(parsed.clientId);
if (found === null) {
  fail('its clientId does not look like a Google client id', [
    `at: ${CONFIG_PATH}`,
    'A client id starts with the project number, then a dash.',
  ]);
}

if (found !== EXPECTED_PROJECT_NUMBER) {
  fail(`it names project ${found}, not ${EXPECTED_PROJECT_NUMBER}`, [
    `at: ${CONFIG_PATH}`,
    '',
    'Every refresh token on every machine was issued to the client this build is replacing.',
    'Shipping this one unlinks all of them at once: everybody is asked to link their',
    'accounts again the moment the update installs.',
    '',
    'If that is a mistake, put the right config in place:',
    '  npm run bundle:oauth-config',
    '',
    'If the OAuth client really has moved, change EXPECTED_PROJECT_NUMBER in this script in',
    'the same commit, so the release notes can say that everyone has to link again.',
  ]);
}

console.log(`Bundled OAuth config ok: project ${found}, clientId and clientSecret both set.`);
