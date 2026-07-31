// Channel names shared between main, preload, and renderer.
export const IPC = {
  // Gmail view -> main
  UNREAD_UPDATE: 'unread:update', // send(count:number)
  NOTIFICATION_ACTIVATE: 'notification:activate', // send(threadId?: string) — clicked notification's thread when resolvable
  ACCOUNT_IDENTITY: 'account:identity', // send({email,name,avatarUrl})
  MAIL_DROP: 'mail:drop', // send(MailDropPayload) — mail gesleept naar de dropzone
  // renderer (sidebar) -> main
  SWITCH_SURFACE: 'switch:surface', // send({key, surface:'mail'|'calendar'}) — key = accountKey
  REDETECT: 'accounts:redetect', // send()
  ADD_ACCOUNT: 'accounts:add', // send() — open Google's add-session flow in a visible view
  ADD_DELEGATED: 'delegated:add', // send() — start click-through capture of a delegated mailbox
  ADD_DELEGATED_SUGGESTION: 'delegated:add-suggestion', // send({email, mailUrl}) — accept an auto-detected suggestion
  SET_COLOR: 'color:set', // send({email, color})
  REMOVE_ACCOUNT: 'accounts:remove', // send({email}) — hide account + skip on detect
  SETTINGS_TOGGLE: 'settings:toggle', // send({open:boolean})
  OVERLAY_TOGGLE: 'overlay:toggle', // send({open:boolean}) — hide/show the content view so a sidebar popup (e.g. the "+" menu) shows above it
  UPDATE_CHECK: 'update:check', // send() — check GitHub for a newer release
  UPDATE_DOWNLOAD: 'update:download', // send() — download + auto-install the update
  UPDATE_INSTALL: 'update:install', // send() — restart into an already-downloaded update
  SET_AUTO_START: 'prefs:auto-start', // send(boolean)
  SET_ACCOUNT_PREF: 'prefs:account', // send({email, label?, notify?})
  SET_ACCOUNT_ORDER: 'prefs:order', // send({emails: string[]})
  SET_NOTIFICATIONS: 'prefs:notifications', // send({dnd, quietHours})
  SET_SNOOZE: 'prefs:snooze', // send(minutes: number | null) — >0 timed snooze, null = mute indefinitely, 0 = clear
  SET_THEME: 'prefs:theme', // send('system'|'light'|'dark')
  SET_NOTIFICATION_OPEN: 'prefs:notification-open', // send('app'|'window')
  SET_RENE_MODE: 'prefs:rene-mode', // send(boolean) — settings-page easter egg toggle
  SET_DEFAULT_MAIL: 'mail:set-default', // send() — (re)claim the OS mailto: default
  MAIL_DROP_FOLDER_GET: 'maildrop:folder-get', // invoke() -> string (resolved save folder)
  MAIL_DROP_FOLDER_PICK: 'maildrop:folder-pick', // invoke() -> string (new folder, or the old one on cancel)
  MAIL_DROP_FOLDER_OPEN: 'maildrop:folder-open', // send() — reveal the folder in the file manager
  CHANGELOG_GET: 'changelog:get', // invoke() -> ChangelogVersion[] — parsed CHANGELOG.md
  // main -> renderer (sidebar)
  PROFILES_CHANGED: 'profiles:changed', // Profile[]
  UNREAD_CHANGED: 'unread:changed', // Record<accountKey, number>
  DELEGATED_SUGGESTIONS: 'delegated:suggestions', // { suggestions: {email, mailUrl}[] } — best-effort auto-detected delegates to offer
  UPDATE_STATUS: 'update:status', // { state, currentVersion, version?, percent?, message? }
  SETTINGS_FORCE_CLOSE: 'settings:force-close',
  SETTINGS_FORCE_OPEN: 'settings:force-open', // main -> renderer: open the settings panel (e.g. tray "Check for updates")
  PREFS_CHANGED: 'prefs:changed', // main -> renderer: full Prefs
  MAIL_DEFAULT_STATUS: 'mail:default-status', // main -> renderer: boolean (is default mailto client)
  NOTIFY_ALLOWED: 'notify:allowed', // main -> mail view: send(NotifyState)
  MAIL_DROP_RESULT: 'mail:drop-result', // main -> mail view: send(MailDropResult)
  MAIL_DROP_PREVIEW: 'maildrop:preview', // main -> renderer (sidebar): send({items}) — open the modal
  MAIL_DROP_PREVIEW_CLOSE: 'maildrop:preview-close', // renderer -> main: send() — modal closed, drop the overlay
  MAIL_DROP_PREVIEW_GET: 'maildrop:preview-get', // invoke() -> {items} — de modal haalt zelf op, voor het geval de push hem nét miste
} as const;

// Eén gesleept gesprek. Het onderwerp komt uit de berichtenlijst en is er dus
// meteen — de sidebar hoeft niet op het ophalen te wachten om te tonen wát je
// versleept.
export interface MailDropItem {
  threadId: string;
  subject: string;
}

// Payload van IPC.MAIL_DROP: wat de Gmail-pagina weet op het moment van de drop.
// Meerdere items omdat Gmail een hele selectie tegelijk laat slepen.
export interface MailDropPayload {
  items: MailDropItem[];
  authuser: string;
  ik: string;
  // Gezet als er een label uit de navigatie is gesleept in plaats van losse
  // gesprekken. `items` is dan leeg: main zoekt zelf op wat er in het label zit.
  label?: string;
}

// Payload van IPC.MAIL_DROP_PREVIEW: wat er is opgeslagen, per gesleept gesprek.
// Verstuurd ná het opslaan, zodat de modal de werkelijke uitkomst toont.
export interface MailDropPreviewItem {
  threadId: string;
  subject: string;
  saved: number; // aantal weggeschreven berichten uit dit gesprek
  error?: string;
}

// Payload van IPC.MAIL_DROP_RESULT. `total` is het aantal gevonden berichten in
// de conversatie, `count` hoeveel daarvan zijn opgeslagen.
export interface MailDropResult {
  ok: boolean;
  count: number;
  total: number;
  error?: string;
}

// Payload of IPC.NOTIFY_ALLOWED. `show` gates whether a notification is shown
// at all; `silent` and `persist` style a shown notification (no sound / stays
// on screen until dismissed) without suppressing it.
export type NotifyState = { show: boolean; silent: boolean; persist: boolean };

export type { ChangelogVersion, ChangelogEntry } from './changelog';
