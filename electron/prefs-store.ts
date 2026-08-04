import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AccountPref {
  order?: number;
  label?: string;
  zoom?: number;
  notify?: boolean;
  calendarNotify?: boolean;
  badgeCount?: boolean;
  notifySound?: boolean;
  // Opt-in: keep this account's notifications on screen until dismissed
  // (requireInteraction -> Electron timeoutType 'never').
  notifyPersist?: boolean;
}
export interface QuietHours {
  enabled: boolean;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}
export interface NotificationPrefs {
  dnd: boolean;
  dndUntil?: number; // epoch ms; notifications stay muted while Date.now() < dndUntil
  quietHours: QuietHours;
  // Wat er in een melding te lezen staat. Beide standaard aan, want dat is wat een
  // melding nu toont; uit betekent dat de regel wordt vervangen door een neutrale
  // tekst en niet dat hij leeg blijft — een melding zonder afzender én zonder
  // onderwerp moet nog steeds zeggen dát er post is.
  showSender: boolean;
  showSubject: boolean;
  // De hoofdschakelaar voor geluid. Staat hij uit, dan is elke melding stil, ook
  // die van een account waarvoor geluid aan staat. Aan laat de keuze per account
  // (`notifySound`) beslissen — dus standaard aan verandert er niets.
  sound: boolean;
  // Meldingen van de andere Google-apps (nu: de agenda). Hoofdschakelaar boven de
  // keuze per account (`calendarNotify`), zelfde verhouding als `sound`.
  googleApps: boolean;
}

// De weergave van de app zelf: het thema staat hierbuiten (`Prefs.theme`) omdat
// main het al vóór het eerste venster nodig heeft voor de achtergrondkleur.
export interface TrayPrefs {
  enabled: boolean;
  // Klik je op het tray-icoon, spring dan naar het eerste account met ongelezen
  // post in plaats van naar het account dat vooraan stond.
  selectUnreadOnClick: boolean;
  // Hier hoort ook de kleur van het tray-icoon. Die staat er nog niet: het icoon is
  // het gekleurde app-logo, en "licht" of "donker" vraagt om een monochrome variant
  // in assets/. Zonder die twee bestanden zou de keuze een schakelaar zijn die niets
  // doet, en dat is erger dan een keuze die er nog niet is.
}
export interface AppearancePrefs {
  // Hoofdschakelaar boven `badgeCount` per account: uit verbergt elk getal, ook
  // van een account dat wél meetelt.
  showUnreadBadges: boolean;
  tray: TrayPrefs;
  // De ondergrens van 800px op de vensterbreedte. Zie de opmerking bij `minWidth`
  // in main.ts voor waarom die er is; uitzetten mag, maar dan kan de balk klem
  // komen te zitten.
  restrictMinWindowSize: boolean;
}

// Wat de app met een download uit Gmail doet. `folder` leeg = de downloadmap van
// het besturingssysteem, die main oplost (deze module kent `app` niet) — dezelfde
// afspraak als bij `MailDropPrefs`.
export type DownloadClickAction = 'show-in-folder' | 'open-file' | 'nothing';
export interface DownloadPrefs {
  folder: string;
  saveAsDialog: boolean;
  openFolderWhenDone: boolean;
  notify: boolean;
  notifyClick: DownloadClickAction;
}

export interface PhishingPrefs {
  // Standaard uit: tot nu toe ging een externe link zonder tussenstap naar de
  // browser, en een app die na een update ineens bij elke link iets vraagt is
  // stuk in de ogen van wie hem gebruikt. Aanzetten is een keuze van de gebruiker.
  confirmExternalLinks: boolean;
  // Hosts waarvoor niets wordt gevraagd. Kleine letters, zonder schema of pad.
  trustedHosts: string[];
}

export interface UpdatePrefs {
  // Zelf kijken of er een nieuwe versie is: bij het opstarten en daarna elk half
  // uur. Standaard aan, want dat doet de app nu.
  autoCheck: boolean;
  // Een melding als er een versie klaarstaat. Los van `autoCheck`: je kan zelf
  // willen kijken zonder gestoord te worden, of juist het omgekeerde.
  notify: boolean;
}

export interface LanguagePrefs {
  // Extra talen voor de spellingcontrole, naast de taal van het systeem. BCP-47,
  // zoals Chromium ze noemt ('nl', 'en-GB').
  spellcheck: string[];
}

