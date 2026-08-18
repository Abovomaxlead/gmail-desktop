// The rail beside the label list: what every mailbox row has to say before you click it,
// and what the footer shows about mailboxes that are out of sight.

import { describe, it, expect } from 'vitest';
import {
  mailboxRows,
  pickedChips,
  firstPickable,
  localPart,
  type RailAccount,
} from '../renderer/app/mailbox-rail';

const ACCOUNTS: RailAccount[] = [
  {
    email: 'johan@abovomaxlead.nl',
    labels: [
      { id: 'INBOX', name: 'Postvak IN' },
      { id: 'L1', name: 'Facturen' },
      { id: 'L2', name: 'Facturen/Betaald' },
      { id: 'L3', name: 'Leveranciers' },
    ],
  },
  {
    email: 'info@abovomaxlead.nl',
    labels: [
      { id: 'INBOX', name: 'Postvak IN' },
      { id: 'M1', name: 'Klanten' },
    ],
  },
  { email: 'sales@abovomaxlead.nl', labels: [], error: 'Niet gekoppeld' },
];

describe('mailboxRows', () => {
  it('keeps one row per mailbox, in the order they came in', () => {
    expect(mailboxRows(ACCOUNTS, {}, [], '').map((r) => r.email)).toEqual([
      'johan@abovomaxlead.nl',
      'info@abovomaxlead.nl',
      'sales@abovomaxlead.nl',
    ]);
  });

  it('counts what is ticked per mailbox and leaves the match count empty', () => {
    const rows = mailboxRows(ACCOUNTS, { 'johan@abovomaxlead.nl': ['L1', 'L3'] }, [], '');
    expect(rows[0]).toEqual({
      email: 'johan@abovomaxlead.nl',
      pickedCount: 2,
      matchCount: null,
      hasExisting: false,
    });
    expect(rows[1].pickedCount).toBe(0);
  });

  // The count has to be what the list will show, or the rail sends you to an empty pane.
  it('counts the labels a search leaves standing, ticked ones included', () => {
    const rows = mailboxRows(ACCOUNTS, { 'johan@abovomaxlead.nl': ['L3'] }, [], 'fact');
    expect(rows[0].matchCount).toBe(3);
    expect(rows[1].matchCount).toBe(0);
  });

  it('marks the mailboxes the scan found this mail in', () => {
    const existing = [
      { email: 'johan@abovomaxlead.nl', labels: [{ labelId: 'L1', count: 2 }] },
      { email: 'info@abovomaxlead.nl', labels: [], error: 'Kon niet controleren' },
    ];
    const rows = mailboxRows(ACCOUNTS, {}, existing, '');
    expect(rows[0].hasExisting).toBe(true);
    expect(rows[1].hasExisting).toBe(false);
  });

  it('carries the reason a mailbox could not be read', () => {
    expect(mailboxRows(ACCOUNTS, {}, [], '')[2].error).toBe('Niet gekoppeld');
  });
});

describe('pickedChips', () => {
  it('names the first label of every mailbox that has one, and counts the rest', () => {
    expect(
      pickedChips({ 'johan@abovomaxlead.nl': ['L1', 'L3'], 'info@abovomaxlead.nl': ['M1'] }, ACCOUNTS),
    ).toEqual([
      { email: 'johan@abovomaxlead.nl', label: 'Facturen', extra: 1 },
      { email: 'info@abovomaxlead.nl', label: 'Klanten', extra: 0 },
    ]);
  });

  it('leaves out a mailbox nothing is ticked in', () => {
    expect(pickedChips({ 'johan@abovomaxlead.nl': [] }, ACCOUNTS)).toEqual([]);
  });

  it('falls back to the id of a label the lists do not name', () => {
    expect(pickedChips({ 'johan@abovomaxlead.nl': ['Label_7'] }, ACCOUNTS)).toEqual([
      { email: 'johan@abovomaxlead.nl', label: 'Label_7', extra: 0 },
    ]);
  });

  it('follows the mailbox order, not the order they were ticked in', () => {
    const chips = pickedChips(
      { 'info@abovomaxlead.nl': ['M1'], 'johan@abovomaxlead.nl': ['L1'] },
      ACCOUNTS,
    );
    expect(chips.map((c) => c.email)).toEqual(['johan@abovomaxlead.nl', 'info@abovomaxlead.nl']);
  });
});

describe('firstPickable', () => {
  it('opens on the first mailbox that can be read', () => {
    expect(firstPickable([ACCOUNTS[2], ACCOUNTS[1]])).toBe('info@abovomaxlead.nl');
  });
  it('opens on the first one anyway when none can be read', () => {
    expect(firstPickable([ACCOUNTS[2]])).toBe('sales@abovomaxlead.nl');
  });
  it('has nothing to open when there are no mailboxes', () => {
    expect(firstPickable([])).toBe('');
  });
});

describe('localPart', () => {
  it('drops the domain', () => {
    expect(localPart('johan@abovomaxlead.nl')).toBe('johan');
  });
  it('leaves something that is not an address alone', () => {
    expect(localPart('johan')).toBe('johan');
  });
});
