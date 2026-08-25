// Prints the CHANGELOG.md section of one version, for the body of the GitHub release.
//
// The app itself never reads this: the "What's new" panel parses the CHANGELOG.md that ships
// inside the installer. These notes are for whoever opens the release page, so a version that
// is missing from the changelog is worth a plain line rather than a failed release.

import { readFileSync } from 'node:fs';


//===========================
// Constants
//===========================

const HEADING = /^## \[/;


//===========================
// Exported functions
//===========================

/**
 * Returns the notes of one version
 *
 * @param markdown the whole changelog
 * @param version without the v prefix
 * @returns {string} the section body, or an empty string when the version is not in the file
 */
export function releaseNotes(markdown, version) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start < 0) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => HEADING.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}


//===========================
// Helper functions
//===========================

function main() {
  const version = process.argv[2];
  if (!version) {
    process.stderr.write('usage: node scripts/release-notes.mjs <version>\n');
    process.exit(2);
  }
  const notes = releaseNotes(readFileSync('CHANGELOG.md', 'utf8'), version);
  process.stdout.write(notes || `Release ${version}`);
}

if (process.argv[1] && process.argv[1].endsWith('release-notes.mjs')) main();