// De tab Gmail: wat de app in Gmail's eigen pagina verandert. Alles standaard
// `false` — dan wordt er niets aangeraakt en ziet Gmail eruit zoals Google hem
// levert, precies zoals nu.
//
// Dit zijn ingrepen in een pagina die niet van ons is. De selectors staan daarom op
// één plek (gmail-tweaks.ts) met per regel wat hij zoekt, en niet verspreid: als
// Google iets omgooit, is dat één tabel om bij te werken in plaats van een zoektocht.
export interface GmailPrefs {
  hideLogo: boolean;
  hideOutOfOfficeBanner: boolean;
  hideUpgradeButton: boolean;
  hideInboxFooter: boolean;
  // Opstellen in een eigen venster in plaats van in het hoekje van Gmail. Geen
  // ingreep in de opmaak maar in de app: het opstelvenster bestaat al
  // (compose-window.ts, gebruikt voor een mailto:-link).
  //
  // "Sluit het opstelvenster na verzenden" hoort hier ook en staat er niet: dat
  // vraagt een haak binnen Gmail's eigen opstelpagina, en dat venster draait met
  // opzet zonder onze preload — die is voor de mailweergave en zou daar ongelezen
  // post gaan tellen en meldingen afvangen.
  alwaysComposeInNewWindow: boolean;
}

// De tab Google Apps: hoe de agenda en de andere Google-apps opengaan.
export interface GoogleAppsPrefs {
  // In de app of in de browser. Standaard `true`, want dat is wat er nu gebeurt.
  openInApp: boolean;
  alwaysNewWindow: boolean;
  // Apps die tóch naar de browser gaan, als sleutel uit `renderer/lib/surfaces.ts`.
  excluded: string[];
  showAccountLabel: boolean;
  showAccountColor: boolean;
  // Apps die als icoon in de balk staan, in de volgorde waarin ze daar staan. Leeg
  // = geen, en dat is de stand van nu: de agenda en de apps zitten in het
  // rechtsklikmenu van een tabblad.
  pinned: string[];
}

export interface AdvancedPrefs {
  // Uitzetten helpt bij een haperende of zwarte weergave op sommige machines.
  // Wordt vóór 'ready' gelezen en werkt dus pas na een herstart.
  hardwareAcceleration: boolean;
}

// De vorm waarin een wijziging binnenkomt. `tray` is een laag diep, dus een
// gewone `Partial` zou bij het zetten van één tray-veld de andere twee wissen.
export type AppearancePatch = Partial<Omit<AppearancePrefs, 'tray'>> & {
  tray?: Partial<TrayPrefs>;
};

// Alleen de vier velden die geen deel zijn van "ben ik gedempt": `dnd`, `dndUntil`
// en `quietHours` gaan langs `setNotifications`, dat er een eigen samenvoegregel
// voor heeft.
export type NotificationExtrasPatch = Partial<
  Pick<NotificationPrefs, 'showSender' | 'showSubject' | 'sound' | 'googleApps'>
>;
export interface WindowPrefs {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}
export type ThemeChoice = 'system' | 'light' | 'dark';
// How a clicked notification (and any in-app link that opens a new window) is
// handled: 'app' navigates within the app and brings the window forward;
// 'window' opens a separate window as before.
export type NotificationOpen = 'app' | 'window';

// Waar gesleepte mail wordt opgeslagen. Leeg = de standaardmap, die main
// bepaalt (deze module kent `app` niet).
export interface MailDropPrefs {
  folder: string;
}

