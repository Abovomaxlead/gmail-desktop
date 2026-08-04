// All user-facing text in the app's own chrome (sidebar + settings), in two
// flavors: the normal English UI and Rene mode's simple Dutch — short words a
// four-year-old can read. Gmail's own page content is Google's and stays as-is.

export interface UiStrings {
  // Not text on screen but a formatting choice that belongs to the language:
  // which separator groups the thousands in an unread count (1.324 vs 1,324).
  numberLocale: string;

  close: string;
  // Het opschrift onder de sluitknop: de naam van de toets die hetzelfde doet.
  escKey: string;
  reneBanner: string;

  // De namen in de navigatiekolom. Ze zijn óók de kop boven de sectie zelf: er is
  // één naam per sectie, en die staat op twee plekken hetzelfde. Twee sleutels per
  // sectie leverde twee namen voor hetzelfde ding op ("Algemeen" in de kolom,
  // "Algemeen" erboven), en bij negentien secties is dat negentien kansen om uit
  // elkaar te lopen. Kort houden blijft nodig: de kolom is 240px.
  navDownloadHistory: string;
  navGeneral: string;
  navAccounts: string;
  navAppearance: string;
  navBlocker: string;
  navDownloads: string;
  navGmail: string;
  navGoogleApps: string;
  navLanguages: string;
  navNotifications: string;
  navPhishingProtection: string;
  navUnifiedInbox: string;
  navUpdates: string;
  navVerificationCodes: string;
  navAdvanced: string;
  navWhatsNew: string;
  navAbout: string;
  // Het puntje in de navigatie heeft geen vorm die iets zegt, dus staat er voor
  // een schermlezer tekst achter de sectienaam: "Notifications, needs your
  // attention". Formuleer zo dat het achter een sectienaam voorleesbaar blijft.
  settingsAttention: string;
  // Wat er in een sectie staat waar nog niets is ingericht. Eén tekst voor alle
  // lege secties: het is dezelfde mededeling, en per sectie een eigen formulering
  // zou suggereren dat er per sectie iets anders aan de hand is.
  sectionEmpty: string;

  defaultMailClient: string;
  defaultMailClientDescription: string;
  startup: string; // de kop van de groep met de opstartkeuzes
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
  notificationOpenLabel: string;
  notificationOpenDescription: string;
  openInApp: string;
  openInWindow: string;

  // Weergave. `windowGroup` heet zo en niet `window`, omdat dat woord in
  // `Prefs.window` al de vensterafmetingen is.
  showUnreadBadges: string;
  showUnreadBadgesDescription: string;
  systemTray: string;
  trayEnabled: string;
  trayEnabledDescription: string;
  traySelectUnread: string;
  traySelectUnreadDescription: string;
  // Waarom de kleur van het tray-icoon er nog niet is. Een regel in beeld en geen
  // schakelaar die niets doet.
  trayColourTodo: string;
  windowGroup: string;
  restrictMinWindowSize: string;
  restrictMinWindowSizeDescription: string;

  // Downloads.
  saveAsDialog: string;
  saveAsDialogDescription: string;
  openFolderWhenDone: string;
  openFolderWhenDoneDescription: string;
  downloadFolder: string;
  downloadFolderDescription: string;
  downloadFolderDefault: string; // staat er alleen zolang de gebruiker niets koos
  change: string;
  mailDropGroup: string; // de kop boven de map voor gesleepte mail

  // Talen.
  spellchecker: string;
  spellcheckerDescription: string;
  spellcheckerUnavailable: string;
  spellcheckerNone: string;
  spellcheckerChosen: (count: number) => string;
  spellcheckerSystemNote: string;

  // Phishing Protection.
  confirmExternalLinks: string;
  confirmExternalLinksDescription: string;
  trustedHosts: string;
  trustedHostsDescription: string;
  trustedHostsEmpty: string;
  trustedHostRemove: (host: string) => string;

  // Bijwerken.
  autoCheckUpdates: string;
  autoCheckUpdatesDescription: string;
  notifyUpdates: string;
  notifyUpdatesDescription: string;

  // Geavanceerd.
  miscellaneous: string;
  hardwareAcceleration: string;
  hardwareAccelerationDescription: string;
  restartRequired: string;

  // Meldingen, de nieuwe blokken.
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
  soundChoiceTodo: string;
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
  // De schakelaars per account staan in Meldingen en niet bij Accounts: Accounts
  // gaat over wie er meedoet, Meldingen over wat je bereikt. De korte sleutel is
  // de kolomkop in het rooster, de `*Title` de volledige tekst — die is de
  // toegankelijke naam van het vakje en de tooltip van de kolom.
  perAccountNotifications: string; // de kop van het blok met het rooster
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
  // Wat er in een cel staat die voor dat account niet bestaat — een account
  // zonder agenda. Alleen voor een schermlezer; in beeld staat er een streepje.
  toggleNotApplicable: string;

  updates: string; // de naam van de rij met de updatestatus en zijn knoppen
  versionPrefix: string;
  updateNow: string;
  updateReady: string; // the topbar button that appears once an update is downloaded
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

  changelogVersionPrefix: string; // e.g. "Version" — shown before the number in each entry
  showOlder: string;
  hideOlder: string;
  changelogEmpty: string;
  changelogCategory: (heading: string) => string; // localizes a known "### Category" label

