// The privileges app:// is registered with, and one flag is the whole reason this is a
// module: `stream`.
//
// Pages, bundles and stylesheets all work without it; a media element does not. Chromium
// loads <audio> through a path that asks the scheme for a stream, and a refusal fails with
// MEDIA_ELEMENT_ERROR code 4 — which reads like a broken mp3.
//
// Invisible in development, where the Next dev server serves over http and every sound
// plays; silent the moment the same pages come from app:// in a packaged build.


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
