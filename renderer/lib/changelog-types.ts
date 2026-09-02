// The changelog as it travels from main to the What's New section, in renderer/lib so both
// sides read one declaration.
//
// An entry's `lang` is the language its heading was written in; 'unknown' is a heading that
// matched neither list, which the section keeps rather than drops.


//===========================
// Types
//===========================

export type Lang = 'en' | 'nl' | 'unknown';

export interface ChangelogEntry {
  heading: string;
  lang: Lang;
  items: string[];
}

export interface ChangelogVersion {
  version: string;
  date: string;
  entries: ChangelogEntry[];
}