  accountLabelField: string; // de naam van het naamveld in een accountkaart
  accountColor: string; // de naam van de groep kleurstaaltjes
  colorName: (hex: string) => string; // de naam van één staaltje, voor een schermlezer
  removeAccount: string;
  removeConfirmBefore: string; // text before the styled "+" in the confirm box
  removeConfirmAfter: string;
  remove: string;
  cancel: string;
  // De rij met de zoek-opnieuw-knop. `redetectLabel` is de naam van de rij en
  // `redetect` de tekst op de knop erin; de rij mag niet `navAccounts` gebruiken,
  // want dat woord staat al als kop boven de sectie.
  redetectLabel: string;
  redetect: string;
  redetectDescription: string;
  noAccounts: string;
  accountsFootnoteBefore: string; // text before the styled "+" in the footnote
  accountsFootnoteAfter: string;

  addAccountTooltip: string;
  addAccountLabel: string;
  addDelegatedLabel: string;
  delegatedTooltipSuffix: string; // appended to a delegated tab's tooltip, explaining its marker
  delegatedSuggestionsHeading: string;
  delegatedScanning: string;
  delegatedNoneFound: string;
  settingsTooltip: string;
}

// Maps a known changelog category heading (English or Dutch, any case) to a
// canonical key, so both language variants can relabel it. Unknown headings
// (or the implicit empty heading) return null and render without a label.
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

const CATEGORY_NORMAL: Record<string, string> = {
  added: 'New',
  fixed: 'Fixed',
  changed: 'Changed',
  removed: 'Removed',
  security: 'Security',
};

const CATEGORY_RENE: Record<string, string> = {
  added: 'Nieuw',
  fixed: 'Gemaakt',
  changed: 'Anders',
  removed: 'Weg',
  security: 'Veilig',
};

// De zes tinten die een account kan krijgen, in woorden. Een staaltje zonder
// naam is voor een schermlezer een knop zonder inhoud, en "#4285F4" wordt niet
// als een kleur voorgelezen. Onbekende waarden geven de hex terug: beter iets dan
// niets, en de lijst kan zonder schade uitgebreid worden.
type ColorKey = 'blue' | 'red' | 'green' | 'yellow' | 'purple' | 'teal';

const COLOR_KEYS: Record<string, ColorKey> = {
  '#4285f4': 'blue',
  '#ea4335': 'red',
  '#34a853': 'green',
  '#fbbc05': 'yellow',
  '#a142f4': 'purple',
  '#00acc1': 'teal',
};

const COLOR_NORMAL: Record<ColorKey, string> = {
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
  navBlocker: 'Blocker',
  navDownloads: 'Downloads',
  navGmail: 'Gmail',
  navGoogleApps: 'Google Apps',
  navLanguages: 'Languages',
  navNotifications: 'Notifications',
  navPhishingProtection: 'Phishing Protection',
  navUnifiedInbox: 'Unified Inbox',
  navUpdates: 'Updates',
  navVerificationCodes: 'Verification Codes',
  navAdvanced: 'Advanced',
  navWhatsNew: "What's New",
  navAbout: 'About Gmail Desktop',
  settingsAttention: 'needs your attention',
  sectionEmpty: 'Nothing to set here yet.',

  defaultMailClient: 'Default Mail Client',
  defaultMailClientDescription:
    'Set Gmail Desktop as the default mail client to handle email links and related protocols.',
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

  spellchecker: 'Spellchecker',
  spellcheckerDescription:
    'Select additional languages for spellchecking alongside the system language.',
  spellcheckerUnavailable: 'This build has no spellchecker dictionaries available.',
  spellcheckerNone: 'No additional languages selected.',
  spellcheckerChosen: (count) => `${count} additional ${count === 1 ? 'language' : 'languages'} selected.`,
  spellcheckerSystemNote: 'Your system language is always checked, whatever you pick here.',

  confirmExternalLinks: 'Confirm External Links Before Opening',
  confirmExternalLinksDescription:
    'Prompt for confirmation before opening links from untrusted hosts in your browser. The prompt shows you where the link actually goes — it does not judge whether the host is safe.',
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
  soundChoiceTodo:
    'Picking a different sound and setting its volume are not here yet: notifications use the sound Windows plays for them, and choosing another one needs the app to ship its own audio.',
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
  navBlocker: 'Wat weg mag',
  navDownloads: 'Wat je haalt',
  navGmail: 'Gmail',
  navGoogleApps: 'Google-dingen',
  navLanguages: 'Talen',
  navNotifications: 'Meldingen',
  navPhishingProtection: 'Nepmail',
  navUnifiedInbox: 'Alles bij elkaar',
  navUpdates: 'Nieuwe versie',
  navVerificationCodes: 'Codes',
  navAdvanced: 'Voor knutselaars',
  navWhatsNew: 'Wat is er nieuw?',
  navAbout: 'Over de app',
  settingsAttention: 'kijk hier even',
  sectionEmpty: 'Hier is nog niks om te zetten.',

  defaultMailClient: 'Mail gaat door deze app',
  defaultMailClientDescription:
    'Klik je ergens op een mail-adres? Dan gaat dat mailtje open in deze app.',
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

  spellchecker: 'Spelling',
  spellcheckerDescription: 'Kies talen waarin de app meekijkt of je goed schrijft.',
  spellcheckerUnavailable: 'Er zijn nu geen woordenboeken.',
  spellcheckerNone: 'Nog geen extra taal gekozen.',
  spellcheckerChosen: (count) => `${count} ${count === 1 ? 'taal' : 'talen'} erbij.`,
  spellcheckerSystemNote: 'De taal van je computer doet altijd mee.',

  confirmExternalLinks: 'Vraag het eerst bij een link',
  confirmExternalLinksDescription:
    'Klik je op een link in een mail? Dan laat de app eerst zien waar hij heen gaat.',
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
  soundChoiceTodo:
    'Een ander geluidje kiezen kan nog niet. De app gebruikt nu het geluid van Windows zelf.',
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

export function getStrings(reneMode: boolean): UiStrings {
  return reneMode ? STRINGS_RENE : STRINGS_NORMAL;
}
