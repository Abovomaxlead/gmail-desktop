// Channel names and payload types shared between main, preload and renderer. The
// channel name encodes direction and intent; its payload is the same-named type
// below, or the object the handler in main.ts destructures.
//
// Two conventions to keep. Settings arrive as one patch channel per settings tab
// rather than a channel per field, which would be twenty-odd identical handlers. And
// NotifyState's `hiddenSender`/`hiddenSubject` are replacement texts, not flags,
// because the preload runs inside Gmail's own page and has no language of its own —
// `undefined` means "keep what the page said".

export const IPC = {
  UNREAD_UPDATE: 'unread:update',
  NOTIFICATION_ACTIVATE: 'notification:activate',
  ACCOUNT_IDENTITY: 'account:identity',
  MAIL_DROP: 'mail:drop',
  SWITCH_SURFACE: 'switch:surface',
  REDETECT: 'accounts:redetect',
  ADD_ACCOUNT: 'accounts:add',
  ADD_DELEGATED: 'delegated:add',
  ADD_DELEGATED_SUGGESTION: 'delegated:add-suggestion',
  SET_COLOR: 'color:set',
  REMOVE_ACCOUNT: 'accounts:remove',
  SETTINGS_TOGGLE: 'settings:toggle',
  MENU_POPUP: 'menu:popup',
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  SET_AUTO_START: 'prefs:auto-start',
  SET_LAUNCH_MINIMIZED: 'prefs:launch-minimized',
  SET_APPEARANCE: 'prefs:appearance',
  SET_DOWNLOAD_PREFS: 'prefs:downloads',
  SET_PHISHING: 'prefs:phishing',
  SET_UPDATE_PREFS: 'prefs:updates',
  SET_LANGUAGES: 'prefs:languages',
  SET_ADVANCED: 'prefs:advanced',
  SET_GMAIL: 'prefs:gmail',
  SET_VERIFICATION_CODES: 'prefs:verification-codes',
  DOWNLOAD_HISTORY_GET: 'downloads:history-get',
  DOWNLOAD_HISTORY_CLEAR: 'downloads:history-clear',
  DOWNLOAD_HISTORY_REVEAL: 'downloads:history-reveal',
  DOWNLOAD_HISTORY_OPEN: 'downloads:history-open',
  DOWNLOAD_HISTORY_CHANGED: 'downloads:history-changed',
  NOTIFY_SOUND_PLAY: 'notify:sound-play',
  SET_GOOGLE_APPS: 'prefs:google-apps',
  GMAIL_TWEAKS: 'gmail:tweaks',
  COMPOSE_REQUEST: 'gmail:compose-request',
  COMPOSE_SENT: 'gmail:compose-sent',
  SET_NOTIFICATION_EXTRAS: 'prefs:notification-extras',
  NOTIFY_TEST: 'notify:test',
  DOWNLOAD_FOLDER_PICK: 'downloads:folder-pick',
  SPELLCHECK_LANGUAGES_GET: 'spellcheck:available',
  SET_ACCOUNT_PREF: 'prefs:account',
  SET_ACCOUNT_ORDER: 'prefs:order',
  SET_NOTIFICATIONS: 'prefs:notifications',
  SET_SNOOZE: 'prefs:snooze',
  SET_THEME: 'prefs:theme',
  SET_NOTIFICATION_OPEN: 'prefs:notification-open',
  SET_RENE_MODE: 'prefs:rene-mode',
  SET_DEFAULT_MAIL: 'mail:set-default',
  LABELS_GET: 'gmail:labels-get',
  OAUTH_RECONNECT_GET: 'oauth:reconnect-get',
  OAUTH_RECONNECT: 'oauth:reconnect',
  MAIL_DROP_FOLDER_GET: 'maildrop:folder-get',
  MAIL_DROP_FOLDER_PICK: 'maildrop:folder-pick',
  MAIL_DROP_FOLDER_OPEN: 'maildrop:folder-open',
  CHANGELOG_GET: 'changelog:get',
  PROFILES_CHANGED: 'profiles:changed',
  UNREAD_CHANGED: 'unread:changed',
  DELEGATED_SUGGESTIONS: 'delegated:suggestions',
  UPDATE_STATUS: 'update:status',
  SETTINGS_FORCE_CLOSE: 'settings:force-close',
  SETTINGS_FORCE_OPEN: 'settings:force-open',
  PREFS_CHANGED: 'prefs:changed',
  MAIL_DEFAULT_STATUS: 'mail:default-status',
  NOTIFY_ALLOWED: 'notify:allowed',
  MAIL_DROP_RESULT: 'mail:drop-result',
  MAIL_DROP_PREVIEW: 'maildrop:preview',
  MAIL_DROP_PREVIEW_CLOSE: 'maildrop:preview-close',
  MAIL_DROP_PREVIEW_GET: 'maildrop:preview-get',
  MAIL_DROP_COPY: 'maildrop:copy',
  MAIL_DROP_COPY_PROGRESS: 'maildrop:copy-progress',
  OAUTH_RECONNECT_LIST: 'oauth:reconnect-list',
} as const;

export interface MailDropItem {
  threadId: string;
  subject: string;
}

export interface MailDropPayload {
  items: MailDropItem[];
  authuser: string;
  ik: string;
  label?: string;
}

export interface MailDropPreviewItem {
  threadId: string;
  subject: string;
  saved: number;
  error?: string;
}

export interface MailDropCopyProgress {
  phase: 'check' | 'copy';
  done: number;
  total: number;
  email: string;
}

export type {
  CopyTarget as MailDropCopyTarget,
  CopyAccountResult as MailDropCopyAccountResult,
  CopyResult as MailDropCopyResult,
  CopyDuplicate as MailDropCopyDuplicate,
} from './mail-copy';

export interface MailDropResult {
  ok: boolean;
  count: number;
  total: number;
  error?: string;
}

export interface DownloadRecord {
  filename: string;
  path: string;
  url: string;
  bytes: number;
  startedAt: number;
  state: 'completed' | 'cancelled' | 'interrupted';
}

export type GmailTweakState = { css: string; composeInNewWindow: boolean };

export type NotifyState = {
  show: boolean;
  silent: boolean;
  persist: boolean;
  hiddenSender?: string;
  hiddenSubject?: string;
};

export type { ChangelogVersion, ChangelogEntry } from './changelog';
