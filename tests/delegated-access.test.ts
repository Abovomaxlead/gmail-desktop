// Whether one mailbox is still reachable, decided per mailbox instead of per answer set.
//
// The set rule (delegated-reconcile.ts) is unreachable for anyone with an own account that has
// no OAuth token: it is never asked, so the answers stay 'incomplete' and a revoked delegation
// stays in the sidebar. A refusal from the token endpoint names the mailbox, so it can settle
// what the lists cannot -- and it must still refuse on every failure that is about the ask.

import { describe, it, expect } from 'vitest';
import { accessVerdict, type AccessAttempt } from '../electron/delegation/delegated-access';

const granted: AccessAttempt = { ok: true };
const refused: AccessAttempt = { ok: false, status: 403 };
const failed = (status: number): AccessAttempt => ({ ok: false, status });

describe('accessVerdict', () => {
  it('reads one grant as access, whatever the others said', () => {
    expect(accessVerdict([refused, granted])).toBe('granted');
  });

  // The case this exists for: the delegation was taken away at Google, and no account has it.
  it('reads a refusal from every requester as revoked', () => {
    expect(accessVerdict([refused, refused])).toBe('revoked');
  });

  it('reads the one requester there is being refused as revoked', () => {
    expect(accessVerdict([refused])).toBe('revoked');
  });

  // Nobody could be asked, so nothing was learned. Removing here would empty the sidebar of
  // every delegated mailbox the moment the tokens go stale.
  it('says nothing when no requester could be asked', () => {
    expect(accessVerdict([])).toBe('unknown');
  });

  // A relay that is down refuses nothing; it just fails to answer.
  it('never reads an unreachable relay as revoked', () => {
    expect(accessVerdict([failed(0)])).toBe('unknown');
  });

  it('never reads a relay error as revoked', () => {
    expect(accessVerdict([failed(503)])).toBe('unknown');
  });

  // The requester's own token expiring says nothing about the delegation record.
  it('never reads a rejected requester token as revoked', () => {
    expect(accessVerdict([failed(401)])).toBe('unknown');
  });

  // One requester refused and one that could not be reached is not unanimity: the account whose
  // ask failed is exactly the one that might have held the delegation.
  it('holds off when one requester was refused and another never answered', () => {
    expect(accessVerdict([refused, failed(0)])).toBe('unknown');
  });
});