export interface Prefs {
  window: WindowPrefs;
  autoStart: boolean;
  // Start het venster geminimaliseerd. Staat los van `autoStart`: je kan de app
  // ook met de hand starten en hem toch klein willen beginnen.
  launchMinimized: boolean;
  theme: ThemeChoice;
  notificationOpen: NotificationOpen;
  notifications: NotificationPrefs;
  accounts: Record<string, AccountPref>;
  mailDrop: MailDropPrefs;
  appearance: AppearancePrefs;
  downloads: DownloadPrefs;
  phishing: PhishingPrefs;
  updates: UpdatePrefs;
  languages: LanguagePrefs;
  gmail: GmailPrefs;
  googleApps: GoogleAppsPrefs;
  advanced: AdvancedPrefs;
  // Easter egg: everything at 200% and the UI in simple Dutch. Toggled only by
  // the secret key sequence on the settings page.
  reneMode: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  window: { width: 1200, height: 820, maximized: false },
  autoStart: false,
  launchMinimized: false,
  theme: 'system',
  notificationOpen: 'app',
  notifications: {
    dnd: false,
    quietHours: { enabled: false, start: '18:00', end: '08:00' },
    showSender: true,
    showSubject: true,
    sound: true,
    googleApps: true,
  },
  accounts: {},
  mailDrop: { folder: '' },
  // Elke standaard hieronder is gekozen om het gedrag te laten zoals het was
  // vóórdat de instelling bestond. Wie de app bijwerkt hoort niets te merken; wat
  // er verandert, verandert omdat de gebruiker een schakelaar omzet.
  appearance: {
    showUnreadBadges: true,
    tray: { enabled: true, selectUnreadOnClick: false },
    restrictMinWindowSize: true,
  },
  downloads: {
    folder: '',
    saveAsDialog: false,
    openFolderWhenDone: false,
    notify: true,
    notifyClick: 'show-in-folder',
  },
  phishing: { confirmExternalLinks: false, trustedHosts: [] },
  updates: { autoCheck: true, notify: true },
  languages: { spellcheck: [] },
  gmail: {
    hideLogo: false,
    hideOutOfOfficeBanner: false,
    hideUpgradeButton: false,
    hideInboxFooter: false,
    alwaysComposeInNewWindow: false,
  },
  googleApps: {
    openInApp: true,
    alwaysNewWindow: false,
    excluded: [],
    showAccountLabel: true,
    showAccountColor: true,
    pinned: [],
  },
  advanced: { hardwareAcceleration: true },
  reneMode: false,
};

// Drie kleine lezers voor `getAll`. Met negentien velden erbij werd elke regel
// daar een ternary met een pad erin, en dan is niet meer te zien welk veld welke
// standaard krijgt. Ze staan hier en niet in een eigen bestand omdat ze alleen
// over het lezen van dit ene bestand gaan.
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
// Alleen niet-lege strings, ontdubbeld, in de volgorde waarin ze stonden. Een
// hand-geschreven bestand met een getal of een null in de lijst mag de hele lijst
// niet weggooien.
function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const s = item.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

export class PrefsStore {
  constructor(private readonly filePath: string) {}

