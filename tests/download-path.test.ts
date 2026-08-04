// Splitting file names and finding a free one in the download folder.

import { describe, it, expect } from 'vitest';
import { splitName, uniqueFileName } from '../electron/download-path';

describe('splitName', () => {
  it('splits a plain name', () => {
    expect(splitName('rapport.pdf')).toEqual({ base: 'rapport', ext: '.pdf' });
  });
  it('keeps a double extension together', () => {
    expect(splitName('archief.tar.gz')).toEqual({ base: 'archief', ext: '.tar.gz' });
  });
  it('treats a leading dot as part of the name', () => {
    expect(splitName('.gitignore')).toEqual({ base: '.gitignore', ext: '' });
  });
  it('has no extension when there is no dot', () => {
    expect(splitName('LEESMIJ')).toEqual({ base: 'LEESMIJ', ext: '' });
  });
  it('splits on the last dot when there are several', () => {
    expect(splitName('v1.2.3.zip')).toEqual({ base: 'v1.2.3', ext: '.zip' });
  });
});

describe('uniqueFileName', () => {
  const taken = (...names: string[]) => (c: string) => names.includes(c);

  it('keeps the name when nothing is in the way', () => {
    expect(uniqueFileName('rapport.pdf', taken())).toBe('rapport.pdf');
  });

  it('counts up past an existing file', () => {
    expect(uniqueFileName('rapport.pdf', taken('rapport.pdf'))).toBe('rapport (1).pdf');
    expect(uniqueFileName('rapport.pdf', taken('rapport.pdf', 'rapport (1).pdf'))).toBe(
      'rapport (2).pdf',
    );
  });

  it('puts the counter before a double extension', () => {
    expect(uniqueFileName('archief.tar.gz', taken('archief.tar.gz'))).toBe('archief (1).tar.gz');
  });

  it('counts up on a name without an extension', () => {
    expect(uniqueFileName('LEESMIJ', taken('LEESMIJ'))).toBe('LEESMIJ (1)');
  });

  it('falls back to a name when the download has none', () => {
    expect(uniqueFileName('   ', taken())).toBe('download');
  });

  it('gives up after 999 and returns the original', () => {
    expect(uniqueFileName('a.txt', () => true)).toBe('a.txt');
  });
});
