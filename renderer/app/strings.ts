// All user-facing text in the app's own chrome (sidebar + settings), in two
// flavors: the normal English UI and Rene mode's simple Dutch — short words a
// four-year-old can read. Gmail's own page content is Google's and stays as-is.

export interface UiStrings {
  // Not text on screen but a formatting choice that belongs to the language:
  // which separator groups the thousands in an unread count (1.324 vs 1,324).
  numberLocale: string;

  settingsTitle: string;
  save: string;
  saved: string;
  close: string;
  reneBanner: string;

  // De namen in de navigatiekolom. Kort, want ze staan naast elkaar in een kolom
  // van 208px; de kop bóven een sectie gebruikt de langere `section*`-sleutels.
  navGeneral: string;
  navNotifications: string;
  navAccounts: string;
  navAbout: string;
  // Het puntje in de navigatie heeft geen vorm die iets zegt, dus staat er voor
  // een schermlezer tekst achter de sectienaam: "Notifications, needs your
  // attention". Formuleer zo dat het achter een sectienaam voorleesbaar blijft.
  settingsAttention: string;

  sectionGeneral: string;
  autoStart: string;
  autoStartDescription: string;
  setDefaultMail: string;
  setDefaultMailHint: string;
  isDefaultMail: string;
  notDefaultMail: string;
  mailDropFolder: string;
  mailDropHint: string;
  mailDropChoose: string;
  mailDropOpen: string;
  dropTitle: (threads: number) => string;
  dropSubtitle: (ok: number, messages: number) => string;
  dropSavedCount: (messages: number) => string;
  theme: string;
  themeSystem: string;
  themeLight: string;
  themeDark: string;
  notificationOpenLabel: string;
  notificationOpenDescription: string;
  openInApp: string;
  openInWindow: string;

  sectionNotifications: string;
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

  sectionAbout: string;
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

  sectionWhatsNew: string;
  changelogVersionPrefix: string; // e.g. "Version" — shown before the number in each entry
  showOlder: string;
  hideOlder: string;
  changelogEmpty: string;
  changelogCategory: (heading: string) => string; // localizes a known "### Category" label

  sectionAccounts: string;
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

  settingsTitle: 'Settings',
  save: 'Save',
  saved: 'Saved ✓',
  close: 'Close',
  reneBanner: '🤓 Rene mode is on! Everything is big and easy.',

  navGeneral: 'General',
  navNotifications: 'Notifications',
  navAccounts: 'Accounts',
  navAbout: 'About',
  settingsAttention: 'needs your attention',

  sectionGeneral: 'General',
  autoStart: 'Start Gmail Desktop when I sign in',
  autoStartDescription: 'The app opens on its own when you sign in to Windows.',
  setDefaultMail: 'Set as default mail app',
  setDefaultMailHint: 'Windows may ask you to confirm the change.',
  isDefaultMail: 'This is your default mail app',
  notDefaultMail: 'Not your default mail app',
  mailDropFolder: 'Saved mail folder',
  mailDropHint:
    'Mail you drag into the strip at the top of Gmail is saved here as .eml, with a log.jsonl next to it',
  mailDropChoose: 'Choose…',
  mailDropOpen: 'Open',
  dropTitle: (t) => `${t} ${t === 1 ? 'conversation' : 'conversations'} moved`,
  dropSubtitle: (ok, m) => `${ok} saved — ${m} ${m === 1 ? 'message' : 'messages'} written to disk`,
  dropSavedCount: (m) => `${m} ${m === 1 ? 'message' : 'messages'} saved`,
  theme: 'Theme',
  themeSystem: 'System',
  themeLight: 'Light',
  themeDark: 'Dark',
  notificationOpenLabel: 'When you click a notification',
  notificationOpenDescription:
    'The message opens in the app, or in a separate Gmail window on top of it.',
  openInApp: 'Open in the app',
  openInWindow: 'Open in a new window',

