// All user-facing text in the app's own chrome (bar + settings), in two flavours: the
// normal English UI and Rene mode's simple Dutch, short words a four-year-old can
// read. Gmail's own page content is Google's and stays as it is. `numberLocale` is a
// formatting choice that belongs to the language: which separator groups the thousands
// in an unread count (1.324 vs 1,324). A nav name is also the heading above its own
// section, one key for both, because nineteen sections with two keys each would be
// nineteen chances for the two to drift apart.

import type { Locale } from '../../electron/locale';

export interface UiStrings {
  numberLocale: string;

  close: string;
  escKey: string;
  reneBanner: string;

  navDownloadHistory: string;
  navGeneral: string;
  navAccounts: string;
  navAppearance: string;
  navDownloads: string;
  navGmail: string;
  navGoogleApps: string;
  navNotifications: string;
  navPhishingProtection: string;
  navUpdates: string;
  navVerificationCodes: string;
  navAdvanced: string;
  navWhatsNew: string;
  navAbout: string;
  settingsAttention: string;
  sectionEmpty: string;

  defaultMailClient: string;
  defaultMailClientDescription: string;
  defaultMailIsDefault: string;
  defaultMailNotDefault: string;
  defaultMailSetButton: string;
  defaultMailChangeButton: string;
  startup: string;
  autoStart: string;
  autoStartDescription: string;
  launchMinimized: string;
  launchMinimizedDescription: string;
  mailDropFolder: string;
  mailDropHint: string;
  mailDropChoose: string;
  mailDropOpen: string;
  dropTitle: (threads: number) => string;
  dropSubtitle: (ok: number, messages: number) => string;
  dropSavedCount: (messages: number) => string;
  theme: string;
  themeDescription: string;
  themeSystem: string;
  themeLight: string;
  themeDark: string;
  language: string;
  languageDescription: string;
  languageSystem: string;
  languageEnglish: string;
  languageDutch: string;
  notificationOpenLabel: string;
  notificationOpenDescription: string;
  openInApp: string;
  openInWindow: string;

  showUnreadBadges: string;
  showUnreadBadgesDescription: string;
  systemTray: string;
  trayEnabled: string;
  trayEnabledDescription: string;
  traySelectUnread: string;
  traySelectUnreadDescription: string;
  trayColourTodo: string;
  windowGroup: string;
  restrictMinWindowSize: string;
  restrictMinWindowSizeDescription: string;

  saveAsDialog: string;
  saveAsDialogDescription: string;
  openFolderWhenDone: string;
  openFolderWhenDoneDescription: string;
  downloadFolder: string;
  downloadFolderDescription: string;
  downloadFolderDefault: string;
  change: string;
  mailDropGroup: string;

  confirmExternalLinks: string;
  confirmExternalLinksDescription: string;
  confirmExternalLinksGoogleNote: string;
  trustedHosts: string;
  trustedHostsDescription: string;
  trustedHostsEmpty: string;
  trustedHostRemove: (host: string) => string;

  autoCheckUpdates: string;
  autoCheckUpdatesDescription: string;
  notifyUpdates: string;
  notifyUpdatesDescription: string;

  miscellaneous: string;
  hardwareAcceleration: string;
  hardwareAccelerationDescription: string;
  restartRequired: string;

  gmailComposeGroup: string;
  gmailComposeNewWindow: string;
  gmailComposeNewWindowDescription: string;

  gaOpenInApp: string;
  gaOpenInAppDescription: string;
  gaAlwaysNewWindow: string;
  gaAlwaysNewWindowDescription: string;
  gaExcluded: string;
  gaExcludedDescription: string;
  gaExcludedAllExternal: string;
  gaExcludedAllNewWindow: string;
  gaExcludedNone: string;
  gaShowAccountLabel: string;
  gaShowAccountLabelDescription: string;
  gaShowAccountColor: string;
  gaShowAccountColorDescription: string;
  gaPinned: string;
  gaPinnedDescription: string;
  gaPinnedHeading: string;
  gaAvailableHeading: string;
  gaPin: (name: string) => string;
  gaUnpin: (name: string) => string;

  dhEmpty: string;
  dhFile: string;
  dhSize: string;
  dhWhen: string;
  dhState: string;
  dhStateCompleted: string;
  dhStateCancelled: string;
  dhStateInterrupted: string;
  dhReveal: string;
  dhOpen: string;
  dhClear: string;
  dhClearConfirm: string;
  dhBytes: (n: number) => string;

  soundChoice: string;
  soundChoiceDescription: string;
  soundSystem: string;
  soundChime: string;
  soundPing: string;
  soundArpeggio: string;
  soundKnock: string;
  soundTick: string;
  soundPreview: string;
  volumeLabel: (percent: number) => string;
  volumeDescription: string;

  gmailCloseCompose: string;
  gmailCloseComposeDescription: string;

  vcAutoCopy: string;
  vcAutoCopyDescription: string;
  vcConfidence: string;
  vcConfidenceDescription: string;
  vcConfidenceMedium: string;
  vcConfidenceHigh: string;
  vcMarkRead: string;
  vcMarkReadDescription: string;
  vcDelete: string;
  vcDeleteDescription: string;
  vcDeleteWarning: string;
  vcNotWiredYet: string;

