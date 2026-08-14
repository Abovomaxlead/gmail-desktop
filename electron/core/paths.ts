// Where the app's own files live: the bundled renderer, the two preload scripts, the icon
// and the OAuth config. Split out of main.ts because the modules that grew out of it each
// need a couple of these, and a second `join(__dirname, ...)` somewhere else is how two
// places end up disagreeing about where a file is.
//
// Read at import time, as they were in main.ts. That is before the startup switches run,
// which is safe: app.getPath and app.getAppPath are plain getters with no ordering rule
// attached, unlike disableHardwareAcceleration, which must run before 'ready' and stays in
// main.ts for that reason.
//
// __dirname is the bundle's own directory. esbuild emits one file per entry point, so these
// resolve against dist-electron in a packaged build and against the same place in dev —
// splitting this out of main.ts does not move them.

import { app } from 'electron';
import { join } from 'node:path';


//===========================
// Constants
//===========================

export const RENDERER_DIST = join(__dirname, '..', 'renderer', 'out');
export const CHANGELOG_PATH = join(__dirname, '..', 'CHANGELOG.md');

export const PRELOAD_PATH = join(__dirname, 'preload.js');
export const SIDEBAR_PRELOAD_PATH = join(__dirname, 'sidebar-preload.js');
export const ICON_PATH = join(app.getAppPath(), 'assets', 'icon.png');

/** Set only by the dev server; its absence is what "packaged" means to every URL below. */
export const DEV_URL = process.env.ELECTRON_RENDERER_URL;

export const OAUTH_CONFIG_PATH = join(app.getPath('userData'), 'google-oauth.json');
