// De secties van het instellingenpaneel, hun indeling in de kolom, en of er een
// aandachtspunt op staat. Puur, want dit is de enige logica in het paneel die
// niet over opmaak gaat.
//
// Dit bestand importeert niets, ook geen types: `page.tsx` is een component, en
// een `import type` daaruit trekt een .tsx in de compilatie van de tests, die
// zonder JSX draait.
export type SettingsSection =
  | 'download-history'
  | 'general'
  | 'accounts'
  | 'appearance'
  | 'downloads'
  | 'gmail'
  | 'google-apps'
  | 'languages'
  | 'notifications'
  | 'phishing-protection'
  | 'updates'
  | 'verification-codes'
  | 'advanced'
  | 'whats-new'
  | 'about';

// De standen die het bijwerken kan hebben — dezelfde lijst als `UpdateState` in
// `page.tsx`, hier nog een keer opgeschreven om die import te vermijden. Loopt de
// lijst daar ooit uit deze, dan klaagt de compiler bij de aanroep in
// `SettingsPanel.tsx`: die geeft er een echte `UpdateState` in.
export type AttentionUpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'dev';

// De kolom staat in drie groepen met een haarlijn ertussen, en die groepen zijn
// geen versiering: ze scheiden drie soorten dingen die je hier komt doen.
//
//   1. Wat er is gebeurd — de lijst met wat je hebt gehaald. Een logboek en geen
//      voorkeur, dus niets om aan te zetten.
//   2. De voorkeuren zelf. Algemeen vooraan omdat je daar het vaakst komt, dan
//      alfabetisch, en Geavanceerd achteraan: dat hoort niet tussen de G en de L
//      maar aan het eind.
//   3. Wat er óver de app te lezen valt. Je komt er één keer, en dan zoek je iets
//      op.
//
// Eén lijst met groepen en geen tweede lijst met de platte volgorde: die staat
// hieronder en is hiervan afgeleid. Zo kan een sectie nooit in de ene lijst staan
// en in de andere ontbreken.
export const SETTINGS_GROUPS: readonly (readonly SettingsSection[])[] = [
  ['download-history'],
  [
    'general',
    'accounts',
    'appearance',
    'downloads',
    'gmail',
    'google-apps',
    'languages',
    'notifications',
    'phishing-protection',
    'updates',
    'verification-codes',
    'advanced',
  ],
  ['whats-new', 'about'],
];

// Weergaveorde over de groepen heen: de rij waarin de pijltjestoetsen lopen. Die
// steken door een haarlijn heen — een groep is een pauze voor het oog en geen
// muur voor het toetsenbord.
export const SETTINGS_SECTIONS: readonly SettingsSection[] = SETTINGS_GROUPS.flat();

// De sectie waar het paneel op opent. Algemeen, omdat je daar het vaakst komt.
export const DEFAULT_SECTION: SettingsSection = 'general';

export interface AttentionInput {
  dnd: boolean;
  dndUntil?: number;
  updateReady: boolean;
}

// Een puntje in de navigatie betekent: hier staat iets dat je waarschijnlijk
// wilde weten zonder ernaar te zoeken. Alleen twee gevallen halen die lat —
// je meldingen staan uit (het ding dat je vergeet dat je het aanzette) en er
// staat een update klaar. Al het andere is een voorkeur, niet nieuws.
//
// De update hangt bij Bijwerken en niet meer bij Over: de kolom heeft nu een
// eigen sectie voor bijwerken, en daar staat de knop die de update uitvoert. Een
// puntje hoort bij de sectie waar je hem indrukt.
export function needsAttention(section: SettingsSection, input: AttentionInput): boolean {
  if (section === 'notifications') return input.dnd || (input.dndUntil ?? 0) > 0;
  if (section === 'updates') return input.updateReady;
  return false;
}

// De weg van de voorkeuren naar de puntjes, apart van de opmaak zodat hij te
// testen is. Hij staat hier en niet in `SettingsPanel.tsx` omdat er precies één
// ding in fout kan gaan, en dat is gebeurd: `dndUntil` werd niet doorgegeven,
// waardoor een demping vanuit het tray-menu — de waarschijnlijkste van de twee
// redenen voor een puntje bij Meldingen — nooit een puntje gaf.
//
// `dndUntil` wordt hier niet met `Date.now()` vergeleken. Het hoofdproces is de
// baas over dat veld: `refreshNotifyAllowed` wist een verlopen demping op de
// minuuttik en stuurt de voorkeuren dan opnieuw. Hier nóg eens de klok lezen zou
// een tweede waarheid maken die van die van de tray kan afwijken.
export function attentionFrom(
  notifications: { dnd: boolean; dndUntil?: number } | undefined,
  updateState: AttentionUpdateState | undefined,
): AttentionInput {
  return {
    dnd: notifications?.dnd === true,
    dndUntil: notifications?.dndUntil,
    // Beide standen: in `available` en in `downloaded` staat er een knop klaar
    // die je waarschijnlijk wilde weten.
    updateReady: updateState === 'available' || updateState === 'downloaded',
  };
}
