'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { getStrings } from '../strings';
import { ACCENT_BUTTON, BUTTON, HAIRLINE } from '../settings/tokens';
import type { ChangelogEntry } from '../../lib/changelog-types';
import type { ReleaseNotesAsk } from '../../lib/release-notes';

// What a new version says about itself, put in front of the user the moment the app finds it.
//
// A card in the corner says a version exists and nothing about it, and "Wat is er nieuw" only
// ever holds the notes of the version already installed -- so until you had updated there was
// no way to read what you would be updating to. This is that page, shown before the download
// rather than after the restart.
//
// An overlay for the same reason the copy picker is one: a modal drawn in the sidebar page
// would sit behind the Gmail view. Esc, the backdrop and Later all close it; nothing here
// installs anything by itself.

export default function ReleaseNotesPage() {
  const [ask, setAsk] = useState<ReleaseNotesAsk | null>(null);

  useEffect(() => {
    window.desktop?.onReleaseNotes((next) => setAsk(next));
  }, []);

  // Its own window, so the class the sidebar page puts on its own <html> is not there: the
  // theme travels in the payload and is applied here, the way the toast stack does it.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', ask?.dark === true);
  }, [ask?.dark]);

  const close = useCallback(() => window.desktop?.closeReleaseNotes(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  if (!ask) return <style>{'html,body{background:transparent}'}</style>;

  const S = getStrings(ask.locale, ask.reneMode);
  const entries = ask.notes ? entriesForLang(ask.notes.entries, ask.locale) : [];

  const download = () => {
    window.desktop?.downloadUpdate();
    close();
  };

  return (
    <>
      <style>{'html,body{background:transparent}'}</style>

      <div
        onClick={close}
        className="flex h-screen w-full items-start justify-center bg-black/40 px-6 pt-14"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className={`flex max-h-[75vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border ${HAIRLINE} bg-white shadow-2xl dark:bg-neutral-900`}
        >
          <div className="shrink-0 px-5 pb-3 pt-4">
            <p className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
              {S.releaseNotesTitle(ask.version)}
            </p>
            <p className="mt-0.5 text-[13px] text-neutral-500 dark:text-neutral-400">
              {ask.notes?.date ? `${S.releaseNotesSubtitle} — ${ask.notes.date}` : S.releaseNotesSubtitle}
            </p>
          </div>

          <div className={`flex-1 overflow-y-auto border-t ${HAIRLINE} px-5 py-4`}>
            {entries.length === 0 ? (
              <p className="text-[13px] text-neutral-500 dark:text-neutral-400">
                {S.releaseNotesEmpty}
              </p>
            ) : (
              entries.map((entry, ei) => (
                <div key={ei} className="mb-3 last:mb-0">
                  {(S.changelogCategory(entry.heading) || entry.heading) && (
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                      {S.changelogCategory(entry.heading) || entry.heading}
                    </div>
                  )}
                  <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-neutral-800 dark:text-neutral-200">
                    {entry.items.map((item, ii) => (
                      <li key={ii}>{renderInline(item)}</li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>

          <div className={`flex shrink-0 items-center justify-end gap-2 border-t ${HAIRLINE} px-5 py-3`}>
            {ask.downloading ? (
              <span className="mr-auto text-[13px] text-neutral-500 dark:text-neutral-400">
                {S.releaseNotesDownloading}
              </span>
            ) : null}
            <button type="button" onClick={close} className={BUTTON}>
              {S.releaseNotesLater}
            </button>
            {!ask.downloading && (
              <button type="button" onClick={download} className={ACCENT_BUTTON}>
                {S.releaseNotesDownload}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}


//===========================
// Helper functions
//===========================

/**
 * The entries worth showing in the interface language
 *
 * A release is written in both languages, one section each, so the other language's sections
 * are noise. A section whose heading matched neither -- "Let op" on the release that needed a
 * new consent -- is never dropped: an untranslated heading is not a reason to hide the one
 * paragraph the user has to act on. And a release that says nothing in your language is
 * better read in the other one than not at all.
 *
 * @param entries every entry of the release
 * @param locale the interface language
 * @returns the entries to draw, in the order the release wrote them
 */
function entriesForLang(entries: ChangelogEntry[], locale: 'en' | 'nl'): ChangelogEntry[] {
  const mine = entries.filter((e) => e.lang === locale);
  if (mine.length === 0) return entries;
  return entries.filter((e) => e.lang === locale || e.lang === 'unknown');
}

/**
 * Draws **bold** and leaves the rest alone
 *
 * @param text one bullet out of the release notes
 * @returns the text with its bold runs marked up
 */
function renderInline(text: string): ReactNode {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
    );
}
