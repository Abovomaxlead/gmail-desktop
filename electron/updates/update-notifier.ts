// Decides whether an available update is worth a notification: only a genuinely new
// version surfaced by a background check, and never twice for the same version in one
// session, since during a manual check the user is already looking.


//===========================
// Types
//===========================

export interface NotifyDecisionInput {
  state: string;
  version: string | null;
  background: boolean;
  notifiedVersion: string | null;
}


//===========================
// Exported functions
//===========================

/**
 * Whether an available update is worth a notification
 *
 * @param i notifiedVersion is what this session already announced
 * @returns true only for a new version found by a background check
 */
export function shouldNotifyUpdate(i: NotifyDecisionInput): boolean {
  return (
    i.state === 'available' &&
    i.background &&
    !!i.version &&
    i.version !== i.notifiedVersion
  );
}