  getAll(): Prefs {
    if (!existsSync(this.filePath)) return structuredClone(DEFAULT_PREFS);
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return structuredClone(DEFAULT_PREFS);
      return {
        window: { ...DEFAULT_PREFS.window, ...(raw.window ?? {}) },
        autoStart: typeof raw.autoStart === 'boolean' ? raw.autoStart : DEFAULT_PREFS.autoStart,
        launchMinimized:
          typeof raw.launchMinimized === 'boolean'
            ? raw.launchMinimized
            : DEFAULT_PREFS.launchMinimized,
        theme: ['system', 'light', 'dark'].includes(raw.theme) ? raw.theme : DEFAULT_PREFS.theme,
        notificationOpen: raw.notificationOpen === 'window' ? 'window' : 'app',
        notifications: {
          dnd: typeof raw.notifications?.dnd === 'boolean' ? raw.notifications.dnd : false,
          dndUntil: typeof raw.notifications?.dndUntil === 'number' ? raw.notifications.dndUntil : undefined,
          quietHours: { ...DEFAULT_PREFS.notifications.quietHours, ...(raw.notifications?.quietHours ?? {}) },
          showSender: bool(raw.notifications?.showSender, true),
          showSubject: bool(raw.notifications?.showSubject, true),
          sound: bool(raw.notifications?.sound, true),
          googleApps: bool(raw.notifications?.googleApps, true),
        },
        accounts: raw.accounts && typeof raw.accounts === 'object' && !Array.isArray(raw.accounts)
          ? raw.accounts
          : {},
        mailDrop: {
          folder: typeof raw.mailDrop?.folder === 'string' ? raw.mailDrop.folder : '',
        },
        appearance: {
          showUnreadBadges: bool(raw.appearance?.showUnreadBadges, true),
          tray: {
            enabled: bool(raw.appearance?.tray?.enabled, true),
            selectUnreadOnClick: bool(raw.appearance?.tray?.selectUnreadOnClick, false),
          },
          restrictMinWindowSize: bool(raw.appearance?.restrictMinWindowSize, true),
        },
        downloads: {
          folder: typeof raw.downloads?.folder === 'string' ? raw.downloads.folder : '',
          saveAsDialog: bool(raw.downloads?.saveAsDialog, false),
          openFolderWhenDone: bool(raw.downloads?.openFolderWhenDone, false),
          notify: bool(raw.downloads?.notify, true),
          notifyClick: oneOf(
            raw.downloads?.notifyClick,
            ['show-in-folder', 'open-file', 'nothing'] as const,
            'show-in-folder',
          ),
        },
        phishing: {
          confirmExternalLinks: bool(raw.phishing?.confirmExternalLinks, false),
          trustedHosts: stringList(raw.phishing?.trustedHosts),
        },
        updates: {
          autoCheck: bool(raw.updates?.autoCheck, true),
          notify: bool(raw.updates?.notify, true),
        },
        languages: { spellcheck: stringList(raw.languages?.spellcheck) },
        gmail: {
          hideLogo: bool(raw.gmail?.hideLogo, false),
          hideOutOfOfficeBanner: bool(raw.gmail?.hideOutOfOfficeBanner, false),
          hideUpgradeButton: bool(raw.gmail?.hideUpgradeButton, false),
          hideInboxFooter: bool(raw.gmail?.hideInboxFooter, false),
          alwaysComposeInNewWindow: bool(raw.gmail?.alwaysComposeInNewWindow, false),
        },
        googleApps: {
          openInApp: bool(raw.googleApps?.openInApp, true),
          alwaysNewWindow: bool(raw.googleApps?.alwaysNewWindow, false),
          excluded: stringList(raw.googleApps?.excluded),
          showAccountLabel: bool(raw.googleApps?.showAccountLabel, true),
          showAccountColor: bool(raw.googleApps?.showAccountColor, true),
          pinned: stringList(raw.googleApps?.pinned),
        },
        advanced: { hardwareAcceleration: bool(raw.advanced?.hardwareAcceleration, true) },
        reneMode: typeof raw.reneMode === 'boolean' ? raw.reneMode : false,
      };
    } catch {
      return structuredClone(DEFAULT_PREFS);
    }
  }

  private write(prefs: Prefs): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(prefs, null, 2), 'utf8');
  }

  setWindow(w: WindowPrefs): void {
    this.write({ ...this.getAll(), window: w });
  }
  setAutoStart(v: boolean): void {
    this.write({ ...this.getAll(), autoStart: v });
  }

  // Vanaf hier één setter per tab, met een patch, in plaats van één per veld. Met
  // ruim twintig nieuwe instellingen zou dat twintig methodes, twintig
  // IPC-kanalen en twintig brugfuncties zijn die op de naam na identiek zijn. Een
  // patch per groep houdt dat bij elkaar, en de groep is precies de tab waar de
  // gebruiker de instelling zet.
  //
  // Elke patch wordt over de gelezen voorkeuren gelegd, dus een veld dat niet in
  // de patch staat blijft staan. Bij `tray` gaat dat een laag dieper: een patch
  // met alleen `color` erin mag de andere twee velden niet wissen.
  setAppearance(patch: AppearancePatch): void {
    const prefs = this.getAll();
    this.write({
      ...prefs,
      appearance: {
        ...prefs.appearance,
        ...patch,
        tray: { ...prefs.appearance.tray, ...(patch.tray ?? {}) },
      },
    });
  }
  setDownloads(patch: Partial<DownloadPrefs>): void {
    const prefs = this.getAll();
    this.write({ ...prefs, downloads: { ...prefs.downloads, ...patch } });
  }
  setPhishing(patch: Partial<PhishingPrefs>): void {
    const prefs = this.getAll();
    // De lijst gaat door dezelfde lezer als bij het inlezen: kleine letters,
    // ontdubbeld, geen leegte. Zo kan de lijst niet via de ene weg schoon en via
    // de andere rommelig binnenkomen.
    const trustedHosts =
      patch.trustedHosts === undefined
        ? prefs.phishing.trustedHosts
        : stringList(patch.trustedHosts.map((h) => h.toLowerCase()));
    this.write({ ...prefs, phishing: { ...prefs.phishing, ...patch, trustedHosts } });
  }
  setUpdates(patch: Partial<UpdatePrefs>): void {
    const prefs = this.getAll();
    this.write({ ...prefs, updates: { ...prefs.updates, ...patch } });
  }
  setLanguages(patch: Partial<LanguagePrefs>): void {
    const prefs = this.getAll();
    const spellcheck =
      patch.spellcheck === undefined ? prefs.languages.spellcheck : stringList(patch.spellcheck);
    this.write({ ...prefs, languages: { spellcheck } });
  }
  setAdvanced(patch: Partial<AdvancedPrefs>): void {
    const prefs = this.getAll();
    this.write({ ...prefs, advanced: { ...prefs.advanced, ...patch } });
  }
  setGmail(patch: Partial<GmailPrefs>): void {
    const prefs = this.getAll();
    this.write({ ...prefs, gmail: { ...prefs.gmail, ...patch } });
  }
  setGoogleApps(patch: Partial<GoogleAppsPrefs>): void {
    const prefs = this.getAll();
    // De twee lijsten door dezelfde lezer als bij het inlezen: sleutels zonder
    // leegte en zonder dubbelen. `pinned` houdt zijn volgorde — die is de volgorde
    // in de balk en dus betekenisvol.
    const excluded = patch.excluded === undefined ? prefs.googleApps.excluded : stringList(patch.excluded);
    const pinned = patch.pinned === undefined ? prefs.googleApps.pinned : stringList(patch.pinned);
    this.write({ ...prefs, googleApps: { ...prefs.googleApps, ...patch, excluded, pinned } });
  }
  // De vier nieuwe velden bij meldingen apart van `setNotifications`: die gaat over
  // gedempt zijn en heeft in `mergeNotificationsFromPanel` een eigen regel over
  // `dndUntil`. Deze vier zijn gewone voorkeuren en horen daar niet tussen.
  setNotificationExtras(patch: NotificationExtrasPatch): void {
    const prefs = this.getAll();
    this.write({ ...prefs, notifications: { ...prefs.notifications, ...patch } });
  }
  setLaunchMinimized(v: boolean): void {
    this.write({ ...this.getAll(), launchMinimized: v });
  }
  setTheme(t: ThemeChoice): void {
    this.write({ ...this.getAll(), theme: t });
  }
  setNotificationOpen(v: NotificationOpen): void {
    this.write({ ...this.getAll(), notificationOpen: v });
  }
  // Een patch en niet het hele blok. Het paneel stuurt `dnd` en `quietHours`, de
  // tray stuurt `dndUntil`, en sinds er ook velden over de inhoud van een melding
  // in dit blok staan zou "schrijf wat je krijgt" die wissen bij elke wijziging
  // van de ene of de andere kant. Een volledig blok is nog steeds een geldige
  // patch, dus main's `mergeNotificationsFromPanel` blijft werken zoals hij was.
  setNotifications(patch: Partial<NotificationPrefs>): void {
    const prefs = this.getAll();
    this.write({ ...prefs, notifications: { ...prefs.notifications, ...patch } });
  }
  setReneMode(v: boolean): void {
    this.write({ ...this.getAll(), reneMode: v });
  }
  setMailDropFolder(folder: string): void {
    this.write({ ...this.getAll(), mailDrop: { folder } });
  }
  getAccount(email: string): AccountPref {
    return this.getAll().accounts[email] ?? {};
  }
  setAccount(email: string, partial: Partial<AccountPref>): void {
    const prefs = this.getAll();
    const next = { ...(prefs.accounts[email] ?? {}), ...partial };
    // Drop keys explicitly cleared with undefined/'' so labels can be removed.
    if (partial.label === '' || partial.label === undefined && 'label' in partial) delete next.label;
    prefs.accounts = { ...prefs.accounts, [email]: next };
    this.write(prefs);
  }
  setOrder(emailsInOrder: string[]): void {
    const prefs = this.getAll();
    emailsInOrder.forEach((email, i) => {
      prefs.accounts = { ...prefs.accounts, [email]: { ...(prefs.accounts[email] ?? {}), order: i } };
    });
    this.write(prefs);
  }
}
