// Keeping the app's idea of "may I have betas" current, by asking the relay.
//
// The decision itself is renderer/lib/prerelease.ts and the ask is beta-access.ts; this is the
// when. Two moments, for the two ways the answer changes: once detection has settled, because
// before that there is no account to ask as, and every hour after that, because somebody being
// added to or taken out of the tester group is an administrative act that happens in office
// hours rather than in seconds. The same reasoning and the same hour as the delegation sweep
// (delegation/delegated-controller.ts:70).
//
// A verdict that lands after the launch check would otherwise sit unused until the next
// half-hourly check, so a tester whose access arrives gets one check for their trouble.

import { betaVerdict, requestBetaAccess, type BetaAccessOutcome } from './beta-access';
import { checkForUpdate, applyUpdateChannel, republishUpdateStatus } from './update-controller';
import { betaAccessUrl, oauthConfig } from '../auth/oauth-config';
import { requestersInOrder } from '../auth/mailbox-token';
import { accessTokenFor } from '../auth/oauth-flow';
import { betaEligible, oauthTokens, setBetaEligible } from '../core/runtime';
import { notifyLog } from '../notify/notify-log';


//===========================
// Constants
//===========================

const BETA_SWEEP_MS = 60 * 60_000;


//===========================
// Module state
//===========================

let sweepStarted = false;


//===========================
// Exported functions
//===========================

/**
 * Starts asking the relay about beta access, once there is an own account to ask as
 *
 * Called every time detection settles; the gate lets exactly the first call with an account
 * through.
 */
export function maybeStartBetaAccessSweep(): void {
  if (sweepStarted || requestersInOrder().length === 0 || betaAccessUrl() === null) return;
  sweepStarted = true;
  void refreshBetaAccess();
  setInterval(() => void refreshBetaAccess(), BETA_SWEEP_MS).unref?.();
}


//===========================
// Helper functions
//===========================

/**
 * One round of asking, and what follows from a changed answer
 *
 * @private
 */
async function refreshBetaAccess(): Promise<void> {
  const url = betaAccessUrl();
  const cfg = oauthConfig();
  if (url === null || !cfg || !oauthTokens) return;

  const answers: BetaAccessOutcome[] = [];
  for (const requester of requestersInOrder()) {
    const token = await accessTokenFor(cfg, oauthTokens, requester.email);
    // No entry at all, deliberately: an account that could not be asked has to read as doubt
    // rather than as a refusal, the same rule the delegation walk applies.
    if (!token) continue;
    const answer = await requestBetaAccess({ url, requesterToken: token });
    if (!answer.ok) {
      notifyLog(`[beta] relay gave no answer via ${requester.email}: ${answer.error}`);
    }
    answers.push(answer);
    // One tester account is the whole answer; asking the rest can only repeat it.
    if (answer.ok && answer.beta) break;
  }

  const verdict = betaVerdict(answers);
  if (verdict === betaEligible) return;
  setBetaEligible(verdict);
  notifyLog(`[beta] prereleases ${verdictWord(verdict)}`);
  applyUpdateChannel();
  republishUpdateStatus();
  // Only a fresh yes is worth a check: a no changes nothing that is already installed, and a
  // doubt changed nothing at all.
  if (verdict === true) checkForUpdate({ background: true });
}

/**
 * @param verdict
 * @returns the log word for a three-valued answer
 * @private
 */
function verdictWord(verdict: boolean | undefined): string {
  if (verdict === true) return 'allowed';
  return verdict === false ? 'not allowed' : 'undecided';
}
