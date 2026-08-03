// De secties van het instellingenpaneel, en of er een aandachtspunt op staat.
// Puur, want dit is de enige logica in het paneel die niet over opmaak gaat.
//
// Dit bestand importeert niets, ook geen types: `page.tsx` is een component, en
// een `import type` daaruit trekt een .tsx in de compilatie van de tests, die
// zonder JSX draait.
export type SettingsSection = 'general' | 'notifications' | 'accounts' | 'about';

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

// Weergaveorde: Algemeen eerst omdat je daar het vaakst komt, Over laatst omdat
// je daar alleen komt als je iets zoekt.
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  'general',
  'notifications',
  'accounts',
  'about',
];

export interface AttentionInput {
  dnd: boolean;
  dndUntil?: number;
  updateReady: boolean;
}

// Een puntje in de navigatie betekent: hier staat iets dat je waarschijnlijk
// wilde weten zonder ernaar te zoeken. Alleen twee gevallen halen die lat —
// je meldingen staan uit (het ding dat je vergeet dat je het aanzette) en er
// staat een update klaar. Al het andere is een voorkeur, niet nieuws.
export function needsAttention(section: SettingsSection, input: AttentionInput): boolean {
  if (section === 'notifications') return input.dnd || (input.dndUntil ?? 0) > 0;
  if (section === 'about') return input.updateReady;
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
