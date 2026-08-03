import type { NativeMenuItem } from '../lib/native-menu';

// Wat er in het "+"-menu van de balk staat. Puur, zodat het te testen is zonder
// de balk te tekenen en zonder Electron; main maakt er een echt OS-menu van.

// De id's die terugkomen als de gebruiker kiest. Losse constanten in plaats van
// letterlijke strings in de balk: dan kan het plan en de afhandeling niet uiteen
// gaan lopen zonder dat TypeScript het merkt.
export const PLUS_ADD_ACCOUNT = 'add-account';
export const PLUS_ADD_DELEGATED = 'add-delegated';

// Een gevonden postbus draagt zijn adres in het id mee: dat is het enige wat de
// balk nodig heeft om de suggestie in zijn eigen lijst terug te vinden.
const SUGGESTION_PREFIX = 'suggestion:';
export const suggestionId = (email: string): string => `${SUGGESTION_PREFIX}${email}`;
export function suggestionEmail(id: string): string | null {
  return id.startsWith(SUGGESTION_PREFIX) ? id.slice(SUGGESTION_PREFIX.length) : null;
}

// Alleen de teksten die dit menu gebruikt, niet de hele stringsbundel: dan is aan
// de test te zien wat er echt in het menu komt.
export interface PlusMenuStrings {
  addAccountLabel: string;
  addDelegatedLabel: string;
  delegatedScanning: string;
  delegatedSuggestionsHeading: string;
  delegatedNoneFound: string;
}

export function planPlusMenu(input: {
  strings: PlusMenuStrings;
  suggestions: readonly { email: string }[];
  scanning: boolean;
  scanDone: boolean;
}): NativeMenuItem[] {
  const { strings: S, suggestions, scanning, scanDone } = input;
  const items: NativeMenuItem[] = [
    { kind: 'item', id: PLUS_ADD_ACCOUNT, label: S.addAccountLabel },
    { kind: 'item', id: PLUS_ADD_DELEGATED, label: S.addDelegatedLabel },
  ];
  // Tijdens het zoeken staat er dat er gezocht wordt; daarna de vondst, of dat er
  // niets was. Dezelfde drie standen als het uitklapmenu ze tekende. Een OS-menu
  // sluit bij de klik, dus je ziet ze als je het menu tijdens of na het zoeken
  // opnieuw opent — het bolletje op de "+" vertelt dat er iets te zien is.
  if (scanning) {
    items.push({ kind: 'text', label: S.delegatedScanning });
  } else if (suggestions.length > 0) {
    items.push({ kind: 'separator' }, { kind: 'text', label: S.delegatedSuggestionsHeading });
    for (const s of suggestions) {
      items.push({ kind: 'item', id: suggestionId(s.email), label: s.email });
    }
  } else if (scanDone) {
    items.push({ kind: 'text', label: S.delegatedNoneFound });
  }
  return items;
}