  sectionNotifications: 'Notifications',
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
  badgeToggleTitle: 'Count this mailbox in the taskbar unread badge',
  soundToggle: 'Sound',
  soundToggleTitle: 'Play a sound with notifications for this account',
  persistToggle: 'Persist',
  persistToggleTitle: 'Keep notifications on screen until you dismiss them',
  toggleNotApplicable: 'Not available for this account',

  sectionAbout: 'About & updates',
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

  sectionWhatsNew: "What's new",
  changelogVersionPrefix: 'Version',
  showOlder: 'Show older versions',
  hideOlder: 'Hide older versions',
  changelogEmpty: 'No release notes available.',
  changelogCategory: (heading) => {
    const key = categoryKey(heading);
    return key ? CATEGORY_NORMAL[key] : '';
  },

  sectionAccounts: 'Accounts',
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

  settingsTitle: 'Knopjes',
  save: 'Bewaar',
  saved: 'Klaar ✓',
  close: 'Sluiten',
  reneBanner: '🤓 De Rene-stand staat aan! Alles is groot en makkelijk.',

  navGeneral: 'Gewoon',
  navNotifications: 'Meldingen',
  navAccounts: 'Wie doet mee?',
  navAbout: 'Over de app',
  settingsAttention: 'kijk hier even',

  sectionGeneral: 'Gewoon',
  autoStart: 'De app gaat zelf aan',
  autoStartDescription: 'De app gaat open als je de computer aanzet.',
  setDefaultMail: 'Maak dit je standaard-mailprogramma',
  setDefaultMailHint: 'Windows vraagt misschien of je het zeker weet.',
  isDefaultMail: 'Dit is je standaard-mailprogramma',
  notDefaultMail: 'Nog niet je standaard-mailprogramma',
  mailDropFolder: 'Waar de mailtjes komen',
  mailDropHint: 'Sleep een mailtje naar de balk boven Gmail. Dan komt hij hier te staan.',
  mailDropChoose: 'Kies map',
  mailDropOpen: 'Laat zien',
  dropTitle: (t) => `${t} ${t === 1 ? 'mailtje' : 'mailtjes'} verplaatst`,
  dropSubtitle: (ok, m) => `${ok} gelukt — ${m} ${m === 1 ? 'bericht' : 'berichten'} bewaard`,
  dropSavedCount: (m) => `${m} ${m === 1 ? 'bericht' : 'berichten'} bewaard`,
  theme: 'Kleur',
  themeSystem: 'De computer kiest',
  themeLight: 'Licht',
  themeDark: 'Donker',
  notificationOpenLabel: 'Als je op een melding klikt',
  notificationOpenDescription: 'De mail gaat open in de app, of in een eigen raam ervoor.',
  openInApp: 'In de app',
  openInWindow: 'In een nieuw raam',

  sectionNotifications: 'Meldingen',
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
  badgeToggleTitle: 'Tel de post van deze meneer of mevrouw mee in het getal op de knop',
  soundToggle: 'Geluid',
  soundToggleTitle: 'Speel een geluidje bij meldingen voor deze meneer of mevrouw',
  persistToggle: 'Blijft staan',
  persistToggleTitle: 'Meldingen blijven op het scherm staan tot u ze wegklikt',
  toggleNotApplicable: 'Kan niet bij deze meneer of mevrouw',

  sectionAbout: 'Over de app',
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

  sectionWhatsNew: 'Wat is er nieuw?',
  changelogVersionPrefix: 'Versie',
  showOlder: 'Laat oude dingen zien',
  hideOlder: 'Verberg oude dingen',
  changelogEmpty: 'Er is nog niks om te laten zien.',
  changelogCategory: (heading) => {
    const key = categoryKey(heading);
    return key ? CATEGORY_RENE[key] : '';
  },

  sectionAccounts: 'Wie doet mee?',
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
