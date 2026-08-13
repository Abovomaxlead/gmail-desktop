// Where a download ends up, as a name. Pure: the filesystem arrives as a single "does
// this name exist?" function, so this is testable without a disk.
//
// Known double extensions stay together — "archief.tar.gz (1)", not
// "archief.tar (1).gz", which would also change the file's type in Windows' eyes —
// and a name starting with a dot is a name, not an extension (".gitignore"). The
// " (1)" form is the one Windows and Chrome use, so a second download of the same
// file does not silently overwrite the first. The counter stops at 999: past that,
// something other than a duplicate download is going on.


//===========================
// Exported functions
//===========================

// Known double extensions stay together — "archief.tar.gz (1)", not "archief.tar (1).gz",
// which would also change the file's type in Windows' eyes — and a name starting with a dot
// is a name, not an extension (".gitignore").

/**
 * Splits a filename into its base and extension
 *
 * @param name
 * @returns the two parts; ext is empty when there is none
 */
export function splitName(name: string): { base: string; ext: string } {
  const dot = name.indexOf('.', 1);
  if (dot <= 0) return { base: name, ext: '' };
  const lower = name.toLowerCase();
  for (const combo of ['.tar.gz', '.tar.bz2', '.tar.xz', '.tar.zst']) {
    if (lower.endsWith(combo)) return { base: name.slice(0, -combo.length), ext: name.slice(-combo.length) };
  }
  const last = name.lastIndexOf('.');
  if (last <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, last), ext: name.slice(last) };
}

/**
 * A filename that does not overwrite one already there
 *
 * The " (1)" form is the one Windows and Chrome use. The counter stops at 999: past
 * that, something other than a duplicate download is going on.
 *
 * @param name
 * @param exists the filesystem, as one question
 * @returns the name to write under
 */
export function uniqueFileName(name: string, exists: (candidate: string) => boolean): string {
  const safe = name.trim() || 'download';
  if (!exists(safe)) return safe;
  const { base, ext } = splitName(safe);
  for (let i = 1; i <= 999; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!exists(candidate)) return candidate;
  }
  return safe;
}
