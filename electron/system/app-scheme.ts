// The privileges app:// is registered with. Its own module for one reason: `stream`, the
// flag nothing in the app appears to need until a sound is played, and which cannot be
// discovered by running the app the way it is developed.
//
// Everything the packaged app displays comes through this scheme — the pages, the
// bundles, the stylesheets — and all of that works without `stream`. A media element does
// not. Chromium loads <audio> and <video> through a separate path that asks the scheme
// whether it can serve a stream, and a scheme that says no is not merely slow: the element
// fails outright with MEDIA_ELEMENT_ERROR code 4, "Format error", which reads like a
// broken mp3 rather than a protocol that declined to serve it.
//
// That is why this was invisible until release. In development the pages are served over
// http by the Next dev server, which has none of this to declare, so every sound played;
// the moment the same pages come from app:// in a packaged build, every sound is silent
// and the file it blames is the one thing that is not wrong.


//===========================
// Constants
//===========================

export const APP_SCHEME = 'app';

export const APP_SCHEME_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  // Required for <audio>/<video> to load from this scheme at all — see above.
  stream: true,
};