  addShort: string;
  renameAccount: string;

  notificationContent: string;
  showSender: string;
  showSenderDescription: string;
  showSubject: string;
  showSubjectDescription: string;
  testNotification: string;
  testNotificationDescription: string;
  testNotificationButton: string;
  soundGroup: string;
  playSound: string;
  playSoundDescription: string;
  googleAppsNotifications: string;
  googleAppsNotificationsDescription: string;
  downloadNotify: string;
  downloadNotifyDescription: string;
  downloadOnClick: string;
  downloadOnClickDescription: string;
  downloadClickShowInFolder: string;
  downloadClickOpenFile: string;
  downloadClickNothing: string;

  dnd: string;
  dndDescription: string;
  quietHours: string;
  quietHoursDescription: string;
  from: string;
  to: string;
  perAccountNotifications: string;
  mailToggle: string;
  mailToggleTitle: string;
  calendarToggle: string;
  calendarToggleTitle: string;
  badgeToggle: string;
  badgeToggleTitle: string;
  soundToggle: string;
  soundToggleTitle: string;
  persistToggle: string;
  persistToggleTitle: string;
  toggleNotApplicable: string;

  updates: string;
  versionPrefix: string;
  updateNow: string;
  updateReady: string;
  restartInstall: string;
  checkForUpdates: string;
  checking: string;
  updChecking: string;
  updAvailable: (version: string) => string;
  updLatest: string;
  updDownloading: (percent: number) => string;
  updDownloaded: string;
  updError: (message: string) => string;
  updDev: string;

  changelogVersionPrefix: string;
  showOlder: string;
  hideOlder: string;
  changelogEmpty: string;
  changelogCategory: (heading: string) => string;

  accountLabelField: string;
  accountColor: string;
  colorName: (hex: string) => string;
  removeAccount: string;
  removeConfirmBefore: string;
  removeConfirmAfter: string;
  remove: string;
  cancel: string;
  redetectLabel: string;
  redetect: string;
  redetectDescription: string;
  noAccounts: string;
  accountsFootnoteBefore: string;
  accountsFootnoteAfter: string;

  addAccountTooltip: string;
  addAccountLabel: string;
  addDelegatedLabel: string;
  delegatedTooltipSuffix: string;
  delegatedSuggestionsHeading: string;
  delegatedScanning: string;
  delegatedNoneFound: string;
  settingsTooltip: string;
}

function categoryKey(heading: string): 'added' | 'fixed' | 'changed' | 'removed' | 'security' | null {
  switch (heading.trim().toLowerCase()) {
    case 'added':
    case 'toegevoegd':
      return 'added';
    case 'fixed':
    case 'opgelost':
      return 'fixed';
    case 'changed':
    case 'gewijzigd':
      return 'changed';
    case 'removed':
    case 'verwijderd':
      return 'removed';
    case 'security':
    case 'beveiliging':
      return 'security';
    default:
      return null;
  }
}

export const CATEGORY_NORMAL: Record<string, string> = {
  added: 'New',
  fixed: 'Fixed',
  changed: 'Changed',
  removed: 'Removed',
  security: 'Security',
};

export const CATEGORY_RENE: Record<string, string> = {
  added: 'Nieuw',
  fixed: 'Gemaakt',
  changed: 'Anders',
  removed: 'Weg',
  security: 'Veilig',
};

export const CATEGORY_NL: Record<string, string> = {
  added: 'Toegevoegd',
  fixed: 'Opgelost',
  changed: 'Gewijzigd',
  removed: 'Verwijderd',
  security: 'Beveiliging',
};

type ColorKey = 'blue' | 'red' | 'green' | 'yellow' | 'purple' | 'teal';

const COLOR_KEYS: Record<string, ColorKey> = {
  '#4285f4': 'blue',
  '#ea4335': 'red',
  '#34a853': 'green',
  '#fbbc05': 'yellow',
  '#a142f4': 'purple',
  '#00acc1': 'teal',
};

export const COLOR_NORMAL: Record<ColorKey, string> = {
  blue: 'Blue',
  red: 'Red',
  green: 'Green',
  yellow: 'Yellow',
  purple: 'Purple',
  teal: 'Teal',
};

const COLOR_RENE: Record<ColorKey, string> = {
  blue: 'Blauw',
  red: 'Rood',
  green: 'Groen',
  yellow: 'Geel',
  purple: 'Paars',
  teal: 'Turkoois',
};

export const COLOR_NL: Record<ColorKey, string> = {
  blue: 'Blauw',
  red: 'Rood',
  green: 'Groen',
  yellow: 'Geel',
  purple: 'Paars',
  teal: 'Turkoois',
};

function colorKey(hex: string): ColorKey | null {
  return COLOR_KEYS[hex.trim().toLowerCase()] ?? null;
}

