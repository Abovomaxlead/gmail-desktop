// Where the app's own files live: the bundled renderer, the two preload scripts, the icon
// and the OAuth config. One place, so no two callers disagree about where a file is.
//
// Read at import time, which is safe: app.getPath and app.getAppPath are plain getters with
// no ordering rule attached. __dirname is the esbuild bundle's own directory.

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

export const DEV_URL = process.env.ELECTRON_RENDERER_URL;

export const OAUTH_CONFIG_PATH = join(app.getPath('userData'), 'google-oauth.json');
