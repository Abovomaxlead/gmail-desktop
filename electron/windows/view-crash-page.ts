// What a mail view shows when its own page has died and cannot be brought back.
//
// A page whose process is gone is a grey rectangle that never paints again. Electron does not
// reload it, so the app does (profile-view-manager.ts) -- but a page that keeps crashing has to
// stop being reloaded, and then the user is left looking at that rectangle with no idea what
// happened to their mailbox.
//
// This is what goes there instead: the failure, in the place where the failure is. No
// notification, no card, no dialog -- those all say "something happened somewhere". A sentence
// inside the panel that broke says which mailbox it was, and it stays until something fixes it.
//
// Built as a document rather than drawn by the renderer app on purpose. The renderer is a
// separate window; this has to appear in the dead view's own bounds, and that view can load
// nothing but a URL. It carries no script and no network reference, which is also why it cannot
// itself fail.

import { pickVariant, type Locale } from '../core/locale';


//===========================
// Types
//===========================

export interface ViewCrashText {
  title: string;
  body: string;
  hint: string;
}


//===========================
// Constants
//===========================

const EN: ViewCrashText = Object.freeze({
  title: 'This mailbox stopped responding',
  body: 'The page crashed and reloading it did not help. Your mail is untouched — this is the window, not the mailbox.',
  hint: 'Press Ctrl+R to try again, or restart the app.',
});

const NL: ViewCrashText = Object.freeze({
  title: 'Dit postvak reageert niet meer',
  body: 'De pagina is vastgelopen en opnieuw laden hielp niet. Aan je mail is niets gebeurd — dit gaat over het venster, niet over de mailbox.',
  hint: 'Druk op Ctrl+R om het opnieuw te proberen, of start de app opnieuw.',
});

const RENE: ViewCrashText = Object.freeze({
  title: 'Dit postvak doet niets meer',
  body: 'Deze pagina is vastgelopen. Aan je mail is niks gebeurd, alleen dit venster doet het niet.',
  hint: 'Druk Ctrl+R om het nog eens te proberen. Helpt dat niet, zet de app dan uit en weer aan.',
});


//===========================
// Exported functions
//===========================

/**
 * The wording for one locale
 *
 * @param locale
 * @param reneMode
 * @returns the three lines the page shows
 */
export function viewCrashText(locale: Locale, reneMode: boolean): ViewCrashText {
  return pickVariant(locale, reneMode, { en: EN, nl: NL, rene: RENE });
}

/**
 * The page a dead view is sent to
 *
 * @param text from viewCrashText
 * @param mailbox the address whose view this is, shown so a window of four panels says which
 *   one broke
 * @param dark whether the app is in dark mode, since this replaces a page that was
 * @returns a data URL, ready for loadURL
 */
export function viewCrashUrl(text: ViewCrashText, mailbox: string, dark: boolean): string {
  const bg = dark ? '#202124' : '#ffffff';
  const fg = dark ? '#e8eaed' : '#202124';
  const dim = dark ? '#9aa0a6' : '#5f6368';
  const html = `<!doctype html>
<html lang="nl"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(text.title)}</title>
<style>
html,body{margin:0;height:100%;background:${bg};color:${fg};
font:14px/1.5 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif}
main{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;
gap:8px;padding:32px;box-sizing:border-box;text-align:center}
h1{margin:0;font-size:16px;font-weight:600}
p{margin:0;max-width:46ch}
.mailbox{color:${dim};font-size:13px}
.hint{color:${dim};font-size:13px;margin-top:8px}
</style></head>
<body><main>
<h1>${escapeHtml(text.title)}</h1>
${mailbox ? `<p class="mailbox">${escapeHtml(mailbox)}</p>` : ''}
<p>${escapeHtml(text.body)}</p>
<p class="hint">${escapeHtml(text.hint)}</p>
</main></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}


//===========================
// Helper functions
//===========================

/**
 * Text that cannot close a tag
 *
 * The mailbox address comes from a page title and a switcher, so it is not this module's to
 * trust -- and a document built by string concatenation is exactly where that matters.
 *
 * @param text
 * @returns the text with the five markup characters replaced
 * @private
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
