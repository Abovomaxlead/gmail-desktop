// Channel names and payload types shared between main, preload and renderer. The
// channel name encodes direction and intent; its payload is the same-named type
// below, or the object the handler in main.ts destructures.
//
// Two conventions to keep. Settings arrive as one patch channel per settings tab
// rather than a channel per field, which would be twenty-odd identical handlers. And
// NotifyState carries only what the Gmail page itself has to decide — whether a
// notification may be raised at all, and whether that page may make noise. The text,
// the privacy replacements and how long it stays are main's, because main draws it.

import type { MessageRef } from '../mail/dropzone';


//===========================
// Channels
//===========================

export const IPC = {
  UNREAD_UPDATE: 'unread:update',
  NOTIFICATION_ACTIVATE: 'notification:activate',
  ACCOUNT_IDENTITY: 'account:identity',
  MAIL_DROP: 'mail:drop',
  /** Asked by a mail view before it installs the dropzone, answered on MAIL_DROP_ALLOWED.
   * A question rather than a push, so the answer cannot arrive before the view is listening
   * for it — a strip that never appears is the failure this has to not have. */
  MAIL_DROP_ALLOWED_GET: 'maildrop:allowed-get',
  SWITCH_SURFACE: 'switch:surface',
  REDETECT: 'accounts:redetect',
  ADD_ACCOUNT: 'accounts:add',
  ADD_DELEGATED: 'delegated:add',
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
  SET_ADVANCED: 'prefs:advanced',
  SET_VERIFICATION_CODES: 'prefs:verification-codes',
  DOWNLOAD_HISTORY_GET: 'downloads:history-get',
  DOWNLOAD_HISTORY_CLEAR: 'downloads:history-clear',
  DOWNLOAD_HISTORY_REVEAL: 'downloads:history-reveal',
  DOWNLOAD_HISTORY_OPEN: 'downloads:history-open',
  DOWNLOAD_HISTORY_CHANGED: 'downloads:history-changed',
  NOTIFY_SOUND_PLAY: 'notify:sound-play',
  SET_GOOGLE_APPS: 'prefs:google-apps',
  SET_NOTIFICATION_EXTRAS: 'prefs:notification-extras',
  NOTIFY_TEST: 'notify:test',
  DOWNLOAD_FOLDER_PICK: 'downloads:folder-pick',
  SET_ACCOUNT_PREF: 'prefs:account',
  SET_ACCOUNT_ORDER: 'prefs:order',
  SET_NOTIFICATIONS: 'prefs:notifications',
  SET_SNOOZE: 'prefs:snooze',
  SET_THEME: 'prefs:theme',
  SET_LANGUAGE: 'prefs:language',
  SET_NOTIFICATION_OPEN: 'prefs:notification-open',
  SET_RENE_MODE: 'prefs:rene-mode',
  SET_DEFAULT_MAIL: 'mail:set-default',
  LABELS_GET: 'gmail:labels-get',
  OAUTH_RECONNECT_GET: 'oauth:reconnect-get',
  OAUTH_RECONNECT: 'oauth:reconnect',
  OAUTH_STATUS_GET: 'oauth:status-get',
  OAUTH_CONFIG_IMPORT: 'oauth:config-import',
  OAUTH_STATUS_CHANGED: 'oauth:status-changed',
  MAIL_DROP_FOLDER_GET: 'maildrop:folder-get',
  MAIL_DROP_FOLDER_PICK: 'maildrop:folder-pick',
  MAIL_DROP_FOLDER_OPEN: 'maildrop:folder-open',
  CHANGELOG_GET: 'changelog:get',
  PROFILES_CHANGED: 'profiles:changed',
  /** Which account and surface the window is actually showing. Main owns this — it is the
   * one that calls show() — and the bar used to work it out for itself, which is how it came
   * to mark a tab active while a different account's view was on screen. Sent on every
   * switch; ACTIVE_GET is the same answer for a bar that has just mounted and missed one. */
  ACTIVE_CHANGED: 'active:changed',
  ACTIVE_GET: 'active:get',
  UNREAD_CHANGED: 'unread:changed',
  UPDATE_STATUS: 'update:status',
  SETTINGS_FORCE_CLOSE: 'settings:force-close',
  SETTINGS_FORCE_OPEN: 'settings:force-open',
  PREFS_CHANGED: 'prefs:changed',
  MAIL_DEFAULT_STATUS: 'mail:default-status',
  NOTIFY_ALLOWED: 'notify:allowed',
  /** Whether this mail view may offer drag-to-save at all. Answers MAIL_DROP_ALLOWED_GET. */
  MAIL_DROP_ALLOWED: 'maildrop:allowed',
  MAIL_DROP_RESULT: 'mail:drop-result',
  MAIL_DROP_PREVIEW: 'maildrop:preview',
  MAIL_DROP_PREVIEW_CLOSE: 'maildrop:preview-close',
  MAIL_DROP_PREVIEW_GET: 'maildrop:preview-get',
  MAIL_DROP_COPY: 'maildrop:copy',
  MAIL_DROP_COPY_PROGRESS: 'maildrop:copy-progress',
  /** Where the dragged mail already sits, asked by the picker before anything is ticked. */
  MAIL_DROP_EXISTING_GET: 'maildrop:existing-get',
  OAUTH_RECONNECT_LIST: 'oauth:reconnect-list',
  COMPOSE_ACCOUNT_ASK: 'compose:account-ask',
  COMPOSE_ACCOUNT_PICK: 'compose:account-pick',
  COMPOSE_ACCOUNT_SIZE: 'compose:account-size',
  TOAST_STATE: 'toast:state',
  /** The stack's page asking for the state, once it is actually listening for it. Sent by
   * the page rather than inferred by main from did-finish-load, because a loaded document
   * is not a mounted React tree: the listener is registered in an effect, which runs after
   * the load main was taking as its cue, and a state pushed in between is gone for good. */
  TOAST_READY: 'toast:ready',
  TOAST_SIZE: 'toast:size',
  TOAST_ACTIVATE: 'toast:activate',
  TOAST_DISMISS: 'toast:dismiss',
  TOAST_DISMISS_ALL: 'toast:dismiss-all',
  TOAST_ACTION: 'toast:action',
  TOAST_HOVER: 'toast:hover',
  TOAST_HOVER_END: 'toast:hover-end',
  WEB_NOTIFY_SHOW: 'web-notify:show',
  WEB_NOTIFY_CLICK: 'web-notify:click',
  /** A page saying something about itself, straight into notify.log. Every other channel
   * carries a decision; this one carries only a sentence, and it exists because the two
   * halves of a notification live in different processes: what a Gmail view decided and
   * what the stack's page managed to render are invisible to the file that is supposed to
   * explain why no notification appeared. */
  VIEW_LOG: 'view:log',
} as const;


//===========================
// Payload types
//===========================

export interface MailDropItem {
  threadId: string;
  subject: string;
  /** Set when the press landed on one message of an open conversation: everything newer
   * than this message stays behind. */
  message?: MessageRef;
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
  ExistingLabel as MailDropExistingLabel,
  ExistingInMailbox as MailDropExistingInMailbox,
  ExistingResult as MailDropExisting,
} from '../mail/mail-copy';

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

export type NotifyState = {
  show: boolean;
  silent: boolean;
};

export type { ChangelogVersion, ChangelogEntry } from '../updates/changelog';
