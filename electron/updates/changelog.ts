// Parses the repo's CHANGELOG.md (Keep-a-Changelog style, bilingual) into the data the
// "What's new" section draws. Pure, so it can be unit-tested and reused in both processes.

import type { ChangelogEntry, ChangelogVersion, Lang } from '../../renderer/lib/changelog-types';


//===========================
// Constants
//===========================

const EN_HEADINGS = new Set(['added', 'fixed', 'changed', 'removed', 'security', 'deprecated']);
const NL_HEADINGS = new Set([
  'toegevoegd',
  'opgelost',
  'gewijzigd',
  'verwijderd',
  'beveiliging',
  'verouderd',
]);


//===========================
// Exported functions
//===========================

/**
 * Reads CHANGELOG.md into the versions the "What's new" section draws
 *
 * Content under a version with no explicit "###" heading becomes an entry with an empty
 * heading, and versions that end up with nothing displayable are dropped.
 *
 * @param markdown
 * @returns the versions, newest first, as the file lists them
 */
export function parseChangelog(markdown: string): ChangelogVersion[] {
  const versions: ChangelogVersion[] = [];
  let version: ChangelogVersion | null = null;
  let entry: ChangelogEntry | null = null;
  let item: string | null = null;

  const flushItem = () => {
    if (item !== null && entry) entry.items.push(item);
    item = null;
  };
  const flushEntry = () => {
    flushItem();
    if (entry && version && (entry.items.length > 0 || entry.heading)) version.entries.push(entry);
    entry = null;
  };

  for (const raw of markdown.split('\n')) {
    const line = raw.replace(/\r$/, '');

    if (line.startsWith('## ')) {
      flushEntry();
      version = { ...parseHeader(line.slice(3).trim()), entries: [] };
      versions.push(version);
      entry = null;
      continue;
    }
    if (!version) continue;

    if (line.startsWith('### ')) {
      flushEntry();
      const heading = line.slice(4).trim();
      entry = { heading, lang: headingLang(heading), items: [] };
      continue;
    }

    if (line.trim() === '') {
      flushItem();
      continue;
    }

    if (!entry) entry = { heading: '', lang: 'unknown', items: [] };

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      flushItem();
      item = bullet[1].trim();
    } else if (item !== null) {
      item = `${item} ${line.trim()}`;
    } else {
      item = line.trim();
    }
  }
  flushEntry();

  return versions.filter((v) => v.entries.length > 0);
}

/**
 * Reads one release's notes into the shape the What's-new block already draws
 *
 * A GitHub release body is a changelog section without its own heading -- release-notes.mjs
 * cuts exactly that out of CHANGELOG.md on the way up. Putting the heading back is all it
 * takes to reuse the parser, and the parser is what keeps the modal and the settings panel
 * from drawing the same notes two different ways.
 *
 * @param version the version the notes belong to
 * @param markdown the release body, as the updater hands it over
 * @returns the version block, or null when the body holds nothing worth showing -- which is
 *   what a caller reads as "no notes to put in front of anybody"
 */
export function parseReleaseNotes(version: string, markdown: string): ChangelogVersion | null {
  const body = (markdown ?? '').trim();
  if (!body) return null;
  const parsed = parseChangelog(`## [${version}]\n\n${body}`);
  return parsed[0] ?? null;
}

/**
 * The release body as one piece of markdown, whatever shape the updater used
 *
 * electron-updater answers a string for a single release and an array of `{version, note}`
 * once `fullChangelog` is on, and null when the release page was empty. Folding that here
 * keeps the shape of a third-party field out of everything downstream.
 *
 * @param raw info.releaseNotes, exactly as it arrived
 * @returns the markdown, newest release first; empty when there is none
 */
export function releaseNotesMarkdown(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (!Array.isArray(raw)) return '';
  return raw
    .map((one) => (one && typeof one === 'object' && 'note' in one ? String(one.note ?? '') : ''))
    .filter((note) => note.trim() !== '')
    .join('\n\n');
}


//===========================
// Helper functions
//===========================

/**
 * Which language a section heading is written in
 *
 * @param heading
 * @returns the language, or 'unknown' for a heading neither set names
 * @private
 */
function headingLang(heading: string): Lang {
  const key = heading.trim().toLowerCase();
  if (EN_HEADINGS.has(key)) return 'en';
  if (NL_HEADINGS.has(key)) return 'nl';
  return 'unknown';
}

/**
 * Splits a "## " line into its version and date
 *
 * @param text the heading without its marker
 * @returns the version and the date, either of which may be empty
 * @private
 */
function parseHeader(text: string): { version: string; date: string } {
  const first = text.match(/^\[([^\]]+)\]/);
  if (!first) return { version: text.trim(), date: '' };
  let version = first[1].trim();
  const remainder = text.slice(first[0].length).replace(/^[\s—–-]+/, '');
  const second = remainder.match(/^\[([^\]]+)\]/);
  if (second) return { version: `${version} – ${second[1].trim()}`, date: '' };
  return { version, date: remainder.trim() };
}
