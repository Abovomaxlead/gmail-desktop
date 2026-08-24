// Channel names and payload types shared between main, preload and renderer.
//
// Two conventions to keep: settings arrive as one patch channel per settings tab rather than
// a channel per field, and NotifyState carries only what the Gmail page itself decides —
// whether it may notify at all, and whether it may make noise. The text is main's.

import type { MessageRef } from '../mail/dropzone';
import type { CopyResult } from '../mail/mail-copy';
import type { CopyStopMode, RollbackOutcome } from '../mail/copy-run-types';


//===========================
// Channels
//===========================

export const IPC = {
  UNREAD_UPDATE: 'unread:update',
  NOTIFICATION_ACTIVATE: 'notification:activate',
  ACCOUNT_IDENTITY: 'account:identity',
  MAIL_DROP: 'mail:drop',
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
  ACTIVE_CHANGED: 'active:changed',
  ACTIVE_GET: 'active:get',
  UNREAD_CHANGED: 'unread:changed',
  UPDATE_STATUS: 'update:status',
  SETTINGS_FORCE_CLOSE: 'settings:force-close',
  SETTINGS_FORCE_OPEN: 'settings:force-open',
  PREFS_CHANGED: 'prefs:changed',
  MAIL_DEFAULT_STATUS: 'mail:default-status',
  NOTIFY_ALLOWED: 'notify:allowed',
  MAIL_DROP_ALLOWED: 'maildrop:allowed',
  MAIL_DROP_RESULT: 'mail:drop-result',
  MAIL_DROP_SAVE_PROGRESS: 'maildrop:save-progress',
  MAIL_DROP_LOCK: 'maildrop:lock',
  MAIL_DROP_PREVIEW: 'maildrop:preview',
  MAIL_DROP_PREVIEW_CLOSE: 'maildrop:preview-close',
  MAIL_DROP_PREVIEW_GET: 'maildrop:preview-get',
  MAIL_DROP_COPY: 'maildrop:copy',
  MAIL_DROP_COPY_PROGRESS: 'maildrop:copy-progress',
  MAIL_DROP_COPY_CONTROL: 'maildrop:copy-control',
  MAIL_DROP_EXISTING_GET: 'maildrop:existing-get',
  MAIL_DROP_EXISTING: 'maildrop:existing',
  MAIL_DROP_ORPHAN_GET: 'maildrop:orphan-get',
  MAIL_DROP_ORPHAN_DECIDE: 'maildrop:orphan-decide',
  OAUTH_RECONNECT_LIST: 'oauth:reconnect-list',
  COMPOSE_ACCOUNT_ASK: 'compose:account-ask',
  COMPOSE_ACCOUNT_PICK: 'compose:account-pick',
  COMPOSE_ACCOUNT_SIZE: 'compose:account-size',
  TOAST_STATE: 'toast:state',
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
  VIEW_LOG: 'view:log',
} as const;


//===========================
// Payload types
//===========================

export interface MailDropItem {
  threadId: string;
  subject: string;
  message?: MessageRef;
  /** Set when the page could not read which message this row is, while another row of the
   * same conversation could. Saving that conversation's newest message for it would hand
   * over a mail nobody ticked, so the row is refused instead. */
  messageUnknown?: boolean;
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

export type {
  CopyTarget as MailDropCopyTarget,
  CopyAccountResult as MailDropCopyAccountResult,
  CopyResult as MailDropCopyResult,
  CopyDuplicate as MailDropCopyDuplicate,
  ExistingLabel as MailDropExistingLabel,
  ExistingInMailbox as MailDropExistingInMailbox,
  ExistingResult as MailDropExisting,
} from '../mail/mail-copy';

/** How far a copy has got, over all the chosen mailboxes at once, or how far a rollback has
 * got undoing one. No mailbox is named for a running copy -- several run at once, so naming
 * one would say something untrue -- but a paused run breaks its count down per mailbox
 * (`byMailbox`), which is exactly what the stop dialog has to show. */
export interface MailDropCopyProgress {
  phase: 'check' | 'copy' | 'rollback';
  done: number;
  total: number;
  paused?: boolean;
  byMailbox?: { email: string; copied: number }[];
}

/** What the paused dialog may ask the copy in flight to do. The two stop actions map onto
 * CopyStopMode ('keep' / 'rollback') once the gate has drained. */
export type MailDropCopyControlAction = 'pause' | 'resume' | 'stop-keep' | 'stop-rollback';

export type MailDropCopyControlResult = { ok: true } | { ok: false; error: string };

/** What a copy answers when it was stopped rather than run to its own end. Kept apart from
 * MailDropCopyResult rather than folded into it: 'stopped' is neither the success nor the
 * failure that type's `ok` flag distinguishes between. */
export interface MailDropCopyStoppedResult {
  stopped: true;
  mode: CopyStopMode;
  copied: number;
  byMailbox: { email: string; copied: number }[];
  /** Only set for mode 'rollback' */
  rollback?: RollbackOutcome;
  /** Set when the stop itself could not be completed safely -- the closing journal line
   * failed to write -- so the caller must not read this as a clean stop. A sweep that has not
   * converged yet is not this: it is reported inside `rollback`/`warnings` instead, since it
   * resolves on its own at the next start rather than needing to be treated as a failure now. */
  error?: string;
  /** Something else did not itself succeed -- the audit log, most often -- even though the
   * stop did. Never what decides whether this is a clean stop; `error` is what does that. */
  warnings?: string[];
}

/** A run this app never heard the end of, waiting for the same keep-or-rollback answer a live
 * run's stop dialog already asks -- surfaced when the mail-drop window opens, since nothing
 * else in this app can put a question in front of the user on its own. */
export interface MailDropPendingOrphan {
  runId: string;
  byMailbox: { email: string; inserted: number }[];
}

/** A copy that fully succeeded, but where writing the record of that success did not fully
 * succeed -- the audit log, or the journal's own closing line. The mail genuinely landed, so
 * this is reported exactly as MailDropCopyResult would be, with `warnings` added rather than
 * turned into a failure. Losing that closing line in silence is what would make the next
 * start's orphan scan read a fully successful run as one that crashed. */
export type MailDropCopyWarnedResult = CopyResult & { warnings: string[] };

/** The saved-mail folder as the settings page needs it: the path, and whether that path hands
 * the mail to something else -- a share or a sync folder. */
export interface MailDropFolderStatus {
  folder: string;
  remote: boolean;
}

export interface MailDropResult {
  ok: boolean;
  count: number;
  total: number;
  error?: string;
}

/** How far a pull has got, counted in conversations because that is what both pull paths
 * loop over. */
export interface MailDropSaveProgress {
  done: number;
  /** 0 while the label is still being listed, when the total is not known yet */
  total: number;
}

/** Whether every Gmail view is locked because mail is being pulled. `note` is set only when
 * the lock lifted by itself, which means the pull outlasted its hold rather than finished. */
export interface MailDropLock {
  locked: boolean;
  note?: string;
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
