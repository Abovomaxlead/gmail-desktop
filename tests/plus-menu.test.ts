import { describe, it, expect } from 'vitest';
import {
  planPlusMenu,
  suggestionId,
  suggestionEmail,
  PLUS_ADD_ACCOUNT,
  PLUS_ADD_DELEGATED,
  type PlusMenuStrings,
} from '../renderer/app/plus-menu';
import { hasClickableItem, type NativeMenuItem } from '../renderer/lib/native-menu';

// Herkenbare, korte teksten: de test gaat over wélke regel er staat, niet over de
// vertaling ervan.
const S: PlusMenuStrings = {
  addAccountLabel: 'add-account',
  addDelegatedLabel: 'add-delegated',
  delegatedScanning: 'scanning',
  delegatedSuggestionsHeading: 'heading',
  delegatedNoneFound: 'none-found',
};

const labels = (items: NativeMenuItem[]): string[] =>
  items.map((i) => (i.kind === 'separator' ? '---' : i.label));

const plan = (over: Partial<Parameters<typeof planPlusMenu>[0]> = {}) =>
  planPlusMenu({ strings: S, suggestions: [], scanning: false, scanDone: false, ...over });

describe('planPlusMenu', () => {
  it('always offers adding an account and a delegated mailbox', () => {
    expect(plan()).toEqual([
      { kind: 'item', id: PLUS_ADD_ACCOUNT, label: S.addAccountLabel },
      { kind: 'item', id: PLUS_ADD_DELEGATED, label: S.addDelegatedLabel },
    ]);
  });

  // Er is altijd iets te kiezen, dus dit menu gaat altijd open — anders dan het
  // rechtsklikmenu op een tabblad.
  it('is always openable', () => {
    for (const items of [plan(), plan({ scanning: true }), plan({ scanDone: true })]) {
      expect(hasClickableItem(items)).toBe(true);
    }
  });

  it('says it is looking while the scan runs', () => {
    expect(labels(plan({ scanning: true }))).toEqual(['add-account', 'add-delegated', 'scanning']);
  });

  it('lists what the scan found, under a heading', () => {
    const items = plan({ suggestions: [{ email: 'a@x.nl' }, { email: 'b@x.nl' }] });
    expect(labels(items)).toEqual(['add-account', 'add-delegated', '---', 'heading', 'a@x.nl', 'b@x.nl']);
    expect(items.filter((i) => i.kind === 'item').length).toBe(4);
  });

  it('says nothing was found once the scan is done and empty', () => {
    expect(labels(plan({ scanDone: true }))).toEqual(['add-account', 'add-delegated', 'none-found']);
  });

  // Zolang er gezocht wordt is "niets gevonden" nog niet waar, en een oude vondst
  // hoort niet als vers resultaat te blijven staan.
  it('shows the scanning line rather than earlier results or the empty line', () => {
    const items = plan({ scanning: true, scanDone: true, suggestions: [{ email: 'a@x.nl' }] });
    expect(labels(items)).toEqual(['add-account', 'add-delegated', 'scanning']);
  });

  // De id's van de vaste twee mogen niet met het voorvoegsel van een suggestie
  // botsen, anders zou een adres als "add-account" de verkeerde actie starten.
  it('keeps a suggestion id apart from the fixed actions', () => {
    const id = suggestionId('add-account');
    expect(id).not.toBe(PLUS_ADD_ACCOUNT);
    expect(suggestionEmail(id)).toBe('add-account');
    expect(suggestionEmail(PLUS_ADD_ACCOUNT)).toBeNull();
    expect(suggestionEmail(PLUS_ADD_DELEGATED)).toBeNull();
  });

  it('carries the address of every suggestion in its id', () => {
    const items = plan({ suggestions: [{ email: 'a@x.nl' }] });
    const picked = items.find((i) => i.kind === 'item' && i.label === 'a@x.nl');
    expect(picked?.kind === 'item' && suggestionEmail(picked.id)).toBe('a@x.nl');
  });
});
