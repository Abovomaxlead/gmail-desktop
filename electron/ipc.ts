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
  MENU_POPUP: 'menu:popup', // invoke(NativeMenuItem[]) -> string | null — main opent een echt OS-menu voor de balk en meldt het gekozen id (null = weggeklikt)
  UPDATE_CHECK: 'update:check', // send() — check GitHub for a newer release
  UPDATE_DOWNLOAD: 'update:download', // send() — download + auto-install the update
  UPDATE_INSTALL: 'update:install', // send() — restart into an already-downloaded update
  SET_AUTO_START: 'prefs:auto-start', // send(boolean)
  SET_LAUNCH_MINIMIZED: 'prefs:launch-minimized', // send(boolean) — start het venster geminimaliseerd
  // Eén kanaal per tab van het instellingenpaneel, met een patch. Zie de
  // opmerking bij `setAppearance` in prefs-store.ts voor waarom niet één kanaal
  // per veld: dat waren er ruim twintig, allemaal identiek op de naam na.
  SET_APPEARANCE: 'prefs:appearance', // send(AppearancePatch)
  SET_DOWNLOAD_PREFS: 'prefs:downloads', // send(Partial<DownloadPrefs>)
  SET_PHISHING: 'prefs:phishing', // send(Partial<PhishingPrefs>)
  SET_UPDATE_PREFS: 'prefs:updates', // send(Partial<UpdatePrefs>)
  SET_LANGUAGES: 'prefs:languages', // send(Partial<LanguagePrefs>)
  SET_ADVANCED: 'prefs:advanced', // send(Partial<AdvancedPrefs>)
  SET_GMAIL: 'prefs:gmail', // send(Partial<GmailPrefs>)
  SET_GOOGLE_APPS: 'prefs:google-apps', // send(Partial<GoogleAppsPrefs>)
  // main -> mail view: alles wat de Gmail-tab van de pagina vraagt, in één bericht.
  // Wordt opnieuw gestuurd zodra een schakelaar omgaat én bij elke (her)laad, want
  // een herlaad gooit weg wat de preload had neergezet.
  //
  // Eén bericht en niet twee kanalen: beide standen moeten op precies dezelfde twee
  // momenten opnieuw worden gestuurd, en met twee kanalen zijn dat twee velden om te
  // onthouden en twee kansen om er één te vergeten.
  GMAIL_TWEAKS: 'gmail:tweaks', // send(GmailTweakState)
  // mail view -> main: de gebruiker klikte op Opstellen en wil dat in een eigen
  // venster. De view stuurt alleen dát het gebeurde; welk account erbij hoort weet
  // main uit de view waar het bericht vandaan komt.
  COMPOSE_REQUEST: 'gmail:compose-request', // send()
  SET_NOTIFICATION_EXTRAS: 'prefs:notification-extras', // send(NotificationExtrasPatch)
  NOTIFY_TEST: 'notify:test', // send() — laat één melding zien zoals hij eruit komt
  DOWNLOAD_FOLDER_PICK: 'downloads:folder-pick', // invoke() -> string (het gekozen pad, of het oude)
  SPELLCHECK_LANGUAGES_GET: 'spellcheck:available', // invoke() -> {code, label}[]
  SET_ACCOUNT_PREF: 'prefs:account', // send({email, label?, notify?})
  SET_ACCOUNT_ORDER: 'prefs:order', // send({emails: string[]})
  SET_NOTIFICATIONS: 'prefs:notifications', // send({dnd, quietHours})
  SET_SNOOZE: 'prefs:snooze', // send(minutes: number | null) — >0 timed snooze, null = mute indefinitely, 0 = clear
  SET_THEME: 'prefs:theme', // send('system'|'light'|'dark')
  SET_NOTIFICATION_OPEN: 'prefs:notification-open', // send('app'|'window')
  SET_RENE_MODE: 'prefs:rene-mode', // send(boolean) — settings-page easter egg toggle
  SET_DEFAULT_MAIL: 'mail:set-default', // send(boolean) — claim of afstaan van de OS mailto:-standaard
  LABELS_GET: 'gmail:labels-get', // invoke() -> {accounts: AccountLabels[]} — labels van elk gekoppeld account
  OAUTH_RECONNECT_GET: 'oauth:reconnect-get', // invoke() -> {accounts: ReconnectAccount[]} — de melding haalt zelf op
  OAUTH_RECONNECT: 'oauth:reconnect', // invoke({email}) -> {ok, error?} — opnieuw toestemming vragen
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
  MAIL_DROP_COPY: 'maildrop:copy', // invoke({targets, force?}) -> MailDropCopyResult — de sleep naar de gekozen labels kopiëren; zonder `force` eerst op duplicaten controleren
  MAIL_DROP_COPY_PROGRESS: 'maildrop:copy-progress', // main -> modal: send(MailDropCopyProgress)
  OAUTH_RECONNECT_LIST: 'oauth:reconnect-list', // main -> melding: send({accounts: ReconnectAccount[]}) — wie opnieuw verbonden moet worden, en waarom
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

// Payload van IPC.MAIL_DROP_COPY_PROGRESS: het kopiëren kan bij een labelsleep
// honderden verzoeken zijn, dus de modal telt mee in plaats van stil te wachten.
// `phase` scheidt het zoeken naar duplicaten van het kopiëren zelf: dat zijn
// twee rondes langs dezelfde berichten en zonder onderscheid lijkt de teller
// terug te springen.
export interface MailDropCopyProgress {
  phase: 'check' | 'copy';
  done: number;
  total: number;
  email: string; // account waar op dit moment naartoe gekeken of geschreven wordt
}

export type {
  CopyTarget as MailDropCopyTarget,
  CopyAccountResult as MailDropCopyAccountResult,
  CopyResult as MailDropCopyResult,
  CopyDuplicate as MailDropCopyDuplicate,
} from './mail-copy';

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
// `hiddenSender`/`hiddenSubject` zijn de vervangende teksten voor het geval de
// gebruiker de afzender of het onderwerp niet in een melding wil zien. Een tekst en
// geen vlaggetje: de preload wordt in Gmail's eigen pagina geïnjecteerd en kent
// geen taal, dus wat er dán komt te staan hoort van main te komen. `undefined` =
// laat wat de pagina zelf zei.
// Wat de Gmail-tab van de pagina vraagt. `css` leeg = niets in te spuiten (en dan
// haalt de preload een eerder gezet `<style>` weg).
export type GmailTweakState = { css: string; composeInNewWindow: boolean };

export type NotifyState = {
  show: boolean;
  silent: boolean;
  persist: boolean;
  hiddenSender?: string;
  hiddenSubject?: string;
};

export type { ChangelogVersion, ChangelogEntry } from './changelog';
