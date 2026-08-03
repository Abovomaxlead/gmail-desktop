// De secties van het instellingenpaneel, en of er een aandachtspunt op staat.
// Puur, want dit is de enige logica in het paneel die niet over opmaak gaat.
export type SettingsSection = 'general' | 'notifications' | 'accounts' | 'about';

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
