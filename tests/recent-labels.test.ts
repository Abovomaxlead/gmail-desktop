// Which labels the picker offers again without being searched for.

import { describe, expect, it } from 'vitest';
import { recentFor, RECENT_SHOWN } from '../renderer/app/recent-labels';

const entry = (email: string, labelId: string, at: number) => ({ email, labelId, at });
const label = (id: string) => ({ id, name: `Label ${id}` });

describe('recentFor', () => {
  it('holds nothing when nothing was used today', () => {
    expect(recentFor([], 'a@x.com', [label('L1')])).toEqual([]);
  });

  it('answers with the mailbox that used them, not with every mailbox', () => {
    const used = [entry('a@x.com', 'L1', 1), entry('b@x.com', 'L2', 2)];
    expect(recentFor(used, 'a@x.com', [label('L1'), label('L2')])).toEqual([label('L1')]);
  });

  it('reads the address in whatever case it is asked in', () => {
    const used = [entry('Support@Example.NL', 'L1', 1)];
    expect(recentFor(used, 'support@example.nl', [label('L1')])).toEqual([label('L1')]);
  });

  it('puts the one used last in front', () => {
    const used = [entry('a@x.com', 'L1', 1), entry('a@x.com', 'L2', 2)];
    expect(recentFor(used, 'a@x.com', [label('L1'), label('L2')]).map((l) => l.id)).toEqual([
      'L2',
      'L1',
    ]);
  });

  it('names a label once however often it was used', () => {
    const used = [entry('a@x.com', 'L1', 1), entry('a@x.com', 'L2', 2), entry('a@x.com', 'L1', 3)];
    expect(recentFor(used, 'a@x.com', [label('L1'), label('L2')]).map((l) => l.id)).toEqual([
      'L1',
      'L2',
    ]);
  });

  // A label deleted at Google is still in this list until the day turns. Offering a row that
  // cannot be ticked is worse than offering nothing, so the mailbox's own labels decide.
  it('drops a label the mailbox no longer has', () => {
    const used = [entry('a@x.com', 'weg', 2), entry('a@x.com', 'L1', 1)];
    expect(recentFor(used, 'a@x.com', [label('L1')]).map((l) => l.id)).toEqual(['L1']);
  });

  it('carries the label as the mailbox spells it, not as it was stored', () => {
    const used = [entry('a@x.com', 'L1', 1)];
    const renamed = [{ id: 'L1', name: 'Offertes/Week 35' }];
    expect(recentFor(used, 'a@x.com', renamed)).toEqual(renamed);
  });

  it('stops at a handful, so the list stays a shortcut', () => {
    const many = Array.from({ length: RECENT_SHOWN + 3 }, (_, i) => entry('a@x.com', `L${i}`, i));
    const labels = many.map((e) => label(e.labelId));
    expect(recentFor(many, 'a@x.com', labels)).toHaveLength(RECENT_SHOWN);
  });
});