export const STRINGS_NORMAL: UiStrings = {
  numberLocale: 'en-US',

  close: 'Close',
  escKey: 'Esc',
  reneBanner: '🤓 Rene mode is on! Everything is big and easy.',

  navDownloadHistory: 'Download History',
  navGeneral: 'General',
  navAccounts: 'Accounts',
  navAppearance: 'Appearance',
  navDownloads: 'Downloads',
  navGmail: 'Gmail',
  navGoogleApps: 'Google Apps',
  navNotifications: 'Notifications',
  navPhishingProtection: 'Phishing Protection',
  navUpdates: 'Updates',
  navVerificationCodes: 'Verification Codes',
  navAdvanced: 'Advanced',
  navWhatsNew: "What's New",
  navAbout: 'About Gmail Desktop',
  settingsAttention: 'needs your attention',
  sectionEmpty: 'Nothing to set here yet.',

  defaultMailClient: 'Default Mail Client',
  defaultMailClientDescription:
    'Windows decides which app opens email links, so the choice is made there. This button takes you straight to it.',
  defaultMailIsDefault: 'Email links open in Gmail Desktop.',
  defaultMailNotDefault: 'Email links open in another app right now.',
  defaultMailSetButton: 'Set in Windows',
  defaultMailChangeButton: 'Change in Windows',
  startup: 'Startup',
  autoStart: 'Launch at Login',
  autoStartDescription:
    'Enable this option to automatically start the application when you log into your computer.',
  launchMinimized: 'Launch Minimized',
  launchMinimizedDescription: 'Enable this option to start the application in a minimized state.',
  mailDropFolder: 'Saved mail folder',
  mailDropHint:
    'Mail you drag into the strip at the top of Gmail is saved here as .eml, with a log.jsonl next to it',
  mailDropChoose: 'Choose…',
  mailDropOpen: 'Open',
  dropTitle: (t) => `${t} ${t === 1 ? 'conversation' : 'conversations'} moved`,
  dropSubtitle: (ok, m) => `${ok} saved — ${m} ${m === 1 ? 'message' : 'messages'} written to disk`,
  dropSavedCount: (m) => `${m} ${m === 1 ? 'message' : 'messages'} saved`,
  theme: 'Theme',
  themeDescription: 'Follow Windows, or keep the app light or dark whatever Windows does.',
  themeSystem: 'System',
  themeLight: 'Light',
  themeDark: 'Dark',
  language: 'Language',
  languageDescription: 'The language of this app. Gmail itself follows your Google account.',
  languageSystem: 'Same as Windows',
  languageEnglish: 'English',
  languageDutch: 'Nederlands',
  notificationOpenLabel: 'When you click a notification',
  notificationOpenDescription:
    'The message opens in the app, or in a separate Gmail window on top of it.',
  openInApp: 'Open in the app',
  openInWindow: 'Open in a new window',

  showUnreadBadges: 'Show Unread Badges',
  showUnreadBadgesDescription:
    'Hide all unread badges if disabled, regardless of individual account settings.',
  systemTray: 'System Tray Icon',
  trayEnabled: 'Enable System Tray Icon',
  trayEnabledDescription: 'Show the application icon in the system tray.',
  traySelectUnread: 'Select Account with Unread on Click',
  traySelectUnreadDescription:
    'Automatically select the first account with unread emails when clicking the system tray icon.',
  trayColourTodo:
    'The tray icon colour is not here yet: the icon is the app logo in colour, and a light or dark version needs its own monochrome image first.',
  windowGroup: 'Window',
  restrictMinWindowSize: 'Restrict Minimum Window Size',
  restrictMinWindowSizeDescription:
    'Limit the minimum size of the application window to prevent it from being too small.',

  saveAsDialog: 'Show Save As Dialog Before Downloading',
  saveAsDialogDescription: 'Prompt for a location each time before a file is downloaded.',
  openFolderWhenDone: 'Open Folder When Done',
  openFolderWhenDoneDescription:
    'Automatically open the folder containing the downloaded file when the download is complete.',
  downloadFolder: 'Default Download Location',
  downloadFolderDescription: 'This is the default location where downloaded files are saved.',
  downloadFolderDefault: "Using Windows' own Downloads folder.",
  change: 'Change…',
  mailDropGroup: 'Dragged mail',


  confirmExternalLinks: 'Confirm External Links Before Opening',
  confirmExternalLinksDescription:
    'Prompt for confirmation before opening links from untrusted hosts in your browser. The prompt shows you where the link actually goes — it does not judge whether the host is safe.',
  confirmExternalLinksGoogleNote:
    'Google’s own apps are never asked about: Gmail, Calendar, Drive, Docs, Keep, Contacts, Chat and signing in. The rest of google.com is — a page on sites.google.com holds whatever a stranger put there.',
  trustedHosts: 'Trusted Hosts',
  trustedHostsDescription:
    'Hosts you never get asked about. A host lands here when you tick "Always allow" in the prompt; subdomains of a trusted host are trusted too.',
  trustedHostsEmpty: 'No trusted hosts added.',
  trustedHostRemove: (host) => `Stop trusting ${host}`,

  autoCheckUpdates: 'Check For Updates Automatically',
  autoCheckUpdatesDescription: 'Automatically check for updates periodically.',
  notifyUpdates: 'Notify When Updates Are Available',
  notifyUpdatesDescription: 'Receive notifications when updates are available.',

  miscellaneous: 'Miscellaneous',
  hardwareAcceleration: 'Hardware Acceleration',
  hardwareAccelerationDescription:
    'Enabling hardware acceleration can improve performance but can also cause compatibility issues on some systems.',
  restartRequired: 'Takes effect the next time the app starts.',

  gmailComposeGroup: 'Compose',
  gmailComposeNewWindow: 'Always Compose New Emails in New Window',
  gmailComposeNewWindowDescription:
    'Opens a new window for composing emails instead of inside Gmail.',

  gaOpenInApp: 'Open in App',
  gaOpenInAppDescription: 'Open Google Apps in app instead of external browser.',
  gaAlwaysNewWindow: 'Always Open in New Window',
  gaAlwaysNewWindowDescription:
    'Always open Google Apps in a new window instead of reusing the same window if it is already open.',
  gaExcluded: 'Excluded Apps',
  gaExcludedDescription:
    'Select which Google Apps should open in the external browser instead of the app.',
  gaExcludedAllExternal:
    'Every Google App already opens in the external browser, so there is nothing left to exclude. Turn on Open in App to choose per app.',
  gaExcludedAllNewWindow:
    'Always Open in New Window gives every Google App its own window in the app, so this list has no say. Turn that off to choose per app.',
  gaExcludedNone: 'None',
  gaShowAccountLabel: 'Show Account Label',
  gaShowAccountLabelDescription:
    'Show the account name in the title bar of a Google App window, when you use more than one account.',
  gaShowAccountColor: 'Show Account Color',
  gaShowAccountColorDescription:
    'Tint a Google App window in the account colour while it loads, so you can see whose it is.',
  gaPinned: 'Pinned Apps',
  gaPinnedDescription:
    'Pick the apps you reach for most. The bar at the top does not draw them yet — that is the next step; for now they are also in the right-click menu of an account tab.',
  gaPinnedHeading: 'Pinned',
  gaAvailableHeading: 'Available',
  gaPin: (name) => `Pin ${name}`,
  gaUnpin: (name) => `Unpin ${name}`,

  dhEmpty: 'Nothing downloaded yet.',
  dhFile: 'File',
  dhSize: 'Size',
  dhWhen: 'When',
  dhState: 'State',
  dhStateCompleted: 'Done',
  dhStateCancelled: 'Cancelled',
  dhStateInterrupted: 'Failed',
  dhReveal: 'Show in folder',
  dhOpen: 'Open',
  dhClear: 'Clear list',
  dhClearConfirm: "Clear the whole list? This can't be undone.",
  dhBytes: (n) => `${n} bytes`,

  soundChoice: 'Sound',
  soundChoiceDescription: 'Select the sound to play for notifications.',
  soundSystem: 'System sound',
  soundChime: 'Chime',
  soundPing: 'Ping',
  soundArpeggio: 'Arpeggio',
  soundKnock: 'Knock',
  soundTick: 'Tick',
  soundPreview: 'Play',
  volumeLabel: (percent) => `Volume ${percent}%`,
  volumeDescription: 'Set the volume level for notification sounds.',

  gmailCloseCompose: 'Close Compose Window After Send',
  gmailCloseComposeDescription:
    'Automatically closes the compose window after pressing the send button. Only applies to a compose window the app opened itself.',

  vcAutoCopy: 'Automatically Copy Verification Code to Clipboard',
  vcAutoCopyDescription:
    'Verification code received via email will be automatically copied to your clipboard for easy and instant pasting.',
  vcConfidence: 'Verification Code Detection Confidence',
  vcConfidenceDescription:
    'Choose the confidence level for detecting verification codes. Medium may result in false positives, while High checks for explicit keywords, but may miss some codes.',
  vcConfidenceMedium: 'Medium',
  vcConfidenceHigh: 'High',
  vcMarkRead: 'Automatically Mark Email as Read After Copying Verification Code',
  vcMarkReadDescription:
    'Email containing verification code will be automatically marked as read after the code has been copied to your clipboard.',
  vcDelete: 'Automatically Delete Email After Copying Verification Code',
  vcDeleteDescription:
    'Email containing verification code will be automatically deleted after the code has been copied to your clipboard.',
  vcDeleteWarning:
    'A wrongly detected code means a real email goes to the bin. This is why High confidence is recommended — and why this one is off by default.',
  vcNotWiredYet:
    'Codes are read through the Gmail API, so this only covers accounts connected for it — the same connection notifications use. Marking read and binning need an extra Google permission; if you have not given consent since it was added, re-link the account.',

  addShort: 'Add',
  renameAccount: 'Rename account',

  notificationContent: 'What a notification says',
  showSender: 'Show Sender',
  showSenderDescription: "Display the email sender's name in notifications.",
  showSubject: 'Show Subject',
  showSubjectDescription: 'Display the email subject in notifications.',
  testNotification: 'Test Notification',
  testNotificationDescription: 'Show a test notification to see how notifications will appear.',
  testNotificationButton: 'Show Test Notification',
  soundGroup: 'Sound',
  playSound: 'Play Sound',
  playSoundDescription:
    'Play a sound when showing a notification. Off is silent for every account, whatever they are set to.',
  googleAppsNotifications: 'Google Apps',
  googleAppsNotificationsDescription:
    'Allow notifications from Google Apps like Calendar. Off silences them for every account.',
  downloadNotify: 'Show Notification',
  downloadNotifyDescription: 'Show a notification when a download is completed, cancelled or failed.',
  downloadOnClick: 'On Click',
  downloadOnClickDescription: 'Choose what happens when clicking the download notification.',
  downloadClickShowInFolder: 'Show in folder',
  downloadClickOpenFile: 'Open the file',
  downloadClickNothing: 'Do nothing',

  dnd: 'Do not disturb (mute all)',
  dndDescription: 'No notifications and no sounds for any account until you turn this off.',
  quietHours: 'Quiet hours',
  quietHoursDescription: 'Notifications are held back between the times below.',
  from: 'From',
  to: 'to',
  perAccountNotifications: 'Per account',
  mailToggle: 'Mail',
  mailToggleTitle: 'Mail notifications for this account',
  calendarToggle: 'Calendar',
  calendarToggleTitle: 'Calendar reminders for this account',
  badgeToggle: 'Badge',
  badgeToggleTitle: "Count this mailbox's unread mail — on the taskbar badge and its tab",
  soundToggle: 'Sound',
  soundToggleTitle: 'Play a sound with notifications for this account',
  persistToggle: 'Persist',
  persistToggleTitle: 'Keep notifications on screen until you dismiss them',
  toggleNotApplicable: 'Not available for this account',

  updates: 'Updates',
  versionPrefix: 'Version',
  updateNow: 'Update now',
  updateReady: 'Update ready',
  restartInstall: 'Restart & install',
  checkForUpdates: 'Check for updates',
  checking: 'Checking…',
  updChecking: 'Checking for updates…',
  updAvailable: (version) => `Update available: v${version}`,
  updLatest: "You're on the latest version.",
  updDownloading: (percent) => `Downloading update… ${percent}%`,
  updDownloaded: 'Update downloaded — restarting to install…',
  updError: (message) => `Couldn't check for updates: ${message}`,
  updDev: 'Updates are only available in the installed app.',

  changelogVersionPrefix: 'Version',
  showOlder: 'Show older versions',
  hideOlder: 'Hide older versions',
  changelogEmpty: 'No release notes available.',
  changelogCategory: (heading) => {
    const key = categoryKey(heading);
    return key ? CATEGORY_NORMAL[key] : '';
  },

  accountLabelField: 'Account name',
  accountColor: 'Account colour',
  colorName: (hex) => {
    const key = colorKey(hex);
    return key ? COLOR_NORMAL[key] : hex;
  },
  removeAccount: 'Remove account',
  removeConfirmBefore:
    'Remove this account from the app? It stays signed in with Google — re-add it later with the ',
  removeConfirmAfter: ' button.',
  remove: 'Remove',
  cancel: 'Cancel',
  redetectLabel: 'Account detection',
  redetect: 'Re-detect accounts',
  redetectDescription: 'Looks again at the Google accounts you are signed in to.',
  noAccounts: 'No accounts detected yet.',
  accountsFootnoteBefore:
    'Accounts are detected from the Google accounts you are signed into. Use the ',
  accountsFootnoteAfter:
    " button in the sidebar to sign in to a new account, or add one via Gmail's own account switcher and then re-detect.",

  addAccountTooltip: 'Add account',
  addAccountLabel: 'Add account',
  addDelegatedLabel: 'Add delegated mailbox',
  delegatedTooltipSuffix: "(delegated — someone else's mailbox)",
  delegatedSuggestionsHeading: 'Suggested delegated',
  delegatedScanning: 'Looking in your account menu…',
  delegatedNoneFound: 'No delegated mailboxes found.',
  settingsTooltip: 'Settings',
};

export const STRINGS_RENE: UiStrings = {
  numberLocale: 'nl-NL',

  close: 'Sluiten',
  escKey: 'Esc',
  reneBanner: '🤓 De Rene-stand staat aan! Alles is groot en makkelijk.',

  navDownloadHistory: 'Wat je hebt gehaald',
  navGeneral: 'Gewoon',
  navAccounts: 'Wie doet mee?',
  navAppearance: 'Hoe het eruitziet',
  navDownloads: 'Wat je haalt',
  navGmail: 'Gmail',
  navGoogleApps: 'Google-dingen',
  navNotifications: 'Meldingen',
  navPhishingProtection: 'Nepmail',
  navUpdates: 'Nieuwe versie',
  navVerificationCodes: 'Codes',
  navAdvanced: 'Voor knutselaars',
  navWhatsNew: 'Wat is er nieuw?',
  navAbout: 'Over de app',
  settingsAttention: 'kijk hier even',
  sectionEmpty: 'Hier is nog niks om te zetten.',

  defaultMailClient: 'Mail gaat door deze app',
  defaultMailClientDescription:
    'Windows kiest welke app een mail-adres opent. Met deze knop ga je er naartoe en kies je deze app.',
  defaultMailIsDefault: 'Klik je op een mail-adres, dan gaat het door deze app.',
  defaultMailNotDefault: 'Klik je op een mail-adres, dan gaat het nu nog door een andere app.',
  defaultMailSetButton: 'Zet het goed',
  defaultMailChangeButton: 'Verander het',
  startup: 'Als de computer aan gaat',
  autoStart: 'De app gaat zelf aan',
  autoStartDescription: 'De app gaat open als je de computer aanzet.',
  launchMinimized: 'Klein beginnen',
  launchMinimizedDescription: 'De app gaat aan, maar je ziet hem nog niet. Hij staat onderin te wachten.',
  mailDropFolder: 'Waar de mailtjes komen',
  mailDropHint: 'Sleep een mailtje naar de balk boven Gmail. Dan komt hij hier te staan.',
  mailDropChoose: 'Kies map',
  mailDropOpen: 'Laat zien',
  dropTitle: (t) => `${t} ${t === 1 ? 'mailtje' : 'mailtjes'} verplaatst`,
  dropSubtitle: (ok, m) => `${ok} gelukt — ${m} ${m === 1 ? 'bericht' : 'berichten'} bewaard`,
  dropSavedCount: (m) => `${m} ${m === 1 ? 'bericht' : 'berichten'} bewaard`,
  theme: 'Kleur',
  themeDescription: 'Licht of donker. Of laat de computer het kiezen.',
  themeSystem: 'De computer kiest',
  themeLight: 'Licht',
  themeDark: 'Donker',
  language: 'Taal',
  languageDescription: 'De taal van deze app. Gmail zelf gaat mee met je Google-account.',
  languageSystem: 'Net als de computer',
  languageEnglish: 'English',
  languageDutch: 'Nederlands',
  notificationOpenLabel: 'Als je op een melding klikt',
  notificationOpenDescription: 'De mail gaat open in de app, of in een eigen raam ervoor.',
  openInApp: 'In de app',
  openInWindow: 'In een nieuw raam',

  showUnreadBadges: 'Laat de getallen zien',
  showUnreadBadgesDescription:
    'Zet je dit uit, dan zie je nergens meer een getal. Ook niet bij iemand waar het aan staat.',
  systemTray: 'Het knopje onderin',
  trayEnabled: 'Laat het knopje onderin zien',
  trayEnabledDescription: 'Het plaatje van de app komt onderin je scherm te staan.',
  traySelectUnread: 'Ga naar nieuwe post',
  traySelectUnreadDescription:
    'Klik je op het knopje onderin, dan gaat de app naar de eerste met nieuwe post.',
  trayColourTodo:
    'De kleur van dat knopje kan nog niet. Daar is eerst een plaatje in één kleur voor nodig.',
  windowGroup: 'Het raam',
  restrictMinWindowSize: 'Niet te klein maken',
  restrictMinWindowSizeDescription: 'Het raam kan niet kleiner dan de balk aankan.',

  saveAsDialog: 'Vraag waar het heen moet',
  saveAsDialogDescription: 'De app vraagt elke keer in welke map het bestand moet.',
  openFolderWhenDone: 'Laat de map zien als het klaar is',
  openFolderWhenDoneDescription: 'Is het bestand binnen? Dan gaat de map open.',
  downloadFolder: 'Waar de bestanden komen',
  downloadFolderDescription: 'Hier komt alles te staan wat je ophaalt.',
  downloadFolderDefault: 'Nu de gewone map van de computer.',
  change: 'Kies map',
  mailDropGroup: 'Gesleepte mailtjes',


  confirmExternalLinks: 'Vraag het eerst bij een link',
  confirmExternalLinksDescription:
    'Klik je op een link in een mail? Dan laat de app eerst zien waar hij heen gaat.',
  confirmExternalLinksGoogleNote:
    'Over Google zelf vraagt de app niks: Gmail, Agenda, Drive, Documenten, Keep, Contacten, Chat en inloggen. Andere Google-pagina’s wel, want daar kan iemand anders iets neergezet hebben.',
  trustedHosts: 'Deze zijn goed',
  trustedHostsDescription:
    'Bij deze vraagt de app niks meer. Ze komen hier als je in het venster "altijd goed" aanvinkt.',
  trustedHostsEmpty: 'Er staat nog niks.',
  trustedHostRemove: (host) => `Haal ${host} weg`,

  autoCheckUpdates: 'Kijk zelf of er iets nieuws is',
  autoCheckUpdatesDescription: 'De app kijkt af en toe of er een nieuwe versie is.',
  notifyUpdates: 'Zeg het als er iets nieuws is',
  notifyUpdatesDescription: 'Je krijgt een melding als er een nieuwe versie klaarstaat.',

  miscellaneous: 'Van alles',
  hardwareAcceleration: 'Snel tekenen',
  hardwareAccelerationDescription:
    'Dit maakt de app sneller. Ziet het scherm er raar uit? Zet het dan uit.',
  restartRequired: 'Dit werkt pas als de app opnieuw opstart.',

  gmailComposeGroup: 'Mail maken',
  gmailComposeNewWindow: 'Maak mail in een eigen venster',
  gmailComposeNewWindowDescription:
    'Een nieuwe mail gaat in een apart venster, niet in het hoekje van Gmail.',

  gaOpenInApp: 'Open in de app',
  gaOpenInAppDescription: 'Open Google-dingen in de app en niet in je browser.',
  gaAlwaysNewWindow: 'Altijd in een nieuw venster',
  gaAlwaysNewWindowDescription:
    'Doe een Google-ding altijd in een nieuw venster open, ook als er al een venster open staat.',
  gaExcluded: 'Dingen die niet in de app gaan',
  gaExcludedDescription: 'Kies welke Google-dingen in je browser open gaan en niet in de app.',
  gaExcludedAllExternal:
    'Alle Google-dingen gaan nu al naar je browser, dus er is niks meer om uit te zetten. Zet "Open in de app" aan als je per ding wil kiezen.',
  gaExcludedAllNewWindow:
    'Met "Altijd in een nieuw venster" krijgt elk Google-ding zijn eigen venster in de app. Deze lijst doet dan niks. Zet die schakelaar uit als je per ding wil kiezen.',
  gaExcludedNone: 'Geen',
  gaShowAccountLabel: 'Naam van het account laten zien',
  gaShowAccountLabelDescription:
    'De naam van het account staat bovenaan het venster, als je meer dan één account hebt.',
  gaShowAccountColor: 'Kleur van het account laten zien',
  gaShowAccountColorDescription:
    'Het venster krijgt even het kleurtje van het account, zodat je ziet van wie het is.',
  gaPinned: 'Vaste dingen',
  gaPinnedDescription:
    'Kies welke dingen je het meest gebruikt. De balk bovenaan laat ze nog niet zien — dat komt nog.',
  gaPinnedHeading: 'Vast',
  gaAvailableHeading: 'Te kiezen',
  gaPin: (name) => `Zet ${name} vast`,
  gaUnpin: (name) => `Haal ${name} weg`,

  dhEmpty: 'Je hebt nog niks gehaald.',
  dhFile: 'Bestand',
  dhSize: 'Hoe groot',
  dhWhen: 'Wanneer',
  dhState: 'Hoe het ging',
  dhStateCompleted: 'Klaar',
  dhStateCancelled: 'Gestopt',
  dhStateInterrupted: 'Ging mis',
  dhReveal: 'Laat de map zien',
  dhOpen: 'Doe hem open',
  dhClear: 'Maak de lijst leeg',
  dhClearConfirm: 'Wil je de hele lijst weggooien? Dat kan niet terug.',
  dhBytes: (n) => `${n} bytes`,

  soundChoice: 'Welk geluidje',
  soundChoiceDescription: 'Kies wat je hoort bij een melding.',
  soundSystem: 'Het geluid van de computer',
  soundChime: 'Belletje',
  soundPing: 'Piepje',
  soundArpeggio: 'Trapje omhoog',
  soundKnock: 'Klopje',
  soundTick: 'Tikje',
  soundPreview: 'Laat horen',
  volumeLabel: (percent) => `Hoe hard: ${percent}%`,
  volumeDescription: 'Hoe hard het geluidje is.',

  gmailCloseCompose: 'Doe het venster dicht na versturen',
  gmailCloseComposeDescription:
    'Heb je de mail verstuurd? Dan gaat het venster zelf dicht. Alleen bij een venster dat de app zelf opende.',

  vcAutoCopy: 'Zet de code op het klembord',
  vcAutoCopyDescription: 'Krijg je een code in een mailtje? Dan kan je hem meteen plakken.',
  vcConfidence: 'Hoe zeker moet de app zijn?',
  vcConfidenceDescription:
    'Bij "Heel zeker" zoekt de app naar het woord code in het mailtje. Bij "Beetje zeker" pakt hij ook losse cijfers, maar dan zit hij er soms naast.',
  vcConfidenceMedium: 'Beetje zeker',
  vcConfidenceHigh: 'Heel zeker',
  vcMarkRead: 'Zet het mailtje op gelezen',
  vcMarkReadDescription: 'Als de code op het klembord staat, is het mailtje gelezen.',
  vcDelete: 'Gooi het mailtje weg',
  vcDeleteDescription: 'Als de code op het klembord staat, gaat het mailtje in de prullenbak.',
  vcDeleteWarning:
    'Pas op! Ziet de app iets aan voor een code, dan gooit hij een echt mailtje weg. Daarom staat dit uit.',
  vcNotWiredYet:
    'Dit werkt bij de namen die aan Google zijn gekoppeld — dezelfde die je een belletje geven. Voor gelezen zetten en weggooien moet Google de app iets extra toestaan; heb je dat nog niet gedaan, koppel de naam dan opnieuw.',

  addShort: 'Erbij',
  renameAccount: 'Geef hem een andere naam',

  notificationContent: 'Wat er in een melding staat',
  showSender: 'Van wie het is',
  showSenderDescription: 'De naam van wie het stuurde staat in de melding.',
  showSubject: 'Waar het over gaat',
  showSubjectDescription: 'Het onderwerp van de mail staat in de melding.',
  testNotification: 'Even proberen',
  testNotificationDescription: 'Laat één melding zien, zodat je ziet hoe het eruitziet.',
  testNotificationButton: 'Laat zien',
  soundGroup: 'Geluid',
  playSound: 'Maak een geluidje',
  playSoundDescription: 'Zet je dit uit, dan is het stil. Ook bij iemand waar geluid aan staat.',
  googleAppsNotifications: 'Google-dingen',
  googleAppsNotificationsDescription: 'Meldingen van de agenda en andere Google-dingen.',
  downloadNotify: 'Zeg het als iets binnen is',
  downloadNotifyDescription: 'Je krijgt een melding als een bestand klaar is of niet lukte.',
  downloadOnClick: 'Als je erop klikt',
  downloadOnClickDescription: 'Wat er gebeurt als je op die melding klikt.',
  downloadClickShowInFolder: 'Laat de map zien',
  downloadClickOpenFile: 'Doe het bestand open',
  downloadClickNothing: 'Niks',

  dnd: 'Even stil zijn',
  dndDescription: 'Je krijgt geen meldingen en hoort niks, tot je dit weer uitzet.',
  quietHours: 'Stille uren',
  quietHoursDescription: 'Tussen deze tijden krijg je geen meldingen.',
  from: 'Van',
  to: 'tot',
  perAccountNotifications: 'Wie krijgt wat?',
  mailToggle: 'Post',
  mailToggleTitle: 'Meldingen voor de post van deze meneer of mevrouw',
  calendarToggle: 'Agenda',
  calendarToggleTitle: 'Meldingen voor de agenda van deze meneer of mevrouw',
  badgeToggle: 'Getal',
  badgeToggleTitle: 'Tel de post van deze meneer of mevrouw mee, op de knop en op het tabblad',
  soundToggle: 'Geluid',
  soundToggleTitle: 'Speel een geluidje bij meldingen voor deze meneer of mevrouw',
  persistToggle: 'Blijft staan',
  persistToggleTitle: 'Meldingen blijven op het scherm staan tot u ze wegklikt',
  toggleNotApplicable: 'Kan niet bij deze meneer of mevrouw',

  updates: 'Nieuwe versie',
  versionPrefix: 'Versie',
  updateNow: 'Doe maar!',
  updateReady: 'Update klaar',
  restartInstall: 'Opnieuw opstarten',
  checkForUpdates: 'Is er iets nieuws?',
  checking: 'Even kijken…',
  updChecking: 'Even kijken…',
  updAvailable: (version) => `Er is iets nieuws: v${version}`,
  updLatest: 'Je hebt al het nieuwste.',
  updDownloading: (percent) => `Het komt eraan… ${percent}%`,
  updDownloaded: 'Het is er! De app gaat uit en aan…',
  updError: (message) => `Het lukt nu niet: ${message}`,
  updDev: 'Dit kan alleen in de echte app.',

  changelogVersionPrefix: 'Versie',
  showOlder: 'Laat oude dingen zien',
  hideOlder: 'Verberg oude dingen',
  changelogEmpty: 'Er is nog niks om te laten zien.',
  changelogCategory: (heading) => {
    const key = categoryKey(heading);
    return key ? CATEGORY_RENE[key] : '';
  },

  accountLabelField: 'Naam',
  accountColor: 'Kleur',
  colorName: (hex) => {
    const key = colorKey(hex);
    return key ? COLOR_RENE[key] : hex;
  },
  removeAccount: 'Weg ermee',
  removeConfirmBefore: 'Mag deze weg uit de app? Je kan hem later weer terug doen met de ',
  removeConfirmAfter: ' knop.',
  remove: 'Weg',
  cancel: 'Nee',
  redetectLabel: 'Accounts zoeken',
  redetect: 'Zoek nog een keer',
  redetectDescription: 'De app kijkt nog een keer wie er mee doet.',
  noAccounts: 'Er is nog niemand.',
  accountsFootnoteBefore: 'De app zoekt zelf wie er mee doet. Druk op de ',
  accountsFootnoteAfter: ' om er iemand bij te doen.',

  addAccountTooltip: 'Doe er iemand bij',
  addAccountLabel: 'Doe er iemand bij',
  addDelegatedLabel: 'Doe een gedeelde postbus erbij',
  delegatedTooltipSuffix: '(de postbus van iemand anders)',
  delegatedSuggestionsHeading: 'Gevonden postbussen',
  delegatedScanning: 'Even in je accountmenu kijken…',
  delegatedNoneFound: 'Geen gedeelde postbussen gevonden.',
  settingsTooltip: 'Knopjes',
};

// Filled in with real Dutch by the translation task; a spread of the English set keeps
// the app compiling and running until then.
export const STRINGS_NL: UiStrings = {
  ...STRINGS_NORMAL,
  language: 'Taal',
  languageDescription: 'De taal van deze app. Gmail zelf volgt de taal van je Google-account.',
  languageSystem: 'Gelijk aan Windows',
  languageEnglish: 'English',
  languageDutch: 'Nederlands',
  changelogCategory: (heading) => {
    const key = categoryKey(heading);
    return key ? CATEGORY_NL[key] : '';
  },
  colorName: (hex) => {
    const key = colorKey(hex);
    return key ? COLOR_NL[key] : hex;
  },
};

export function getStrings(locale: Locale, reneMode: boolean): UiStrings {
  if (reneMode) return STRINGS_RENE;
  return locale === 'nl' ? STRINGS_NL : STRINGS_NORMAL;
}
